use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::*;
use sea_orm::prelude::Expr;
use uuid::Uuid;

use crate::entities::{ban, bot, channel, invite_code, role, server, server_member, user, user_role};
use crate::models::{CreateServerRequest, Permissions, Server, ServerMember};
use crate::routes::auth::extract_claims;
use crate::routes::audit_logs::create_audit_log;
use crate::state::AppState;

/// Helper: extract server_id from X-Server-Id header, defaulting to "default"
pub fn extract_server_id(headers: &HeaderMap) -> String {
    headers
        .get("x-server-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "default".to_string())
}

// ─── List servers the auth'd user is a member of ───
pub async fn list_servers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Server>>, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;

    let servers: Vec<Server> = server::Entity::find()
        .inner_join(server_member::Entity)
        .filter(server_member::Column::UserId.eq(&claims.sub))
        .order_by_asc(server::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to list servers: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(servers))
}

// ─── Create a new server ───
pub async fn create_server(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateServerRequest>,
) -> Result<(StatusCode, Json<Server>), StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let description = req
        .description
        .unwrap_or_else(|| "Welcome!".to_string())
        .chars()
        .take(500)
        .collect::<String>();

    let server_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Create the server
    let new_server = server::ActiveModel {
        id: Set(server_id.clone()),
        name: Set(name.clone()),
        description: Set(description.clone()),
        icon_url: Set(None),
        owner_id: Set(claims.sub.clone()),
        join_sound_url: Set(None),
        leave_sound_url: Set(None),
        sound_chance: Set(100),
        created_at: Set(now.clone()),
        updated_at: Set(None),
    };

    server::Entity::insert(new_server)
        .exec(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create server: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Add creator as member
    let member = server_member::ActiveModel {
        server_id: Set(server_id.clone()),
        user_id: Set(claims.sub.clone()),
        joined_at: Set(now.clone()),
    };
    server_member::Entity::insert(member)
        .exec(&state.db)
        .await
        .ok();

    // Create an Admin role for this server
    let admin_role_id = format!("{}-admin", server_id);
    let admin_role = role::ActiveModel {
        id: Set(admin_role_id.clone()),
        name: Set("Admin".to_string()),
        color: Set(Some("#FF0000".to_string())),
        position: Set(999),
        permissions: Set(Permissions::ADMINISTRATOR.bits()),
        created_at: Set(now.clone()),
        server_id: Set(server_id.clone()),
    };
    role::Entity::insert(admin_role)
        .exec(&state.db)
        .await
        .ok();

    // Assign admin role to creator
    let ur = user_role::ActiveModel {
        user_id: Set(claims.sub.clone()),
        role_id: Set(admin_role_id.clone()),
        assigned_at: Set(now.clone()),
    };
    user_role::Entity::insert(ur)
        .on_conflict(
            sea_query::OnConflict::columns([user_role::Column::UserId, user_role::Column::RoleId])
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec(&state.db)
        .await
        .ok();

    // Create default channels
    let general_id = Uuid::new_v4().to_string();
    let general_ch = channel::ActiveModel {
        id: Set(general_id.clone()),
        name: Set("general".to_string()),
        description: Set("General chat".to_string()),
        position: Set(0),
        channel_type: Set("text".to_string()),
        server_id: Set(server_id.clone()),
        ..Default::default()
    };
    channel::Entity::insert(general_ch)
        .exec(&state.db)
        .await
        .ok();

    let voice_id = Uuid::new_v4().to_string();
    let voice_ch = channel::ActiveModel {
        id: Set(voice_id.clone()),
        name: Set("Voice Lounge".to_string()),
        description: Set("Voice channel".to_string()),
        position: Set(1),
        channel_type: Set("voice".to_string()),
        server_id: Set(server_id.clone()),
        ..Default::default()
    };
    channel::Entity::insert(voice_ch)
        .exec(&state.db)
        .await
        .ok();

    // Create a server-specific invite code
    let invite_code_val = crate::token::generate_invite_code();
    let ic = invite_code::ActiveModel {
        code: Set(invite_code_val.clone()),
        created_at: Set(now.clone()),
        max_uses: Set(None),
        uses: Set(0),
        server_id: Set(server_id.clone()),
    };
    invite_code::Entity::insert(ic)
        .exec(&state.db)
        .await
        .ok();

    create_audit_log(
        &state.db,
        &claims.sub,
        &claims.username,
        "CREATE_SERVER",
        Some(&server_id),
        Some(&name),
        None,
    )
    .await;

    let server = Server {
        id: server_id,
        name,
        description,
        icon_url: None,
        owner_id: claims.sub,
        join_sound_url: None,
        leave_sound_url: None,
        sound_chance: 100,
        created_at: now,
        updated_at: None,
    };

    Ok((StatusCode::CREATED, Json(server)))
}

// ─── Get a specific server ───
pub async fn get_server(
    State(state): State<AppState>,
    Path(server_id): Path<String>,
) -> Result<Json<Server>, StatusCode> {
    let server = server::Entity::find_by_id(&server_id)
        .one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get server: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(server))
}

// ─── Update a server (requires MANAGE_SERVER or owner) ───
pub async fn update_server(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(server_id): Path<String>,
    Json(req): Json<crate::models::UpdateServerRequest>,
) -> Result<StatusCode, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;

    // Check if user is owner or has MANAGE_SERVER permission
    let server = server::Entity::find_by_id(&server_id)
        .one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    if server.owner_id != claims.sub {
        if !crate::routes::roles::user_has_permission(&state, &claims.sub, Permissions::MANAGE_SERVER)
            .await?
        {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    if let Some(name) = &req.name {
        server::Entity::update_many()
            .col_expr(server::Column::Name, Expr::value(name.clone()))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();
    }

    if let Some(desc) = &req.description {
        server::Entity::update_many()
            .col_expr(server::Column::Description, Expr::value(desc.clone()))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();
    }

    if let Some(url) = &req.join_sound_url {
        server::Entity::update_many()
            .col_expr(server::Column::JoinSoundUrl, Expr::value(url.clone()))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();
    }

    if let Some(url) = &req.leave_sound_url {
        server::Entity::update_many()
            .col_expr(server::Column::LeaveSoundUrl, Expr::value(url.clone()))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();
    }

    if let Some(chance) = req.sound_chance {
        server::Entity::update_many()
            .col_expr(server::Column::SoundChance, Expr::value(chance))
            .col_expr(server::Column::UpdatedAt, Expr::value(now.clone()))
            .filter(server::Column::Id.eq(&server_id))
            .exec(&state.db)
            .await
            .ok();
    }

    Ok(StatusCode::OK)
}

// ─── Delete a server (owner only) ───
pub async fn delete_server(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(server_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;

    // Cannot delete the default server
    if server_id == "default" {
        return Err(StatusCode::FORBIDDEN);
    }

    let srv = server::Entity::find_by_id(&server_id)
        .one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    if srv.owner_id != claims.sub {
        return Err(StatusCode::FORBIDDEN);
    }

    // Delete all related data
    channel::Entity::delete_many()
        .filter(channel::Column::ServerId.eq(&server_id))
        .exec(&state.db)
        .await
        .ok();
    role::Entity::delete_many()
        .filter(role::Column::ServerId.eq(&server_id))
        .exec(&state.db)
        .await
        .ok();
    invite_code::Entity::delete_many()
        .filter(invite_code::Column::ServerId.eq(&server_id))
        .exec(&state.db)
        .await
        .ok();
    bot::Entity::delete_many()
        .filter(bot::Column::ServerId.eq(&server_id))
        .exec(&state.db)
        .await
        .ok();
    ban::Entity::delete_many()
        .filter(ban::Column::ServerId.eq(&server_id))
        .exec(&state.db)
        .await
        .ok();
    server_member::Entity::delete_many()
        .filter(server_member::Column::ServerId.eq(&server_id))
        .exec(&state.db)
        .await
        .ok();
    server::Entity::delete_by_id(&server_id)
        .exec(&state.db)
        .await
        .ok();

    Ok(StatusCode::NO_CONTENT)
}

// ─── Join a server (by server_id, user must be authenticated) ───
pub async fn join_server_by_id(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(server_id): Path<String>,
) -> Result<Json<ServerMember>, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;

    // Check server exists
    let exists = server::Entity::find_by_id(&server_id)
        .one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if exists.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let member = server_member::ActiveModel {
        server_id: Set(server_id.clone()),
        user_id: Set(claims.sub.clone()),
        joined_at: Set(now.clone()),
    };
    server_member::Entity::insert(member)
        .on_conflict(
            sea_query::OnConflict::columns([server_member::Column::ServerId, server_member::Column::UserId])
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to join server: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(ServerMember {
        server_id,
        user_id: claims.sub,
        joined_at: now,
    }))
}

// ─── Leave a server ───
pub async fn leave_server(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(server_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;

    // Cannot leave the default server
    if server_id == "default" {
        return Err(StatusCode::FORBIDDEN);
    }

    server_member::Entity::delete_many()
        .filter(server_member::Column::ServerId.eq(&server_id))
        .filter(server_member::Column::UserId.eq(&claims.sub))
        .exec(&state.db)
        .await
        .ok();

    Ok(StatusCode::NO_CONTENT)
}

// ─── List members of a server (rich info) ───
pub async fn list_server_members(
    State(state): State<AppState>,
    Path(server_id): Path<String>,
) -> Result<Json<Vec<crate::models::MemberInfo>>, StatusCode> {
    // 1. Fetch human members: join server_members + users
    let member_rows = server_member::Entity::find()
        .filter(server_member::Column::ServerId.eq(&server_id))
        .find_also_related(user::Entity)
        .order_by_asc(server_member::Column::JoinedAt)
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to list server members: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let rows: Vec<(String, String, Option<String>, String)> = member_rows
        .into_iter()
        .filter_map(|(sm, u)| {
            u.map(|u| (u.id, u.display_name, u.avatar_url, sm.joined_at))
        })
        .collect();

    // 2. Fetch bots belonging to this server
    let bot_rows = bot::Entity::find()
        .filter(bot::Column::ServerId.eq(&server_id))
        .order_by_asc(bot::Column::CreatedAt)
        .all(&state.db)
        .await
        .unwrap_or_default();

    let bots: Vec<(String, String, Option<String>, String)> = bot_rows
        .into_iter()
        .map(|b| (b.id, b.name, b.avatar_url, b.created_at))
        .collect();

    // 3. Get all online user IDs for presence
    let online_ids = state.get_online_user_ids().await;

    // 4. Fetch role assignments for all users in this server
    let role_rows = user_role::Entity::find()
        .find_also_related(role::Entity)
        .filter(role::Column::ServerId.eq(&server_id))
        .all(&state.db)
        .await
        .unwrap_or_default();

    let role_assignments: Vec<(String, String, String, Option<String>, i64)> = role_rows
        .into_iter()
        .filter_map(|(ur, r)| {
            r.map(|r| (ur.user_id, r.id, r.name, r.color, r.position))
        })
        .collect();

    // Build role map: user_id -> Vec<RoleBrief>
    let mut role_map: std::collections::HashMap<String, Vec<crate::models::RoleBrief>> =
        std::collections::HashMap::new();
    for (user_id, role_id, role_name, role_color, role_pos) in &role_assignments {
        role_map
            .entry(user_id.clone())
            .or_default()
            .push(crate::models::RoleBrief {
                id: role_id.clone(),
                name: role_name.clone(),
                color: role_color.clone(),
                position: *role_pos,
            });
    }

    // 5. Build MemberInfo list
    let mut members: Vec<crate::models::MemberInfo> = Vec::new();

    for (uid, display_name, avatar_url, joined_at) in rows {
        let roles = role_map.remove(&uid).unwrap_or_default();
        members.push(crate::models::MemberInfo {
            user_id: uid.clone(),
            display_name,
            avatar_url,
            is_bot: false,
            is_online: online_ids.contains(&uid),
            joined_at,
            roles,
        });
    }

    // Add bots (always "online")
    for (bot_id, bot_name, avatar_url, created_at) in bots {
        members.push(crate::models::MemberInfo {
            user_id: bot_id.clone(),
            display_name: bot_name,
            avatar_url,
            is_bot: true,
            is_online: online_ids.contains(&bot_id),
            joined_at: created_at,
            roles: vec![],
        });
    }

    Ok(Json(members))
}
