use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, QueryOrder, QuerySelect, Set};
use sea_orm::sea_query::{Expr, Func};
use uuid::Uuid;

use crate::entities::channel;
use crate::models::{Channel, CreateChannelRequest};
use crate::routes::auth;
use crate::routes::servers::extract_server_id;
use crate::state::AppState;

const MAX_CHANNEL_NAME: usize = 64;
const MAX_DESCRIPTION: usize = 256;

pub async fn list_channels(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Channel>>, (StatusCode, String)> {
    let _claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    let server_id = extract_server_id(&headers);

    let channels = channel::Entity::find()
        .filter(channel::Column::ServerId.eq(&server_id))
        .order_by_asc(channel::Column::Position)
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to list channels: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?;

    Ok(Json(channels))
}

pub async fn create_channel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateChannelRequest>,
) -> Result<(StatusCode, Json<Channel>), (StatusCode, String)> {
    let _claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    let server_id = extract_server_id(&headers);

    // Validate name
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > MAX_CHANNEL_NAME {
        return Err((StatusCode::BAD_REQUEST, "Invalid channel name length".into()));
    }

    // Sanitize: only allow letters, numbers, hyphens, underscores
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ' ')
    {
        return Err((StatusCode::BAD_REQUEST, "Invalid characters in channel name".into()));
    }

    // Validate channel_type
    let channel_type = req.channel_type.trim().to_string();
    if channel_type != "text" && channel_type != "voice" {
        return Err((StatusCode::BAD_REQUEST, "Invalid channel type".into()));
    }

    // Validate description length
    let description = req
        .description
        .chars()
        .take(MAX_DESCRIPTION)
        .collect::<String>();

    // Check for duplicate name within same server (case-insensitive)
    let existing = channel::Entity::find()
        .filter(
            Expr::expr(Func::lower(Expr::col(channel::Column::Name)))
                .eq(name.to_lowercase())
        )
        .filter(channel::Column::ChannelType.eq(&channel_type))
        .filter(channel::Column::ServerId.eq(&server_id))
        .one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to check duplicate channel: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?;

    if existing.is_some() {
        return Err((StatusCode::CONFLICT, "Channel already exists".into()));
    }

    let id = Uuid::new_v4().to_string();

    let max_pos: Option<i64> = channel::Entity::find()
        .filter(channel::Column::ServerId.eq(&server_id))
        .select_only()
        .column_as(Expr::col(channel::Column::Position).max(), "max_pos")
        .into_tuple::<Option<i64>>()
        .one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get max position: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?
        .flatten();

    let position = max_pos.unwrap_or(0) + 1;
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_channel = channel::ActiveModel {
        id: Set(id.clone()),
        name: Set(name.clone()),
        description: Set(description.clone()),
        position: Set(position),
        created_at: Set(now.clone()),
        channel_type: Set(channel_type.clone()),
        encrypted: Set(false),
        server_id: Set(server_id.clone()),
    };

    channel::Entity::insert(new_channel)
        .exec(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create channel: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?;

    let ch = Channel {
        id,
        name,
        description,
        position,
        created_at: now,
        channel_type,
        encrypted: false,
        server_id,
    };

    Ok((StatusCode::CREATED, Json(ch)))
}
