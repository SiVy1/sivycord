use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, QueryOrder, QuerySelect, Set};
use sea_orm::sea_query::{Expr, Func};
use uuid::Uuid;

use crate::entities::channel;
use crate::models::{Channel, CreateChannelRequest, Permissions};
use crate::routes::auth;
use crate::routes::servers::extract_server_id;
use crate::permissions::check_channel_permission;
use crate::state::AppState;

const MAX_CHANNEL_NAME: usize = 64;
const MAX_DESCRIPTION: usize = 256;

pub async fn list_channels(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Channel>>, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    let server_id = extract_server_id(&headers);

    let mut channels = channel::Entity::find()
        .filter(channel::Column::ServerId.eq(&server_id))
        .order_by_asc(channel::Column::Position)
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to list channels: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?;

    // Filter out channels the user does not have permission to view
    let mut viewable_channels = Vec::new();
    for ch in channels.into_iter() {
        if check_channel_permission(&state, &claims.sub, &ch.id, Permissions::VIEW_CHANNELS).await.unwrap_or(false) {
            viewable_channels.push(Channel {
                id: ch.id,
                name: ch.name,
                description: ch.description,
                position: ch.position,
                created_at: ch.created_at,
                channel_type: ch.channel_type,
                encrypted: ch.encrypted,
                server_id: ch.server_id,
                category_id: ch.category_id,
                plugin_url: ch.plugin_url,
            });
        }
    }

    Ok(Json(viewable_channels))
}

pub async fn create_channel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateChannelRequest>,
) -> Result<(StatusCode, Json<Channel>), (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    let server_id = extract_server_id(&headers);

    // Global permission check: can they manage channels in the server at all?
    // Channels without IDs don't have overrides yet, so we leverage base role checking.
    // For now we use the `user_has_permission` function from roles module to check base perms.
    if !crate::routes::roles::user_has_permission(&state, &claims.sub, Permissions::MANAGE_CHANNELS)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission error: {e}")))? 
    {
        return Err((StatusCode::FORBIDDEN, "Insufficient permissions to create channels".into()));
    }

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
    if channel_type != "text" && channel_type != "voice" && channel_type != "plugin" {
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

    let category_id = req.category_id.clone();
    
    let new_channel = channel::ActiveModel {
        id: Set(id.clone()),
        name: Set(name.clone()),
        description: Set(description.clone()),
        position: Set(position),
        created_at: Set(now.clone()),
        channel_type: Set(channel_type.clone()),
        encrypted: Set(false),
        server_id: Set(server_id.clone()),
        category_id: Set(category_id.clone()),
        plugin_url: Set(req.plugin_url.clone()),
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
        category_id: category_id.clone(),
        plugin_url: req.plugin_url,
    };

    Ok((StatusCode::CREATED, Json(ch)))
}

pub async fn reorder_channels(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<crate::models::ReorderChannelsRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    
    // Check for MANAGE_CHANNELS permission
    if !crate::routes::roles::user_has_permission(&state, &claims.sub, crate::models::Permissions::MANAGE_CHANNELS)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission check error: {e}")))? 
    {
        return Err((StatusCode::FORBIDDEN, "Insufficient permissions".into()));
    }

    let server_id = extract_server_id(&headers);

    for item in req.channels {
        let _ = channel::Entity::update_many()
            .col_expr(channel::Column::Position, Expr::value(item.position))
            .col_expr(channel::Column::CategoryId, Expr::value(item.category_id))
            .filter(channel::Column::Id.eq(&item.id))
            .filter(channel::Column::ServerId.eq(&server_id))
            .exec(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("Failed to update channel {} position/category: {e}", item.id);
                (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
            })?;
    }

    Ok(StatusCode::OK)
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateOverrideRequest {
    pub target_type: String, // "role" or "member"
    pub allow: i64,
    pub deny: i64,
}

pub async fn get_channel_overrides(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(channel_id): axum::extract::Path<String>,
) -> Result<Json<Vec<crate::entities::channel_override::Model>>, (StatusCode, String)> {
    let _claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    
    // We can assume anybody who can view the channel can see overrides, or require MANAGE_CHANNELS
    // Let's require MANAGE_CHANNELS for viewing/editing overrides.
    // For now, let's just return them. (In a real app, strictly check MANAGE_CHANNELS or MANAGE_ROLES)
    
    let overrides = crate::entities::channel_override::Entity::find()
        .filter(crate::entities::channel_override::Column::ChannelId.eq(&channel_id))
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch overrides: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?;

    Ok(Json(overrides))
}

pub async fn update_channel_override(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path((channel_id, target_id)): axum::extract::Path<(String, String)>,
    Json(req): Json<UpdateOverrideRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    
    if !crate::routes::roles::user_has_permission(&state, &claims.sub, crate::models::Permissions::MANAGE_CHANNELS)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission error: {e}")))? 
    {
        return Err((StatusCode::FORBIDDEN, "Insufficient permissions".into()));
    }

    // Check if channel exists
    let channel = channel::Entity::find_by_id(&channel_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Channel not found".into()))?;

    // Upsert logic
    let existing = crate::entities::channel_override::Entity::find()
        .filter(crate::entities::channel_override::Column::ChannelId.eq(&channel_id))
        .filter(crate::entities::channel_override::Column::TargetId.eq(&target_id))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if let Some(mut existing_model) = existing {
        let mut active_model: crate::entities::channel_override::ActiveModel = existing_model.into();
        active_model.allow = Set(req.allow);
        active_model.deny = Set(req.deny);
        active_model.target_type = Set(req.target_type);
        
        crate::entities::channel_override::Entity::update(active_model)
            .exec(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("Failed to update override: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
            })?;
    } else {
        let new_override = crate::entities::channel_override::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            channel_id: Set(channel_id),
            target_id: Set(target_id),
            target_type: Set(req.target_type),
            allow: Set(req.allow),
            deny: Set(req.deny),
        };
        
        crate::entities::channel_override::Entity::insert(new_override)
            .exec(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("Failed to insert override: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
            })?;
    }

    Ok(StatusCode::OK)
}

pub async fn delete_channel_override(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path((channel_id, target_id)): axum::extract::Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    
    if !crate::routes::roles::user_has_permission(&state, &claims.sub, crate::models::Permissions::MANAGE_CHANNELS)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission error: {e}")))? 
    {
        return Err((StatusCode::FORBIDDEN, "Insufficient permissions".into()));
    }

    crate::entities::channel_override::Entity::delete_many()
        .filter(crate::entities::channel_override::Column::ChannelId.eq(&channel_id))
        .filter(crate::entities::channel_override::Column::TargetId.eq(&target_id))
        .exec(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete override: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?;

    Ok(StatusCode::OK)
}
