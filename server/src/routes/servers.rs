use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use uuid::Uuid;

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

    let servers = sqlx::query_as::<_, Server>(
        "SELECT s.* FROM servers s
         INNER JOIN server_members sm ON s.id = sm.server_id
         WHERE sm.user_id = ?
         ORDER BY s.created_at ASC",
    )
    .bind(&claims.sub)
    .fetch_all(&state.db)
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
    sqlx::query(
        "INSERT INTO servers (id, name, description, owner_id, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&server_id)
    .bind(&name)
    .bind(&description)
    .bind(&claims.sub)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create server: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Add creator as member
    sqlx::query("INSERT INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)")
        .bind(&server_id)
        .bind(&claims.sub)
        .bind(&now)
        .execute(&state.db)
        .await
        .ok();

    // Create an Admin role for this server
    let admin_role_id = format!("{}-admin", server_id);
    sqlx::query(
        "INSERT INTO roles (id, name, color, position, permissions, created_at, server_id) VALUES (?, 'Admin', '#FF0000', 999, ?, ?, ?)",
    )
    .bind(&admin_role_id)
    .bind(Permissions::ADMINISTRATOR.bits())
    .bind(&now)
    .bind(&server_id)
    .execute(&state.db)
    .await
    .ok();

    // Assign admin role to creator
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_at) VALUES (?, ?, ?)")
        .bind(&claims.sub)
        .bind(&admin_role_id)
        .bind(&now)
        .execute(&state.db)
        .await
        .ok();

    // Create default channels
    let general_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO channels (id, name, description, position, channel_type, server_id) VALUES (?, 'general', 'General chat', 0, 'text', ?)",
    )
    .bind(&general_id)
    .bind(&server_id)
    .execute(&state.db)
    .await
    .ok();

    let voice_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO channels (id, name, description, position, channel_type, server_id) VALUES (?, 'Voice Lounge', 'Voice channel', 1, 'voice', ?)",
    )
    .bind(&voice_id)
    .bind(&server_id)
    .execute(&state.db)
    .await
    .ok();

    // Create a server-specific invite code
    let invite_code = crate::token::generate_invite_code();
    sqlx::query("INSERT INTO invite_codes (code, max_uses, server_id) VALUES (?, NULL, ?)")
        .bind(&invite_code)
        .bind(&server_id)
        .execute(&state.db)
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
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
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
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
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

    if let Some(name) = &req.name {
        sqlx::query("UPDATE servers SET name = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(name)
            .bind(&server_id)
            .execute(&state.db)
            .await
            .ok();
    }

    if let Some(desc) = &req.description {
        sqlx::query("UPDATE servers SET description = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(desc)
            .bind(&server_id)
            .execute(&state.db)
            .await
            .ok();
    }

    if let Some(url) = &req.join_sound_url {
        sqlx::query(
            "UPDATE servers SET join_sound_url = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(url)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();
    }

    if let Some(url) = &req.leave_sound_url {
        sqlx::query(
            "UPDATE servers SET leave_sound_url = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(url)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();
    }

    if let Some(chance) = req.sound_chance {
        sqlx::query(
            "UPDATE servers SET sound_chance = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(chance)
        .bind(&server_id)
        .execute(&state.db)
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

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    if server.owner_id != claims.sub {
        return Err(StatusCode::FORBIDDEN);
    }

    // Delete all related data
    sqlx::query("DELETE FROM channels WHERE server_id = ?")
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();
    sqlx::query("DELETE FROM roles WHERE server_id = ?")
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();
    sqlx::query("DELETE FROM invite_codes WHERE server_id = ?")
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();
    sqlx::query("DELETE FROM bots WHERE server_id = ?")
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();
    sqlx::query("DELETE FROM bans WHERE server_id = ?")
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();
    sqlx::query("DELETE FROM server_members WHERE server_id = ?")
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();
    sqlx::query("DELETE FROM servers WHERE id = ?")
        .bind(&server_id)
        .execute(&state.db)
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
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if exists == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    sqlx::query(
        "INSERT OR IGNORE INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)",
    )
    .bind(&server_id)
    .bind(&claims.sub)
    .bind(&now)
    .execute(&state.db)
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

    sqlx::query("DELETE FROM server_members WHERE server_id = ? AND user_id = ?")
        .bind(&server_id)
        .bind(&claims.sub)
        .execute(&state.db)
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
    let rows: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT u.id, u.display_name, u.avatar_url, sm.joined_at \
         FROM server_members sm JOIN users u ON u.id = sm.user_id \
         WHERE sm.server_id = ? ORDER BY sm.joined_at ASC",
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list server members: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // 2. Fetch bots belonging to this server
    let bots: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, name, avatar_url, created_at FROM bots WHERE server_id = ? ORDER BY created_at ASC",
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // 3. Get all online user IDs for presence
    let online_ids = state.get_online_user_ids().await;

    // 4. Fetch role assignments for all users in this server
    let role_assignments: Vec<(String, String, String, Option<String>, i64)> = sqlx::query_as(
        "SELECT ur.user_id, r.id, r.name, r.color, r.position \
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id \
         WHERE r.server_id = ?",
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

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
