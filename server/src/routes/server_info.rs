use axum::{extract::State, Json, response::IntoResponse, http::{HeaderMap, StatusCode}};
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

    let settings: (String, String, Option<String>, Option<String>, i64) = sqlx::query_as(
        "SELECT name, description, join_sound_url, leave_sound_url, sound_chance FROM servers WHERE id = ?",
    )
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or_else(|_| ("SivySpeak Server".to_string(), "Welcome to SivySpeak!".to_string(), None, None, 100));

    let channels: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE server_id = ?")
        .bind(&server_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let online = state.online_count();

    Json(ServerInfo {
        name: settings.0,
        description: settings.1,
        join_sound_url: settings.2,
        leave_sound_url: settings.3,
        sound_chance: settings.4,
        channels,
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

    if let Some(name) = payload.name.clone() {
        sqlx::query("UPDATE servers SET name = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&name)
            .bind(&server_id)
            .execute(&state.db)
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
        sqlx::query("UPDATE servers SET description = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&desc)
            .bind(&server_id)
            .execute(&state.db)
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
        sqlx::query("UPDATE servers SET join_sound_url = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&url)
            .bind(&server_id)
            .execute(&state.db)
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
        sqlx::query("UPDATE servers SET leave_sound_url = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&url)
            .bind(&server_id)
            .execute(&state.db)
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
        sqlx::query("UPDATE servers SET sound_chance = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(chance)
            .bind(&server_id)
            .execute(&state.db)
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
