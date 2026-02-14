use axum::{extract::State, Json, response::IntoResponse, http::{HeaderMap, StatusCode}};
use sea_orm::*;
use sea_orm::prelude::Expr;
use crate::entities::{server, channel};
use crate::models::{Permissions, ServerInfo, UpdateServerRequest};
use crate::state::AppState;
use crate::routes::audit_logs::create_audit_log;
use crate::routes::auth::extract_claims;
use crate::routes::roles::user_has_permission;
use crate::routes::servers::extract_server_id;

pub async fn get_server_info(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<ServerInfo> {
    let server_id = extract_server_id(&headers);

    let srv = server::Entity::find_by_id(&server_id)
        .one(&state.db)
        .await
        .ok()
        .flatten();

    let (name, description, join_sound_url, leave_sound_url, sound_chance) = match srv {
        Some(s) => (s.name, s.description, s.join_sound_url, s.leave_sound_url, s.sound_chance),
        None => ("SivySpeak Server".to_string(), "Welcome to SivySpeak!".to_string(), None, None, 100),
    };

    let channels_count = channel::Entity::find()
        .filter(channel::Column::ServerId.eq(&server_id))
        .count(&state.db)
        .await
        .unwrap_or(0) as i64;

    let online = state.online_count();

    Json(ServerInfo {
        name,
        description,
        join_sound_url,
        leave_sound_url,
        sound_chance,
        channels: channels_count,
        online,
    })
}

pub async fn update_server_info(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<UpdateServerRequest>,
) -> Result<StatusCode, StatusCode> {
    let server_id = extract_server_id(&headers);
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_SERVER).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    if let Some(name) = payload.name.clone() {
        server::Entity::update_many()
            .col_expr(server::Column::Name, Expr::value(&name))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();

        create_audit_log(
            &state.db,
            &claims.sub,
            &claims.username,
            "UPDATE_SERVER_NAME",
            None,
            Some(&name),
            None,
        ).await;
    }

    if let Some(desc) = payload.description.clone() {
        server::Entity::update_many()
            .col_expr(server::Column::Description, Expr::value(&desc))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();

        create_audit_log(
            &state.db,
            &claims.sub,
            &claims.username,
            "UPDATE_SERVER_DESCRIPTION",
            None,
            None,
            Some(&desc),
        ).await;
    }

    if let Some(url) = payload.join_sound_url.clone() {
        server::Entity::update_many()
            .col_expr(server::Column::JoinSoundUrl, Expr::value(Some(url.clone())))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();

        create_audit_log(
            &state.db,
            &claims.sub,
            &claims.username,
            "UPDATE_JOIN_SOUND",
            None,
            Some("join_sound_url"),
            Some(&url),
        ).await;
    }

    if let Some(url) = payload.leave_sound_url.clone() {
        server::Entity::update_many()
            .col_expr(server::Column::LeaveSoundUrl, Expr::value(Some(url.clone())))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();

        create_audit_log(
            &state.db,
            &claims.sub,
            &claims.username,
            "UPDATE_LEAVE_SOUND",
            None,
            Some("leave_sound_url"),
            Some(&url),
        ).await;
    }

    if let Some(chance) = payload.sound_chance {
        server::Entity::update_many()
            .col_expr(server::Column::SoundChance, Expr::value(chance))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();

        create_audit_log(
            &state.db,
            &claims.sub,
            &claims.username,
            "UPDATE_SOUND_CHANCE",
            None,
            Some("sound_chance"),
            Some(&chance.to_string()),
        ).await;
    }

    Ok(StatusCode::OK)
}
