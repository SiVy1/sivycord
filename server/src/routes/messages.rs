use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use std::collections::HashMap;

use crate::entities::{message, reaction};
use crate::models::{
    Message, MessageEdit, MessageWithReply, MessagesQuery, Permissions, ReactionGroup,
    RepliedMessage, WsServerMessage,
};
use crate::routes::auth;
use crate::permissions::check_channel_permission;
use crate::state::AppState;

pub async fn get_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    Query(query): Query<MessagesQuery>,
) -> Result<Json<Vec<MessageWithReply>>, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    let limit = query.limit.unwrap_or(50).min(100) as u64;

    // Check if user has VIEW_CHANNELS permission in this channel
    if !check_channel_permission(&state, &claims.sub, &channel_id, Permissions::VIEW_CHANNELS)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission error: {e}")))? 
    {
        return Err((StatusCode::FORBIDDEN, "You do not have permission to view this channel".into()));
    }

    let mut q = message::Entity::find()
        .filter(message::Column::ChannelId.eq(&channel_id))
        .filter(message::Column::DeletedAt.is_null())
        .order_by_desc(message::Column::CreatedAt)
        .limit(limit);

    if let Some(before) = &query.before {
        q = q.filter(message::Column::CreatedAt.lt(before));
    }

    let mut messages: Vec<Message> = q
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    messages.reverse();

    // Batch-fetch replied messages
    let reply_ids: Vec<String> = messages
        .iter()
        .filter_map(|m| m.reply_to.clone())
        .collect();

    let replied_map: HashMap<String, Message> = if !reply_ids.is_empty() {
        message::Entity::find()
            .filter(message::Column::Id.is_in(&reply_ids))
            .all(&state.db)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|m| (m.id.clone(), m))
            .collect()
    } else {
        HashMap::new()
    };

    // Batch-fetch reactions for these messages
    let message_ids: Vec<String> = messages.iter().map(|m| m.id.clone()).collect();
    let reactions = if !message_ids.is_empty() {
        reaction::Entity::find()
            .filter(reaction::Column::MessageId.is_in(&message_ids))
            .all(&state.db)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    // Group reactions by message_id, then by emoji
    let mut reaction_map: HashMap<String, HashMap<String, Vec<String>>> = HashMap::new();
    for r in reactions {
        reaction_map
            .entry(r.message_id)
            .or_default()
            .entry(r.emoji)
            .or_default()
            .push(r.user_id);
    }

    let result: Vec<MessageWithReply> = messages
        .into_iter()
        .map(|msg| {
            let msg_id = msg.id.clone();
            let replied_message = msg.reply_to.as_ref().and_then(|rid| {
                replied_map.get(rid).map(|m| {
                    let truncated = if m.content.len() > 100 {
                        format!("{}…", &m.content[..100])
                    } else {
                        m.content.clone()
                    };
                    RepliedMessage {
                        id: m.id.clone(),
                        content: truncated,
                        user_name: m.user_name.clone(),
                    }
                })
            });

            let reactions = reaction_map
                .remove(&msg_id)
                .unwrap_or_default()
                .into_iter()
                .map(|(emoji, user_ids)| ReactionGroup {
                    count: user_ids.len() as i64,
                    user_ids,
                    emoji,
                })
                .collect();

            MessageWithReply {
                message: msg,
                replied_message,
                reactions,
            }
        })
        .collect();

    Ok(Json(result))
}

pub async fn edit_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(message_id): Path<String>,
    Json(payload): Json<MessageEdit>,
) -> Result<Json<Message>, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let message = message::Entity::find_by_id(message_id.clone())
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Message not found".to_string()))?;

    if message.user_id != claims.sub {
        return Err((StatusCode::FORBIDDEN, "Not your message".to_string()));
    }

    let channel_id = message.channel_id.clone();

    let mut active_message: message::ActiveModel = message.into();
    active_message.content = Set(payload.content.clone());
    active_message.edited_at = Set(Some(chrono::Utc::now()));

    let updated_message = active_message.update(&state.db).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update message: {e}"),
        )
    })?;

    // Broadcast edit to all subscribers
    let tx = state.get_channel_tx(&channel_id);
    let _ = tx.send(WsServerMessage::MessageEdited {
        id: message_id,
        content: payload.content,
        edited_at: chrono::Utc::now(),
    });

    Ok(Json(updated_message))
}

pub async fn delete_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(message_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let message = message::Entity::find_by_id(message_id.clone())
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Message not found".to_string()))?;

    let channel_id = message.channel_id.clone();

    let has_permission = check_channel_permission(&state, &claims.sub, &channel_id, Permissions::MANAGE_MESSAGES)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission check error: {e}")))?;

    if message.user_id != claims.sub && !has_permission {
        return Err((StatusCode::FORBIDDEN, "Not authorized to delete this message".to_string()));
    }

    let mut active_message: message::ActiveModel = message.into();
    active_message.deleted_at = Set(Some(chrono::Utc::now()));

    active_message.update(&state.db).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to delete message: {e}"),
        )
    })?;

    // Broadcast deletion to all subscribers
    let tx = state.get_channel_tx(&channel_id);
    let _ = tx.send(WsServerMessage::MessageDeleted {
        id: message_id,
        channel_id,
    });

    Ok(StatusCode::NO_CONTENT)
}

pub async fn pin_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(message_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let msg = message::Entity::find_by_id(&message_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Message not found".to_string()))?;

    let channel_id = msg.channel_id.clone();

    let has_permission = check_channel_permission(&state, &claims.sub, &channel_id, Permissions::MANAGE_MESSAGES)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission check error: {e}")))?;

    if !has_permission {
        return Err((StatusCode::FORBIDDEN, "Missing MANAGE_MESSAGES permission".to_string()));
    }
    let pinned_at = chrono::Utc::now().to_rfc3339();
    let pinned_by = claims.sub.clone();

    let mut active: message::ActiveModel = msg.into();
    active.pinned_at = Set(Some(pinned_at.clone()));
    active.pinned_by = Set(Some(pinned_by.clone()));

    active.update(&state.db).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to pin message: {e}"),
        )
    })?;

    let tx = state.get_channel_tx(&channel_id);
    let _ = tx.send(WsServerMessage::MessagePinned {
        channel_id,
        message_id,
        pinned: true,
        pinned_at: Some(pinned_at),
        pinned_by: Some(pinned_by),
    });

    Ok(StatusCode::OK)
}

pub async fn unpin_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(message_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let msg = message::Entity::find_by_id(&message_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Message not found".to_string()))?;

    let channel_id = msg.channel_id.clone();
    
    let has_permission = check_channel_permission(&state, &claims.sub, &channel_id, Permissions::MANAGE_MESSAGES)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission check error: {e}")))?;

    if !has_permission {
        return Err((StatusCode::FORBIDDEN, "Missing MANAGE_MESSAGES permission".to_string()));
    }

    let mut active: message::ActiveModel = msg.into();
    active.pinned_at = Set(None);
    active.pinned_by = Set(None);

    active.update(&state.db).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to unpin message: {e}"),
        )
    })?;

    let tx = state.get_channel_tx(&channel_id);
    let _ = tx.send(WsServerMessage::MessagePinned {
        channel_id,
        message_id,
        pinned: false,
        pinned_at: None,
        pinned_by: None,
    });

    Ok(StatusCode::OK)
}

pub async fn get_pinned_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
) -> Result<Json<Vec<MessageWithReply>>, (StatusCode, String)> {
    let _claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let messages = message::Entity::find()
        .filter(message::Column::ChannelId.eq(&channel_id))
        .filter(message::Column::PinnedAt.is_not_null())
        .order_by_desc(message::Column::PinnedAt)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Reuse logic from get_messages for replies/reactions if needed, 
    // but for pins we'll keep it simple for now or fetch minimal details.
    // Actually, Pins usually show context, so let's fetch reactions/replies.
    
    if messages.is_empty() {
        return Ok(Json(Vec::new()));
    }

    // Reuse the reply/reaction fetching logic from get_messages?
    // Let's refactor get_messages logic or just duplicate it for now to avoid breaking things.
    
    // (Implementation of reply/reaction fetching for pinned messages)
    // ... duplicate logic from get_messages here ...
    let reply_ids: Vec<String> = messages.iter().filter_map(|m| m.reply_to.clone()).collect();
    let replied_map: HashMap<String, Message> = if !reply_ids.is_empty() {
        message::Entity::find()
            .filter(message::Column::Id.is_in(&reply_ids))
            .all(&state.db)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|m| (m.id.clone(), m))
            .collect()
    } else {
        HashMap::new()
    };

    let message_ids: Vec<String> = messages.iter().map(|m| m.id.clone()).collect();
    let reactions = if !message_ids.is_empty() {
        reaction::Entity::find()
            .filter(reaction::Column::MessageId.is_in(&message_ids))
            .all(&state.db)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut reaction_map: HashMap<String, HashMap<String, Vec<String>>> = HashMap::new();
    for r in reactions {
        reaction_map
            .entry(r.message_id)
            .or_default()
            .entry(r.emoji)
            .or_default()
            .push(r.user_id);
    }

    let result: Vec<MessageWithReply> = messages
        .into_iter()
        .map(|msg| {
            let msg_id = msg.id.clone();
            let replied_message = msg.reply_to.as_ref().and_then(|rid| {
                replied_map.get(rid).map(|m| {
                    let truncated = if m.content.len() > 100 {
                        format!("{}…", &m.content[..100])
                    } else {
                        m.content.clone()
                    };
                    RepliedMessage {
                        id: m.id.clone(),
                        content: truncated,
                        user_name: m.user_name.clone(),
                    }
                })
            });

            let reactions = reaction_map
                .remove(&msg_id)
                .unwrap_or_default()
                .into_iter()
                .map(|(emoji, user_ids)| ReactionGroup {
                    count: user_ids.len() as i64,
                    user_ids,
                    emoji,
                })
                .collect();

            MessageWithReply {
                message: msg,
                replied_message,
                reactions,
            }
        })
        .collect();

    Ok(Json(result))
}