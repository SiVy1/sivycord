use axum::{extract::State, Json};

use crate::models::ServerInfo;
use crate::state::AppState;

pub async fn get_server_info(State(state): State<AppState>) -> Json<ServerInfo> {
    let channels: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channels")
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

    let online = state.online_count();

    Json(ServerInfo {
        name: "SiVyCord Server".to_string(),
        channels: channels as usize,
        online,
    })
}
