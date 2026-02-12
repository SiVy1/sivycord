use axum::{extract::State, Json, response::IntoResponse, http::StatusCode};
use crate::models::{ServerInfo, UpdateServerRequest};
use crate::state::AppState;
use crate::routes::audit_logs::create_audit_log;

pub async fn get_server_info(State(state): State<AppState>) -> Json<ServerInfo> {
    let settings: (String, String) = sqlx::query_as("SELECT server_name, server_description FROM server_settings WHERE id = 1")
        .fetch_one(&state.db)
        .await
        .unwrap_or_else(|_| ("SiVyCord Server".to_string(), "Welcome to SiVyCord!".to_string()));

    let channels: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channels")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let online = state.online_count();

    Json(ServerInfo {
        name: settings.0,
        description: settings.1,
        channels,
        online,
    })
}

pub async fn update_server_info(
    State(state): State<AppState>,
    Json(payload): Json<UpdateServerRequest>,
) -> impl IntoResponse {
    if let Some(name) = payload.name.clone() {
        sqlx::query("UPDATE server_settings SET server_name = ?, updated_at = datetime('now') WHERE id = 1")
            .bind(&name)
            .execute(&state.db)
            .await
            .ok();
        
        create_audit_log(
            &state.db,
            "Admin",
            "Administrator",
            "UPDATE_SERVER_NAME",
            None,
            Some(&name),
            None,
        ).await;
    }

    if let Some(desc) = payload.description.clone() {
        sqlx::query("UPDATE server_settings SET server_description = ?, updated_at = datetime('now') WHERE id = 1")
            .bind(&desc)
            .execute(&state.db)
            .await
            .ok();

        create_audit_log(
            &state.db,
            "Admin",
            "Administrator",
            "UPDATE_SERVER_DESCRIPTION",
            None,
            None,
            Some(&desc),
        ).await;
    }

    StatusCode::OK
}
