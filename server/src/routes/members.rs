use axum::{extract::{State, Path}, Json, response::IntoResponse, http::StatusCode};
use crate::models::{Ban, BanRequest};
use crate::state::AppState;
use crate::routes::audit_logs::create_audit_log;

pub async fn list_bans(State(state): State<AppState>) -> Json<Vec<Ban>> {
    let bans: Vec<Ban> = sqlx::query_as("SELECT * FROM bans ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    Json(bans)
}

pub async fn ban_member(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(payload): Json<BanRequest>,
) -> impl IntoResponse {
    // In a real app, we'd get the acting user from auth middleware.
    // For now, we'll assume a "System" or "Admin" action.
    
    // Get user name for the ban record
    let user_name: String = sqlx::query_scalar("SELECT username FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or_else(|_| "Unknown User".to_string());

    sqlx::query("INSERT OR REPLACE INTO bans (user_id, user_name, reason, banned_by) VALUES (?, ?, ?, ?)")
        .bind(&user_id)
        .bind(&user_name)
        .bind(&payload.reason)
        .bind("Admin")
        .execute(&state.db)
        .await
        .ok();

    create_audit_log(
        &state.db,
        "Admin",
        "Administrator",
        "BAN_USER",
        Some(&user_id),
        Some(&user_name),
        payload.reason.as_deref(),
    ).await;

    StatusCode::OK
}

pub async fn unban_member(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    sqlx::query("DELETE FROM bans WHERE user_id = ?")
        .bind(user_id)
        .execute(&state.db)
        .await
        .ok();

    StatusCode::OK
}

pub async fn kick_member(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let user_name: String = sqlx::query_scalar("SELECT username FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or_else(|_| "Unknown User".to_string());

    create_audit_log(
        &state.db,
        "Admin",
        "Administrator",
        "KICK_USER",
        Some(&user_id),
        Some(&user_name),
        None,
    ).await;

    StatusCode::OK
}
