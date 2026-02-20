use serde::{Deserialize, Serialize};
use crate::models::Permissions;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionOverrideConfig {
    pub target_id: String,
    pub is_user: bool, // true if target_type is "member", false if "role"
    pub allow: Permissions,
    pub deny: Permissions,
}

/// Calculate the final resulting permissions of a user in a channel.
/// 
/// Evaluation hierarchy:
/// 1. Base permissions (every role user has put into OR logic)
/// 2. Channel Override: @everyone role
/// 3. Channel Override: User's roles (OR logic combined)
/// 4. Channel Override: User
pub fn calculate_permissions(
    base_server_perms: Permissions,
    channel_overrides: &[PermissionOverrideConfig],
    user_id: &str,
    everyone_role_id: &str,
    user_role_ids: &[String],
) -> Permissions {
    // 1. Base initialization
    let mut current_perms = base_server_perms;

    // Immediately grant highest if admin
    if current_perms.contains(Permissions::ADMINISTRATOR) {
        return Permissions::all();
    }

    // 2. Channel Override for @everyone (id is typically server_id, or "everyone")
    if let Some(everyone_ovr) = channel_overrides.iter().find(|o| !o.is_user && o.target_id == everyone_role_id) {
        current_perms.remove(everyone_ovr.deny);   // Remove denied bits
        current_perms.insert(everyone_ovr.allow); // Add allowed bits
    }

    // 3. Channel Override for Roles
    let mut roles_allow = Permissions::empty();
    let mut roles_deny = Permissions::empty();
    for ovr in channel_overrides.iter().filter(|o| !o.is_user) {
        if user_role_ids.contains(&ovr.target_id) {
            roles_allow.insert(ovr.allow);
            roles_deny.insert(ovr.deny);
        }
    }
    current_perms.remove(roles_deny); // Apply role denials collectively
    current_perms.insert(roles_allow); // Apply role allowances collectively

    // 4. Channel Override for User
    if let Some(user_ovr) = channel_overrides.iter().find(|o| o.is_user && o.target_id == user_id) {
        current_perms.remove(user_ovr.deny);
        current_perms.insert(user_ovr.allow);
    }

    // Edge case checks - e.g. if they cant view channel, they should not have send messages
    if !current_perms.contains(Permissions::VIEW_CHANNELS) {
        current_perms.remove(Permissions::SEND_MESSAGES);
        current_perms.remove(Permissions::CONNECT);
        current_perms.remove(Permissions::READ_HISTORY);
    }
    
    current_perms
}

use axum::http::StatusCode;
use sea_orm::*;
use crate::state::AppState;
use crate::entities::{role, user_role, channel_override};

/// Checks if a user has a specific permission in a specific channel.
pub async fn check_channel_permission(
    state: &AppState,
    user_id: &str,
    channel_id: &str,
    required: Permissions,
) -> Result<bool, StatusCode> {
    // 1. Get user's roles
    let user_roles: Vec<role::Model> = role::Entity::find()
        .inner_join(user_role::Entity)
        .filter(user_role::Column::UserId.eq(user_id))
        .all(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut base_perms = Permissions::empty();
    let mut user_role_ids = Vec::new();
    
    // Default everyone permissions apply if they have no roles (or are added to base perms)
    // Assuming everyone gets default member perms, and roles add to it
    // For simplicity, we just combine the permissions they have through roles.
    // If they have no roles and everyone role is implicit, we should add everyone's perms.
    // Assuming there's a role assigned to everyone or we assume default_member.
    base_perms.insert(Permissions::default_member());

    for r in user_roles {
        base_perms.insert(Permissions::from_bits_truncate(r.permissions));
        user_role_ids.push(r.id);
    }

    if base_perms.contains(Permissions::ADMINISTRATOR) {
        return Ok(true);
    }

    // 2. Fetch channel overrides
    let overrides: Vec<channel_override::Model> = channel_override::Entity::find()
        .filter(channel_override::Column::ChannelId.eq(channel_id))
        .all(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let configs: Vec<PermissionOverrideConfig> = overrides.into_iter().map(|o| PermissionOverrideConfig {
        target_id: o.target_id,
        is_user: o.target_type == "member",
        allow: Permissions::from_bits_truncate(o.allow),
        deny: Permissions::from_bits_truncate(o.deny),
    }).collect();

    let computed = calculate_permissions(
        base_perms,
        &configs,
        user_id,
        "default", // we can assume "everyone" role id is the server id or a special id. For now "default" or handled dynamically
        &user_role_ids
    );

    Ok(computed.contains(Permissions::ADMINISTRATOR) || computed.contains(required))
}
