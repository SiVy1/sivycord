use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rand::Rng;
use serde::Deserialize;
use uuid::Uuid;

use crate::models::{Webhook, WsServerMessage};
use crate::routes::auth;
use crate::state::AppState;

// ─── Request types ───

#[derive(Debug, Deserialize)]
pub struct CreateWebhookRequest {
    pub channel_id: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WebhookMessageRequest {
    pub content: String,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
}

/// Generate a secure webhook token
fn generate_webhook_token() -> String {
    let random_part: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    format!("whk.{}.{}", Uuid::new_v4(), random_part)
}

// ─── Routes ───

/// POST /api/webhooks — create a new webhook for a channel
pub async fn create_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateWebhookRequest>,
) -> Result<(StatusCode, Json<Webhook>), (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    if req.channel_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "channel_id is required".into()));
    }

    let name = req.name.unwrap_or_else(|| "Webhook".to_string());
    if name.is_empty() || name.len() > 32 {
        return Err((StatusCode::BAD_REQUEST, "Name must be 1-32 characters".into()));
    }

    // Verify channel exists
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM channels WHERE id = ?")
            .bind(&req.channel_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "Channel not found".into()));
    }

    let id = Uuid::new_v4().to_string();
    let token = generate_webhook_token();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    sqlx::query(
        "INSERT INTO webhooks (id, channel_id, name, token, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&req.channel_id)
    .bind(&name)
    .bind(&token)
    .bind(&claims.sub)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let webhook = Webhook {
        id,
        channel_id: req.channel_id,
        name,
        avatar_url: None,
        token,
        created_by: claims.sub,
        created_at: now,
    };

    Ok((StatusCode::CREATED, Json(webhook)))
}

/// GET /api/webhooks — list all webhooks
pub async fn list_webhooks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Webhook>>, (StatusCode, String)> {
    auth::extract_claims(&state.jwt_secret, &headers)?;

    let webhooks = sqlx::query_as::<_, Webhook>(
        "SELECT id, channel_id, name, avatar_url, '' as token, created_by, created_at FROM webhooks ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(webhooks))
}

/// DELETE /api/webhooks/:webhook_id — delete a webhook (creator only)
pub async fn delete_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(webhook_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let existing = sqlx::query_as::<_, Webhook>(
        "SELECT id, channel_id, name, avatar_url, token, created_by, created_at FROM webhooks WHERE id = ?",
    )
    .bind(&webhook_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
    .ok_or((StatusCode::NOT_FOUND, "Webhook not found".into()))?;

    if existing.created_by != claims.sub {
        return Err((StatusCode::FORBIDDEN, "Only the webhook creator can delete it".into()));
    }

    sqlx::query("DELETE FROM webhooks WHERE id = ?")
        .bind(&webhook_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/webhooks/:webhook_id/:token — execute webhook (send message, no auth needed)
/// This is the public endpoint that external services call.
pub async fn execute_webhook(
    State(state): State<AppState>,
    Path((webhook_id, token)): Path<(String, String)>,
    Json(req): Json<WebhookMessageRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let webhook = sqlx::query_as::<_, Webhook>(
        "SELECT id, channel_id, name, avatar_url, token, created_by, created_at FROM webhooks WHERE id = ? AND token = ?",
    )
    .bind(&webhook_id)
    .bind(&token)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
    .ok_or((StatusCode::UNAUTHORIZED, "Invalid webhook".into()))?;

    let content = req.content.trim().to_string();
    if content.is_empty() || content.len() > 2000 {
        return Err((StatusCode::BAD_REQUEST, "Content must be 1-2000 characters".into()));
    }

    let display_name = req
        .username
        .unwrap_or_else(|| webhook.name.clone());
    let avatar = req.avatar_url.or(webhook.avatar_url);

    let msg_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let user_name = format!("{} [WEBHOOK]", display_name);

    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, user_name, avatar_url, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&msg_id)
    .bind(&webhook.channel_id)
    .bind(&webhook.id)
    .bind(&user_name)
    .bind(&avatar)
    .bind(&content)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Broadcast via WS
    let broadcast_msg = WsServerMessage::NewMessage {
        id: msg_id.clone(),
        channel_id: webhook.channel_id.clone(),
        user_id: webhook.id,
        user_name,
        avatar_url: avatar,
        content,
        created_at: now,
        is_bot: false,
    };

    let tx = state.get_channel_tx(&webhook.channel_id);
    let _ = tx.send(broadcast_msg);

    Ok(Json(serde_json::json!({ "id": msg_id })))
}
