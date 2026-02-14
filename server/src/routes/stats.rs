use axum::{extract::State, http::HeaderMap, Json};
use sea_orm::{EntityTrait, QuerySelect, ColumnTrait, QueryFilter, JoinType, RelationTrait};
use crate::entities::{server_member, message, channel, role, invite_code};
use crate::models::ServerStats;
use crate::routes::servers::extract_server_id;
use crate::state::AppState;

pub async fn get_server_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<ServerStats> {
    let server_id = extract_server_id(&headers);

    let total_users = server_member::Entity::find()
        .filter(server_member::Column::ServerId.eq(&server_id))
        .count(&state.db)
        .await
        .unwrap_or(0) as i64;

    // Count messages in channels belonging to this server
    let total_messages = message::Entity::find()
        .join(JoinType::InnerJoin, message::Relation::Channel.def())
        .filter(channel::Column::ServerId.eq(&server_id))
        .count(&state.db)
        .await
        .unwrap_or(0) as i64;

    let total_channels = channel::Entity::find()
        .filter(channel::Column::ServerId.eq(&server_id))
        .count(&state.db)
        .await
        .unwrap_or(0) as i64;

    let total_roles = role::Entity::find()
        .filter(role::Column::ServerId.eq(&server_id))
        .count(&state.db)
        .await
        .unwrap_or(0) as i64;

    let total_invites = invite_code::Entity::find()
        .filter(invite_code::Column::ServerId.eq(&server_id))
        .count(&state.db)
        .await
        .unwrap_or(0) as i64;

    Json(ServerStats {
        total_users,
        total_messages,
        total_channels,
        total_roles,
        total_invites,
    })
}
