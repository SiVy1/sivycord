use axum::{extract::{State, Path}, Json, response::IntoResponse, http::{HeaderMap, StatusCode}};
use sea_orm::*;
use serde::Deserialize;
use uuid::Uuid;
use crate::entities::{invite_code, server};
use crate::models::{CreateInviteRequest, InviteResponse, JoinRequest, JoinResponse};
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
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_invite = invite_code::ActiveModel {
        code: Set(code.clone()),
        created_at: Set(now),
        uses: Set(0),
        max_uses: Set(req.max_uses),
        server_id: Set(server_id),
    };

    invite_code::Entity::insert(new_invite)
        .exec(&state.db)
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
    let invite = invite_code::Entity::find_by_id(&req.invite_code)
        .one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch invite: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;

    if let Some(max) = invite.max_uses {
        if invite.uses >= max {
            return Err(StatusCode::GONE);
        }
    }

    // Increment uses
    let mut update: invite_code::ActiveModel = invite.clone().into();
    update.uses = Set(invite.uses + 1);
    invite_code::Entity::update(update)
        .exec(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to update invite uses: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let user_id = Uuid::new_v4().to_string();

    // Get server name from the invite's server
    let server_name = server::Entity::find_by_id(&invite.server_id)
        .one(&state.db)
        .await
        .ok()
        .flatten()
        .map(|s| s.name)
        .unwrap_or_else(|| "SivySpeak Server".to_string());

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

    let invites = invite_code::Entity::find()
        .filter(invite_code::Column::ServerId.eq(&server_id))
        .order_by_desc(invite_code::Column::CreatedAt)
        .all(&state.db)
        .await
        .unwrap_or_default();

    Json(invites)
}

pub async fn delete_invite(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> impl IntoResponse {
    invite_code::Entity::delete_by_id(&code)
        .exec(&state.db)
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
