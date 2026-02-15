use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::*;
use serde::Deserialize;
use uuid::Uuid;

use crate::entities::{message, reaction, user};
use crate::models::{Permissions, WsServerMessage};
use crate::routes::{auth, roles::user_has_permission};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct AddReactionRequest {
    pub emoji: String,
}

pub async fn add_reaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(message_id): Path<String>,
    Json(req): Json<AddReactionRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    let emoji = req.emoji.trim();
    if emoji.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Emoji cannot be empty".into()));
    }

    // Verify message and get channel_id
    let msg = message::Entity::find_by_id(&message_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Message not found".into()))?;

    // Check permission
    if !user_has_permission(&state, &claims.sub, Permissions::ADD_REACTIONS)
        .await
        .map_err(|e| (e, "Permission check failed".to_string()))?
    {
        return Err((StatusCode::FORBIDDEN, "ADD_REACTIONS permission required".into()));
    }

    let reaction_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_reaction = reaction::ActiveModel {
        id: Set(reaction_id),
        message_id: Set(message_id.clone()),
        user_id: Set(claims.sub.clone()),
        emoji: Set(emoji.to_string()),
        created_at: Set(now),
    };

    // Use on_conflict to ignore duplicates
    let result = reaction::Entity::insert(new_reaction)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([
                reaction::Column::MessageId,
                reaction::Column::UserId,
                reaction::Column::Emoji,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec(&state.db)
        .await;

    match result {
        Ok(_) => {
            // Get user_name for broadcast
            let u = user::Entity::find_by_id(&claims.sub)
                .one(&state.db)
                .await
                .ok()
                .flatten();
            let user_name = u.map(|u| u.username).unwrap_or_else(|| "Unknown".to_string());

            let broadcast_msg = WsServerMessage::ReactionAdd {
                message_id,
                channel_id: msg.channel_id.clone(),
                user_id: claims.sub,
                user_name,
                emoji: emoji.to_string(),
            };

            let tx = state.get_channel_tx(&msg.channel_id);
            let _ = tx.send(broadcast_msg);

            Ok(StatusCode::CREATED)
        }
        Err(_) => {
           // If it failed (likely due to conflict), we just return OK as it's already there
           Ok(StatusCode::OK)
        }
    }
}

pub async fn remove_reaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((message_id, emoji)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    // Verify message and get channel_id
    let msg = message::Entity::find_by_id(&message_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Message not found".into()))?;

    let res = reaction::Entity::delete_many()
        .filter(reaction::Column::MessageId.eq(&message_id))
        .filter(reaction::Column::UserId.eq(&claims.sub))
        .filter(reaction::Column::Emoji.eq(&emoji))
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if res.rows_affected > 0 {
        let broadcast_msg = WsServerMessage::ReactionRemove {
            message_id,
            channel_id: msg.channel_id.clone(),
            user_id: claims.sub,
            emoji,
        };

        let tx = state.get_channel_tx(&msg.channel_id);
        let _ = tx.send(broadcast_msg);
    }

    Ok(StatusCode::NO_CONTENT)
}
