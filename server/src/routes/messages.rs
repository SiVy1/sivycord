use crate::models::Permissions;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, QueryOrder, QuerySelect};

use crate::{entities::message, models::MessageEdit, routes::roles::user_has_permission};
use crate::models::{Message, MessagesQuery};
use crate::routes::auth;
use crate::state::AppState;

pub async fn get_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    Query(query): Query<MessagesQuery>,
) -> Result<Json<Vec<Message>>, (StatusCode, String)> {
    let _claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    let limit = query.limit.unwrap_or(50).min(100) as u64;

    let mut q = message::Entity::find()
        .filter(message::Column::ChannelId.eq(&channel_id))
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

    Ok(Json(messages))
}

pub async fn edit_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(message_id): Path<String>,
    Json(payload): Json<MessageEdit>,
) -> Result<Json<Message>, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let mut message = message::Entity::find_by_id(message_id.clone())
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Message not found".to_string()))?;

    if message.author_id != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not your message".to_string()));
    }

    use sea_orm::{ActiveModelTrait, Set};

    let mut active_message: message::ActiveModel = message.into();
    active_message.content = Set(payload.content);
    active_message.edited_at = Set(Some(chrono::Utc::now()));

    let updated_message = active_message.update(&state.db).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update message: {e}"),
        )
    })?;

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

    let has_permission = user_has_permission(&state, &claims.user_id, Permissions::MANAGE_MESSAGES)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission check error: {e}")))?;

    if message.author_id != claims.user_id || !has_permission {
        return Err((StatusCode::FORBIDDEN, "Not your message".to_string()));
    }

    message::Entity::delete_by_id(message_id)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}