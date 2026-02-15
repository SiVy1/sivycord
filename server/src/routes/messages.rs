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
use crate::routes::{auth, roles::user_has_permission};
use crate::state::AppState;

pub async fn get_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    Query(query): Query<MessagesQuery>,
) -> Result<Json<Vec<MessageWithReply>>, (StatusCode, String)> {
    let _claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    let limit = query.limit.unwrap_or(50).min(100) as u64;

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

    let has_permission = user_has_permission(&state, &claims.sub, Permissions::MANAGE_MESSAGES)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission check error: {e}")))?;

    if message.user_id != claims.sub && !has_permission {
        return Err((StatusCode::FORBIDDEN, "Not authorized to delete this message".to_string()));
    }

    let channel_id = message.channel_id.clone();

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