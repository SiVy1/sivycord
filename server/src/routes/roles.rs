use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use uuid::Uuid;

use crate::models::{
    AssignRoleRequest, CreateRoleRequest, Permissions, Role, RoleWithMembers, UpdateRoleRequest,
};
use crate::routes::auth::Claims;
use crate::state::AppState;

const MAX_ROLE_NAME: usize = 64;

// ─── Helper: Check if user has permission ───
pub async fn user_has_permission(
    state: &AppState,
    user_id: &str,
    required: Permissions,
) -> Result<bool, StatusCode> {
    // Get user's roles
    let roles = sqlx::query_as::<_, Role>(
        "SELECT r.* FROM roles r 
         INNER JOIN user_roles ur ON r.id = ur.role_id 
         WHERE ur.user_id = ?
         ORDER BY r.position DESC",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Check if any role has the required permission or ADMINISTRATOR
    for role in roles {
        let perms = Permissions::from_bits_truncate(role.permissions);
        if perms.contains(Permissions::ADMINISTRATOR) || perms.contains(required) {
            return Ok(true);
        }
    }

    Ok(false)
}

// ─── List all roles ───
pub async fn list_roles(State(state): State<AppState>) -> Result<Json<Vec<RoleWithMembers>>, StatusCode> {
    let roles = sqlx::query_as::<_, Role>("SELECT * FROM roles ORDER BY position DESC")
        .fetch_all(&state.db)        .await
        .map_err(|e| {
            tracing::error!("Failed to list roles: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Get member count for each role
    let mut result = Vec::new();
    for role in roles {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_roles WHERE role_id = ?")
            .bind(&role.id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

        result.push(RoleWithMembers {
            role,
            member_count: count,
        });
    }

    Ok(Json(result))
}

// ─── Create role (requires MANAGE_ROLES) ───
pub async fn create_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateRoleRequest>,
) -> Result<(StatusCode, Json<Role>), StatusCode> {
    // Check permission
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_ROLES).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    // Validate name
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > MAX_ROLE_NAME {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Check for duplicate name
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM roles WHERE name = ?")
        .bind(&name)
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if exists > 0 {
        return Err(StatusCode::CONFLICT);
    }

    // Get max position
    let max_position: Option<i64> = sqlx::query_scalar("SELECT MAX(position) FROM roles")
        .fetch_one(&state.db)
        .await
        .ok()
        .flatten();

    let position = max_position.unwrap_or(0) + 1;

    // Create role
    let role_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    sqlx::query(
        "INSERT INTO roles (id, name, color, position, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&role_id)
    .bind(&name)
    .bind(&req.color)
    .bind(position)
    .bind(req.permissions)
    .bind(&now)    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create role: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let role = Role {
        id: role_id,
        name,
        color: req.color,
        position,
        permissions: req.permissions,
        created_at: now,
    };

    Ok((StatusCode::CREATED, Json(role)))
}

// ─── Update role (requires MANAGE_ROLES) ───
pub async fn update_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(role_id): Path<String>,
    Json(req): Json<UpdateRoleRequest>,
) -> Result<Json<Role>, StatusCode> {
    // Check permission
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_ROLES).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    // Get existing role
    let role = sqlx::query_as::<_, Role>("SELECT * FROM roles WHERE id = ?")
        .bind(&role_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // Update fields
    let name = req.name.unwrap_or(role.name);
    let color = req.color.or(role.color);
    let position = req.position.unwrap_or(role.position);
    let permissions = req.permissions.unwrap_or(role.permissions);

    sqlx::query(
        "UPDATE roles SET name = ?, color = ?, position = ?, permissions = ? WHERE id = ?",
    )
    .bind(&name)
    .bind(&color)
    .bind(position)
    .bind(permissions)
    .bind(&role_id)    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update role: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(Role {
        id: role_id,
        name,
        color,
        position,
        permissions,
        created_at: role.created_at,
    }))
}

// ─── Delete role (requires MANAGE_ROLES) ───
pub async fn delete_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(role_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Check permission
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_ROLES).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    // Cannot delete default roles
    if role_id == "admin-role" || role_id == "moderator-role" || role_id == "member-role" {
        return Err(StatusCode::FORBIDDEN);
    }    sqlx::query("DELETE FROM roles WHERE id = ?")
        .bind(&role_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete role: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::NO_CONTENT)
}

// ─── Assign role to user (requires MANAGE_ROLES) ───
pub async fn assign_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<AssignRoleRequest>,
) -> Result<StatusCode, StatusCode> {
    // Check permission
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_ROLES).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    // Check if role exists
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM roles WHERE id = ?")
        .bind(&req.role_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if exists == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();    // Assign role (ignore if already assigned)
    sqlx::query(
        "INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_at) VALUES (?, ?, ?)",
    )
    .bind(&req.user_id)
    .bind(&req.role_id)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to assign role: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(StatusCode::OK)
}

// ─── Remove role from user (requires MANAGE_ROLES) ───
pub async fn remove_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((user_id, role_id)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    // Check permission
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_ROLES).await? {
        return Err(StatusCode::FORBIDDEN);
    }    sqlx::query("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?")
        .bind(&user_id)
        .bind(&role_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to remove role: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::NO_CONTENT)
}

// ─── Get user's roles ───
pub async fn get_user_roles(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<Vec<Role>>, StatusCode> {    let roles = sqlx::query_as::<_, Role>(
        "SELECT r.* FROM roles r 
         INNER JOIN user_roles ur ON r.id = ur.role_id 
         WHERE ur.user_id = ?
         ORDER BY r.position DESC",
    )
    .bind(&user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get user roles: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(roles))
}
