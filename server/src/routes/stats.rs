use axum::{extract::State, Json};
use crate::models::ServerStats;
use crate::state::AppState;

pub async fn get_server_stats(State(state): State<AppState>) -> Json<ServerStats> {
    let total_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let total_messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let total_channels: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channels")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let total_roles: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM roles")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let total_invites: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invite_codes")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    Json(ServerStats {
        total_users,
        total_messages,
        total_channels,
        total_roles,
        total_invites,
    })
}
