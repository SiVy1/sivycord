use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use sea_orm::*;
use uuid::Uuid;

use crate::entities::{role, user_role};
use crate::models::{
    AssignRoleRequest, CreateRoleRequest, Permissions, Role, RoleWithMembers, UpdateRoleRequest,
};
use crate::routes::auth::Claims;
use crate::routes::servers::extract_server_id;
use crate::state::AppState;

const MAX_ROLE_NAME: usize = 64;

// ─── Helper: Check if user has permission ───
pub async fn user_has_permission(
    state: &AppState,
    user_id: &str,
    required: Permissions,
) -> Result<bool, StatusCode> {
    // Get user's roles via join
    let roles: Vec<role::Model> = role::Entity::find()
        .inner_join(user_role::Entity)
        .filter(user_role::Column::UserId.eq(user_id))
        .order_by_desc(role::Column::Position)
        .all(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Check if any role has the required permission or ADMINISTRATOR
    for r in roles {
        let perms = Permissions::from_bits_truncate(r.permissions);
        if perms.contains(Permissions::ADMINISTRATOR) || perms.contains(required) {
            return Ok(true);
        }
    }

    Ok(false)
}

// ─── List all roles ───
pub async fn list_roles(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoleWithMembers>>, StatusCode> {
    let server_id = extract_server_id(&headers);

    let roles = role::Entity::find()
        .filter(role::Column::ServerId.eq(&server_id))
        .order_by_desc(role::Column::Position)
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to list roles: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Get member count for each role
    let mut result = Vec::new();
    for r in roles {
        let count = user_role::Entity::find()
            .filter(user_role::Column::RoleId.eq(&r.id))
            .count(&state.db)
            .await
            .unwrap_or(0) as i64;

        result.push(RoleWithMembers {
            role: r,
            member_count: count,
        });
    }

    Ok(Json(result))
}

// ─── Create role (requires MANAGE_ROLES) ───
pub async fn create_role(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateRoleRequest>,
) -> Result<(StatusCode, Json<Role>), StatusCode> {
    let server_id = extract_server_id(&headers);

    // Check permission
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_ROLES).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    // Validate name
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > MAX_ROLE_NAME {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Check for duplicate name within server
    let exists = role::Entity::find()
        .filter(role::Column::Name.eq(&name))
        .filter(role::Column::ServerId.eq(&server_id))
        .count(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if exists > 0 {
        return Err(StatusCode::CONFLICT);
    }

    // Get max position within server
    let max_position: Option<i64> = role::Entity::find()
        .filter(role::Column::ServerId.eq(&server_id))
        .select_only()
        .column_as(role::Column::Position.max(), "position")
        .into_tuple()
        .one(&state.db)
        .await
        .ok()
        .flatten();

    let position = max_position.unwrap_or(0) + 1;

    // Create role
    let role_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_role = role::ActiveModel {
        id: Set(role_id.clone()),
        name: Set(name.clone()),
        color: Set(req.color.clone()),
        position: Set(position),
        permissions: Set(req.permissions),
        created_at: Set(now.clone()),
        server_id: Set(server_id.clone()),
    };

    role::Entity::insert(new_role)
        .exec(&state.db)
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
        server_id,
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
    let existing = role::Entity::find_by_id(&role_id)
        .one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // Update fields
    let name = req.name.unwrap_or(existing.name);
    let color = req.color.or(existing.color);
    let position = req.position.unwrap_or(existing.position);
    let permissions = req.permissions.unwrap_or(existing.permissions);

    let mut update = role::ActiveModel {
        id: Set(role_id.clone()),
        ..Default::default()
    };
    update.name = Set(name.clone());
    update.color = Set(color.clone());
    update.position = Set(position);
    update.permissions = Set(permissions);

    role::Entity::update(update)
        .exec(&state.db)
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
        created_at: existing.created_at,
        server_id: existing.server_id,
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
    }

    role::Entity::delete_by_id(&role_id)
        .exec(&state.db)
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
    let exists = role::Entity::find_by_id(&req.role_id)
        .count(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if exists == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Assign role (ignore if already assigned)
    let assignment = user_role::ActiveModel {
        user_id: Set(req.user_id.clone()),
        role_id: Set(req.role_id.clone()),
        assigned_at: Set(now),
    };

    user_role::Entity::insert(assignment)
        .on_conflict(
            sea_query::OnConflict::columns([user_role::Column::UserId, user_role::Column::RoleId])
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec(&state.db)
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
    }

    user_role::Entity::delete_many()
        .filter(user_role::Column::UserId.eq(&user_id))
        .filter(user_role::Column::RoleId.eq(&role_id))
        .exec(&state.db)
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
) -> Result<Json<Vec<Role>>, StatusCode> {
    let roles = role::Entity::find()
        .inner_join(user_role::Entity)
        .filter(user_role::Column::UserId.eq(&user_id))
        .order_by_desc(role::Column::Position)
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get user roles: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(roles))
}
