use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};

use crate::models::{Message, MessagesQuery};
use crate::state::AppState;

pub async fn get_messages(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
    Query(query): Query<MessagesQuery>,
) -> Result<Json<Vec<Message>>, StatusCode> {
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
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut messages = messages;
    messages.reverse();

    Ok(Json(messages))
}
