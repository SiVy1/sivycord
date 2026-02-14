use axum::{extract::State, http::HeaderMap, Json};
use crate::models::ServerStats;
use crate::routes::servers::extract_server_id;
use crate::state::AppState;

pub async fn get_server_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<ServerStats> {
    let server_id = extract_server_id(&headers);

    let total_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM server_members WHERE server_id = ?")
        .bind(&server_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let total_messages: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages m INNER JOIN channels c ON m.channel_id = c.id WHERE c.server_id = ?",
    )
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let total_channels: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE server_id = ?")
        .bind(&server_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let total_roles: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM roles WHERE server_id = ?")
        .bind(&server_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let total_invites: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invite_codes WHERE server_id = ?")
        .bind(&server_id)
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
