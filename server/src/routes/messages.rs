use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};

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
    let limit = query.limit.unwrap_or(50).min(100);

    let messages = if let Some(before) = &query.before {
        sqlx::query_as::<_, Message>(
            "SELECT * FROM messages WHERE channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(&channel_id)
        .bind(before)
        .bind(limit)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, Message>(
            "SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(&channel_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let mut messages = messages;
    messages.reverse();

    Ok(Json(messages))
}
