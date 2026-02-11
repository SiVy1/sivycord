use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use uuid::Uuid;

use crate::models::{CreateInviteRequest, InviteResponse, JoinRequest, JoinResponse};
use crate::state::AppState;
use crate::token;

pub async fn create_invite(
    State(state): State<AppState>,
    Json(req): Json<CreateInviteRequest>,
) -> Result<(StatusCode, Json<InviteResponse>), StatusCode> {
    let code = token::generate_invite_code();

    sqlx::query("INSERT INTO invite_codes (code, max_uses) VALUES (?, ?)")
        .bind(&code)
        .bind(req.max_uses)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let conn_token = crate::models::ConnectionToken {
        host: "localhost".to_string(),
        port: 3000,
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
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_id = Uuid::new_v4().to_string();

    Ok(Json(JoinResponse {
        user_id,
        server_name: "SiVyCord Server".to_string(),
    }))
}

/// Join without invite code — direct connect by host:port
#[derive(Debug, Deserialize)]
pub struct DirectJoinRequest {
    pub display_name: String,
}

pub async fn join_direct(
    Json(req): Json<DirectJoinRequest>,
) -> Json<JoinResponse> {
    let user_id = Uuid::new_v4().to_string();
    Json(JoinResponse {
        user_id,
        server_name: "SiVyCord Server".to_string(),
    })
}

