use axum::{extract::{State, Path}, Json, response::IntoResponse, http::{HeaderMap, StatusCode}};
use serde::Deserialize;
use uuid::Uuid;
use crate::models::{CreateInviteRequest, InviteResponse, JoinRequest, JoinResponse, InviteCode};
use crate::state::AppState;
use crate::token;
use crate::routes::audit_logs::create_audit_log;
use crate::routes::servers::extract_server_id;

pub async fn create_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateInviteRequest>,
) -> Result<(StatusCode, Json<InviteResponse>), StatusCode> {
    let server_id = extract_server_id(&headers);
    let code = token::generate_invite_code();

    sqlx::query("INSERT INTO invite_codes (code, max_uses, server_id) VALUES (?, ?, ?)")
        .bind(&code)
        .bind(req.max_uses)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to insert invite: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let conn_token = crate::models::ConnectionToken {
        host: state.external_host.clone(),
        port: state.external_port,
        invite_code: code.clone(),
    };
    let encoded = token::encode_token(&conn_token);

    Ok((
        StatusCode::CREATED,
        Json(InviteResponse {
            code,
            token: encoded,
        }),
    ))
}

pub async fn join_server(
    State(state): State<AppState>,
    Json(req): Json<JoinRequest>,
) -> Result<Json<JoinResponse>, StatusCode> {
    let invite = sqlx::query_as::<_, crate::models::InviteCode>(
        "SELECT * FROM invite_codes WHERE code = ?",
    )
    .bind(&req.invite_code)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch invite: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let invite = invite.ok_or(StatusCode::NOT_FOUND)?;

    if let Some(max) = invite.max_uses {
        if invite.uses >= max {
            return Err(StatusCode::GONE);
        }
    }

    sqlx::query("UPDATE invite_codes SET uses = uses + 1 WHERE code = ?")
        .bind(&req.invite_code)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to update invite uses: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let user_id = Uuid::new_v4().to_string();

    // Get server name from the invite's server
    let server_name: String = sqlx::query_scalar("SELECT name FROM servers WHERE id = ?")
        .bind(&invite.server_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or_else(|_| "SivySpeak Server".to_string());

    Ok(Json(JoinResponse {
        user_id,
        server_name,
    }))
}

/// Join without invite code — direct connect by host:port
#[derive(Debug, Deserialize)]
pub struct DirectJoinRequest {
    pub display_name: String,
}

pub async fn join_direct(
    Json(_req): Json<DirectJoinRequest>,
) -> Json<JoinResponse> {
    let user_id = Uuid::new_v4().to_string();
    Json(JoinResponse {
        user_id,
        server_name: "SivySpeak Server".to_string(),
    })
}
pub async fn list_invites(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<Vec<crate::models::InviteCode>> {
    let server_id = extract_server_id(&headers);

    let invites: Vec<crate::models::InviteCode> =
        sqlx::query_as("SELECT * FROM invite_codes WHERE server_id = ? ORDER BY created_at DESC")
            .bind(&server_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    Json(invites)
}

pub async fn delete_invite(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> impl IntoResponse {
    sqlx::query("DELETE FROM invite_codes WHERE code = ?")
        .bind(&code)
        .execute(&state.db)
        .await
        .ok();

    create_audit_log(
        &state.db,
        "Admin",
        "Administrator",
        "DELETE_INVITE",
        None,
        Some(&code),
        None,
    ).await;

    StatusCode::OK
}
