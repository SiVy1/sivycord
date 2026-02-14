use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::*;
use sea_orm::prelude::Expr;
use serde::{Deserialize, Serialize};

use crate::entities::{channel, message, user_key};
use crate::models::UserPublicKey;
use crate::routes::auth;
use crate::state::AppState;

// ─── Request / Response ───

#[derive(Debug, Deserialize)]
pub struct UploadKeyRequest {
    pub public_key: String,
}

#[derive(Debug, Serialize)]
pub struct ChannelKeysResponse {
    pub channel_id: String,
    pub encrypted: bool,
    pub keys: Vec<UserPublicKey>,
}

#[derive(Debug, Deserialize)]
pub struct SetChannelEncryptedRequest {
    pub encrypted: bool,
}

// ─── Routes ───

/// PUT /api/keys — upload/update current user's public key
pub async fn upload_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UploadKeyRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let pk = req.public_key.trim().to_string();
    if pk.is_empty() || pk.len() > 256 {
        return Err((StatusCode::BAD_REQUEST, "Invalid public key".into()));
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Delete then insert for cross-DB upsert
    user_key::Entity::delete_many()
        .filter(user_key::Column::UserId.eq(&claims.sub))
        .filter(user_key::Column::KeyType.eq("x25519"))
        .exec(&state.db)
        .await
        .ok();

    let new_key = user_key::ActiveModel {
        user_id: Set(claims.sub.clone()),
        public_key: Set(pk),
        key_type: Set("x25519".to_string()),
        created_at: Set(now),
    };

    user_key::Entity::insert(new_key)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::OK)
}

/// GET /api/keys/:user_id — get a user's public key
pub async fn get_user_key(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<UserPublicKey>, (StatusCode, String)> {
    let key = user_key::Entity::find()
        .filter(user_key::Column::UserId.eq(&user_id))
        .filter(user_key::Column::KeyType.eq("x25519"))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "No public key found for user".into()))?;

    Ok(Json(key))
}

/// GET /api/channels/:channel_id/keys — get all public keys for members who have been active in a channel
pub async fn get_channel_keys(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
) -> Result<Json<ChannelKeysResponse>, (StatusCode, String)> {
    auth::extract_claims(&state.jwt_secret, &headers)?;

    // Check if channel is encrypted
    let ch = channel::Entity::find_by_id(&channel_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let encrypted = ch.map(|c| c.encrypted).unwrap_or(false);

    // Get distinct user_ids who posted in this channel
    let user_ids: Vec<String> = message::Entity::find()
        .filter(message::Column::ChannelId.eq(&channel_id))
        .select_only()
        .column(message::Column::UserId)
        .distinct()
        .into_tuple()
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Get keys for those users
    let keys: Vec<UserPublicKey> = if user_ids.is_empty() {
        vec![]
    } else {
        user_key::Entity::find()
            .filter(user_key::Column::UserId.is_in(user_ids))
            .filter(user_key::Column::KeyType.eq("x25519"))
            .all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
    };

    Ok(Json(ChannelKeysResponse {
        channel_id,
        encrypted,
        keys,
    }))
}

/// PUT /api/channels/:channel_id/encrypted — toggle E2E encryption for a channel
pub async fn set_channel_encrypted(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    Json(req): Json<SetChannelEncryptedRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    // Check MANAGE_CHANNELS permission
    use crate::models::Permissions;
    use crate::routes::roles::user_has_permission;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_CHANNELS)
        .await
        .map_err(|e| (e, "Permission check failed".to_string()))?
    {
        return Err((StatusCode::FORBIDDEN, "MANAGE_CHANNELS required".into()));
    }

    channel::Entity::update_many()
        .col_expr(channel::Column::Encrypted, Expr::value(req.encrypted))
        .filter(channel::Column::Id.eq(&channel_id))
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::OK)
}
