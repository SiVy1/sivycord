use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use uuid::Uuid;

use crate::models::{Channel, CreateChannelRequest};
use crate::routes::servers::extract_server_id;
use crate::state::AppState;

const MAX_CHANNEL_NAME: usize = 64;
const MAX_DESCRIPTION: usize = 256;

pub async fn list_channels(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Channel>>, StatusCode> {
    let server_id = extract_server_id(&headers);

    let channels = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC",
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list channels: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(channels))
}

pub async fn create_channel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateChannelRequest>,
) -> Result<(StatusCode, Json<Channel>), StatusCode> {
    let server_id = extract_server_id(&headers);

    // Validate name
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > MAX_CHANNEL_NAME {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Sanitize: only allow letters, numbers, hyphens, underscores
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ' ')
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Validate channel_type
    let channel_type = req.channel_type.trim().to_string();
    if channel_type != "text" && channel_type != "voice" {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Validate description length
    let description = req
        .description
        .chars()
        .take(MAX_DESCRIPTION)
        .collect::<String>();

    // Check for duplicate name within same server
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM channels WHERE LOWER(name) = LOWER(?) AND channel_type = ? AND server_id = ?")
            .bind(&name)
            .bind(&channel_type)
            .bind(&server_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("Failed to check duplicate channel: {e}");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

    if existing.is_some() {
        return Err(StatusCode::CONFLICT);
    }

    let id = Uuid::new_v4().to_string();

    let max_pos: Option<i64> =
        sqlx::query_scalar("SELECT MAX(position) FROM channels WHERE server_id = ?")
            .bind(&server_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("Failed to get max position: {e}");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    let position = max_pos.unwrap_or(0) + 1;

    sqlx::query("INSERT INTO channels (id, name, description, position, channel_type, server_id) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .bind(position)
        .bind(&channel_type)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create channel: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let channel = Channel {
        id,
        name,
        description,
        position,
        created_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        channel_type,
        encrypted: false,
        server_id,
    };

    Ok((StatusCode::CREATED, Json(channel)))
}
