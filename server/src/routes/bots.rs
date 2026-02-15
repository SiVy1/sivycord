use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rand::Rng;
use sea_orm::*;
use sea_orm::prelude::Expr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::entities::{bot, channel, message};
use crate::models::Bot;
use crate::routes::auth;
use crate::state::AppState;

// ─── Request / Response types ───

#[derive(Debug, Deserialize)]
pub struct CreateBotRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct CreateBotResponse {
    pub bot: Bot,
    /// The token is only shown once at creation time
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBotRequest {
    pub name: Option<String>,
    pub permissions: Option<i64>,
}

/// Generate a secure random bot token: `bot.<uuid>.<random64>`
fn generate_bot_token() -> String {
    let random_part: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    format!("bot.{}.{}", Uuid::new_v4(), random_part)
}

// ─── Routes ───

/// POST /api/bots — create a new bot (requires MANAGE_SERVER)
pub async fn create_bot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateBotRequest>,
) -> Result<(StatusCode, Json<CreateBotResponse>), (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 32 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Bot name must be 1-32 characters".into(),
        ));
    }

    let bot_id = Uuid::new_v4().to_string();
    let token = generate_bot_token();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_bot = bot::ActiveModel {
        id: Set(bot_id.clone()),
        name: Set(name.clone()),
        avatar_url: Set(None),
        owner_id: Set(claims.sub.clone()),
        token: Set(token.clone()),
        permissions: Set(0),
        created_at: Set(now.clone()),
        server_id: Set("default".to_string()),
    };

    bot::Entity::insert(new_bot)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let bot = Bot {
        id: bot_id,
        name,
        avatar_url: None,
        owner_id: claims.sub,
        token: token.clone(),
        permissions: 0,
        created_at: now,
        server_id: "default".to_string(),
    };

    Ok((StatusCode::CREATED, Json(CreateBotResponse { bot, token })))
}

/// GET /api/bots — list all bots (authenticated users only)
pub async fn list_bots(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Bot>>, (StatusCode, String)> {
    auth::extract_claims(&state.jwt_secret, &headers)?;

    let mut bots: Vec<Bot> = bot::Entity::find()
        .order_by_desc(bot::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Mask tokens
    for b in &mut bots {
        b.token = String::new();
    }

    Ok(Json(bots))
}

/// GET /api/bots/:bot_id — get a single bot
pub async fn get_bot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
) -> Result<Json<Bot>, (StatusCode, String)> {
    auth::extract_claims(&state.jwt_secret, &headers)?;

    let mut b = bot::Entity::find_by_id(&bot_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Bot not found".into()))?;

    b.token = String::new();
    Ok(Json(b))
}

/// PUT /api/bots/:bot_id — update bot name or permissions (owner only)
pub async fn update_bot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
    Json(req): Json<UpdateBotRequest>,
) -> Result<Json<Bot>, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let existing = bot::Entity::find_by_id(&bot_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Bot not found".into()))?;

    if existing.owner_id != claims.sub {
        return Err((StatusCode::FORBIDDEN, "Only the bot owner can update it".into()));
    }

    let new_name = req.name.map(|n| n.trim().to_string()).unwrap_or(existing.name.clone());
    if new_name.is_empty() || new_name.len() > 32 {
        return Err((StatusCode::BAD_REQUEST, "Bot name must be 1-32 characters".into()));
    }

    let new_perms = req.permissions.unwrap_or(existing.permissions);

    bot::Entity::update_many()
        .col_expr(bot::Column::Name, Expr::value(&new_name))
        .col_expr(bot::Column::Permissions, Expr::value(new_perms))
        .filter(bot::Column::Id.eq(&bot_id))
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(Bot {
        id: existing.id,
        name: new_name,
        avatar_url: existing.avatar_url,
        owner_id: existing.owner_id,
        token: String::new(),
        permissions: new_perms,
        created_at: existing.created_at,
        server_id: existing.server_id,
    }))
}

/// DELETE /api/bots/:bot_id — delete a bot (owner only)
pub async fn delete_bot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let existing = bot::Entity::find_by_id(&bot_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Bot not found".into()))?;

    if existing.owner_id != claims.sub {
        return Err((StatusCode::FORBIDDEN, "Only the bot owner can delete it".into()));
    }

    bot::Entity::delete_by_id(&bot_id)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/bots/:bot_id/regenerate-token — regenerate bot token (owner only)
pub async fn regenerate_bot_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let existing = bot::Entity::find_by_id(&bot_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Bot not found".into()))?;

    if existing.owner_id != claims.sub {
        return Err((StatusCode::FORBIDDEN, "Only the bot owner can regenerate the token".into()));
    }

    let new_token = generate_bot_token();

    bot::Entity::update_many()
        .col_expr(bot::Column::Token, Expr::value(&new_token))
        .filter(bot::Column::Id.eq(&bot_id))
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(serde_json::json!({ "token": new_token })))
}

/// POST /api/bots/message — send a message as a bot (bot token auth via Authorization: Bot <token>)
pub async fn bot_send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<BotMessageRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let bot = extract_bot(&state, &headers).await?;

    let content = req.content.trim().to_string();
    if content.is_empty() || content.len() > 2000 {
        return Err((StatusCode::BAD_REQUEST, "Content must be 1-2000 characters".into()));
    }
    if req.channel_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "channel_id is required".into()));
    }

    // Verify channel exists
    let channel_exists = channel::Entity::find_by_id(&req.channel_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if channel_exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "Channel not found".into()));
    }

    let msg_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let bot_user_name = bot.name.clone();

    let new_msg = message::ActiveModel {
        id: Set(msg_id.clone()),
        channel_id: Set(req.channel_id.clone()),
        user_id: Set(bot.id.clone()),
        user_name: Set(bot_user_name.clone()),
        avatar_url: Set(bot.avatar_url.clone()),
        content: Set(content.clone()),
        created_at: Set(now.clone()),
        author_id: Set(bot.id.clone()),
        edited_at: Set(None),
    };

    message::Entity::insert(new_msg)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Broadcast via WS channel
    let broadcast_msg = crate::models::WsServerMessage::NewMessage {
        id: msg_id.clone(),
        channel_id: req.channel_id.clone(),
        user_id: bot.id.clone(),
        user_name: bot_user_name,
        avatar_url: bot.avatar_url,
        content,
        created_at: now,
        is_bot: true,
    };

    let tx = state.get_channel_tx(&req.channel_id);
    let _ = tx.send(broadcast_msg);

    Ok(Json(serde_json::json!({ "id": msg_id })))
}

#[derive(Debug, Deserialize)]
pub struct BotMessageRequest {
    pub channel_id: String,
    pub content: String,
}

/// Extract bot from Authorization: Bot <token> header
pub async fn extract_bot(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Bot, (StatusCode, String)> {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, "Missing Authorization header".into()))?;

    let token = auth.strip_prefix("Bot ").ok_or((
        StatusCode::UNAUTHORIZED,
        "Invalid Authorization format. Use: Bot <token>".into(),
    ))?;

    let b = bot::Entity::find()
        .filter(bot::Column::Token.eq(token))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid bot token".into()))?;

    Ok(b)
}
