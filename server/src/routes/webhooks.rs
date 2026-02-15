use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rand::Rng;
use sea_orm::*;
use serde::Deserialize;
use uuid::Uuid;

use crate::entities::{channel, message, webhook};
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
    let exists = channel::Entity::find_by_id(&req.channel_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "Channel not found".into()));
    }

    let id = Uuid::new_v4().to_string();
    let token = generate_webhook_token();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_webhook = webhook::ActiveModel {
        id: Set(id.clone()),
        channel_id: Set(req.channel_id.clone()),
        name: Set(name.clone()),
        avatar_url: Set(None),
        token: Set(token.clone()),
        created_by: Set(claims.sub.clone()),
        created_at: Set(now.clone()),
    };

    webhook::Entity::insert(new_webhook)
        .exec(&state.db)
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

    let mut webhooks: Vec<Webhook> = webhook::Entity::find()
        .order_by_desc(webhook::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Mask tokens
    for w in &mut webhooks {
        w.token = String::new();
    }

    Ok(Json(webhooks))
}

/// DELETE /api/webhooks/:webhook_id — delete a webhook (creator only)
pub async fn delete_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(webhook_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let existing = webhook::Entity::find_by_id(&webhook_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Webhook not found".into()))?;

    if existing.created_by != claims.sub {
        return Err((StatusCode::FORBIDDEN, "Only the webhook creator can delete it".into()));
    }

    webhook::Entity::delete_by_id(&webhook_id)
        .exec(&state.db)
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
    let wh = webhook::Entity::find()
        .filter(webhook::Column::Id.eq(&webhook_id))
        .filter(webhook::Column::Token.eq(&token))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid webhook".into()))?;

    let content = req.content.trim().to_string();
    if content.is_empty() || content.len() > 2000 {
        return Err((StatusCode::BAD_REQUEST, "Content must be 1-2000 characters".into()));
    }

    let display_name = req
        .username
        .unwrap_or_else(|| wh.name.clone());
    let avatar = req.avatar_url.or(wh.avatar_url);

    let msg_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let user_name = format!("{} [WEBHOOK]", display_name);

    let new_msg = message::ActiveModel {
        id: Set(msg_id.clone()),
        channel_id: Set(wh.channel_id.clone()),
        user_id: Set(wh.id.clone()),
        user_name: Set(user_name.clone()),
        avatar_url: Set(avatar.clone()),
        content: Set(content.clone()),
        created_at: Set(now.clone()),
        edited_at: Set(None),
        deleted_at: Set(None),
        reply_to: Set(None),
        pinned_at: Set(None),
        pinned_by: Set(None),
    };

    message::Entity::insert(new_msg)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Broadcast via WS
    let broadcast_msg = WsServerMessage::NewMessage {
        id: msg_id.clone(),
        channel_id: wh.channel_id.clone(),
        user_id: wh.id,
        user_name,
        avatar_url: avatar,
        content,
        created_at: now,
        is_bot: false,
        reply_to: None,
        replied_message: None,
    };

    let tx = state.get_channel_tx(&wh.channel_id);
    let _ = tx.send(broadcast_msg);

    Ok(Json(serde_json::json!({ "id": msg_id })))
}
