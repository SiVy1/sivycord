use axum::{extract::{State, Path}, Json, http::{HeaderMap, StatusCode}};
use crate::models::{Ban, BanRequest, Permissions};
use crate::state::AppState;
use crate::routes::audit_logs::create_audit_log;
use crate::routes::auth::extract_claims;
use crate::routes::roles::user_has_permission;
use crate::routes::servers::extract_server_id;

pub async fn list_bans(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Ban>>, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;
    if !user_has_permission(&state, &claims.sub, Permissions::BAN_MEMBERS).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    let server_id = extract_server_id(&headers);

    let bans: Vec<Ban> = sqlx::query_as("SELECT * FROM bans WHERE server_id = ? ORDER BY created_at DESC")
        .bind(&server_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    Ok(Json(bans))
}

pub async fn ban_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(payload): Json<BanRequest>,
) -> Result<StatusCode, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;
    if !user_has_permission(&state, &claims.sub, Permissions::BAN_MEMBERS).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    let server_id = extract_server_id(&headers);

    let user_name: String = sqlx::query_scalar("SELECT username FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or_else(|_| "Unknown User".to_string());

    sqlx::query("INSERT OR REPLACE INTO bans (user_id, user_name, reason, banned_by, server_id) VALUES (?, ?, ?, ?, ?)")
        .bind(&user_id)
        .bind(&user_name)
        .bind(&payload.reason)
        .bind(&claims.username)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();

    // Remove from server members
    sqlx::query("DELETE FROM server_members WHERE server_id = ? AND user_id = ?")
        .bind(&server_id)
        .bind(&user_id)
        .execute(&state.db)
        .await
        .ok();

    create_audit_log(
        &state.db,
        &claims.sub,
        &claims.username,
        "BAN_USER",
        Some(&user_id),
        Some(&user_name),
        payload.reason.as_deref(),
    ).await;

    Ok(StatusCode::OK)
}

pub async fn unban_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;
    if !user_has_permission(&state, &claims.sub, Permissions::BAN_MEMBERS).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    let user_name: String = sqlx::query_scalar("SELECT username FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or_else(|_| "Unknown User".to_string());

    sqlx::query("DELETE FROM bans WHERE user_id = ?")
        .bind(&user_id)
        .execute(&state.db)
        .await
        .ok();

    create_audit_log(
        &state.db,
        &claims.sub,
        &claims.username,
        "UNBAN_USER",
        Some(&user_id),
        Some(&user_name),
        None,
    ).await;

    Ok(StatusCode::OK)
}

pub async fn kick_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;
    if !user_has_permission(&state, &claims.sub, Permissions::KICK_MEMBERS).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    let user_name: String = sqlx::query_scalar("SELECT username FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or_else(|_| "Unknown User".to_string());

    create_audit_log(
        &state.db,
        &claims.sub,
        &claims.username,
        "KICK_USER",
        Some(&user_id),
        Some(&user_name),
        None,
    ).await;

    Ok(StatusCode::OK)
}
