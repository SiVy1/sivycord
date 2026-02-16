use axum::{extract::{State, Path}, Json, http::{HeaderMap, StatusCode}};
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, QueryOrder, Set, ActiveModelTrait};
use crate::{entities::{ban, server_member, user}, models::TimeoutRequest, routes::auth::UserInfo};
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

    let bans: Vec<Ban> = ban::Entity::find()
        .filter(ban::Column::ServerId.eq(&server_id))
        .order_by_desc(ban::Column::CreatedAt)
        .all(&state.db)
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

    let user_name = user::Entity::find_by_id(&user_id)
        .one(&state.db)
        .await
        .ok()
        .flatten()
        .map(|u| u.username)
        .unwrap_or_else(|| "Unknown User".to_string());

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Upsert ban
    let new_ban = ban::ActiveModel {
        user_id: Set(user_id.clone()),
        user_name: Set(user_name.clone()),
        reason: Set(payload.reason.clone()),
        banned_by: Set(claims.username.clone()),
        created_at: Set(now),
        server_id: Set(server_id.clone()),
    };

    // Delete existing ban then insert (cross-DB upsert)
    let _ = ban::Entity::delete_by_id(&user_id).exec(&state.db).await;
    let _ = ban::Entity::insert(new_ban).exec(&state.db).await;

    // Remove from server members
    let _ = server_member::Entity::delete_many()
        .filter(server_member::Column::ServerId.eq(&server_id))
        .filter(server_member::Column::UserId.eq(&user_id))
        .exec(&state.db)
        .await;

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

    let user_name = user::Entity::find_by_id(&user_id)
        .one(&state.db)
        .await
        .ok()
        .flatten()
        .map(|u| u.username)
        .unwrap_or_else(|| "Unknown User".to_string());

    let _ = ban::Entity::delete_by_id(&user_id).exec(&state.db).await;

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

    let user_name = user::Entity::find_by_id(&user_id)
        .one(&state.db)
        .await
        .ok()
        .flatten()
        .map(|u| u.username)
        .unwrap_or_else(|| "Unknown User".to_string());

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

pub async fn timeout_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(payload): Json<TimeoutRequest>,
) -> Result<StatusCode, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;
    if !user_has_permission(&state, &claims.sub, Permissions::MODERATE_MEMBERS).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    let user_name = user::Entity::find_by_id(&user_id)
        .one(&state.db)
        .await
        .ok()
        .flatten()
        .map(|u| u.username)
        .unwrap_or_else(|| "Unknown User".to_string());

    let timeout_until = chrono::Utc::now() + chrono::Duration::seconds(payload.duration_secs);
    let timeout_until_str = timeout_until.format("%Y-%m-%d %H:%M:%S").to_string();

    // Update user's timeout in DB
    if let Some(mut user) = user::Entity::find_by_id(&user_id).
        one(&state.db)
        .await
        .ok()
        .flatten()
    {
        let mut active_user: user::ActiveModel = user.into();
        active_user.timeout_until = Set(Some(timeout_until_str.clone()));
        let _ = active_user.update(&state.db).await;
    }

    // Add to in-memory timeout set
    {
        let mut timeout_set = state.is_user_timed_out.lock().await;
        timeout_set.insert(user_id.clone());

        // Schedule removal from timeout set after duration expires
        let state_clone = state.clone();
        let user_id_clone = user_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(payload.duration_secs as u64)).await;
            state_clone.is_user_timed_out.lock().await.remove(&user_id_clone);
        });
    }

    create_audit_log(
        &state.db,
        &claims.sub,
        &claims.username,
        "TIMEOUT_USER",
        Some(&user_id),
        Some(&user_name),
        Some(&format!("Timeout until {}", timeout_until_str)),
    ).await;

    Ok(StatusCode::OK)
}