use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, QueryOrder, QuerySelect};

use crate::entities::message;
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
