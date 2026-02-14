use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

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

    sqlx::query(
        "INSERT INTO user_keys (user_id, public_key, key_type, created_at) VALUES (?, ?, 'x25519', ?)
         ON CONFLICT(user_id, key_type) DO UPDATE SET public_key = excluded.public_key, created_at = excluded.created_at",
    )
    .bind(&claims.sub)
    .bind(&pk)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::OK)
}

/// GET /api/keys/:user_id — get a user's public key
pub async fn get_user_key(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<UserPublicKey>, (StatusCode, String)> {
    let key = sqlx::query_as::<_, UserPublicKey>(
        "SELECT user_id, public_key, key_type, created_at FROM user_keys WHERE user_id = ? AND key_type = 'x25519'",
    )
    .bind(&user_id)
    .fetch_optional(&state.db)
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
    let encrypted: i64 = sqlx::query_scalar(
        "SELECT COALESCE(encrypted, 0) FROM channels WHERE id = ?",
    )
    .bind(&channel_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
    .unwrap_or(0);

    // Get keys of all users who posted in this channel
    let keys = sqlx::query_as::<_, UserPublicKey>(
        "SELECT DISTINCT uk.user_id, uk.public_key, uk.key_type, uk.created_at
         FROM user_keys uk
         INNER JOIN messages m ON m.user_id = uk.user_id
         WHERE m.channel_id = ? AND uk.key_type = 'x25519'",
    )
    .bind(&channel_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(ChannelKeysResponse {
        channel_id,
        encrypted: encrypted != 0,
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

    sqlx::query("UPDATE channels SET encrypted = ? WHERE id = ?")
        .bind(if req.encrypted { 1i64 } else { 0i64 })
        .bind(&channel_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::OK)
}
