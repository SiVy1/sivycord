use axum::{extract::State, Json};
use crate::AppState;
use crate::models::AuditLog;

pub async fn list_audit_logs(State(state): State<AppState>) -> Json<Vec<AuditLog>> {
    let logs: Vec<AuditLog> = sqlx::query_as(
        "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(logs)
}

pub async fn create_audit_log(
    db: &sqlx::SqlitePool,
    user_id: &str,
    user_name: &str,
    action: &str,
    target_id: Option<&str>,
    target_name: Option<&str>,
    details: Option<&str>,
) {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO audit_logs (id, user_id, user_name, action, target_id, target_name, details) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id)
    .bind(user_id)
    .bind(user_name)
    .bind(action)
    .bind(target_id)
    .bind(target_name)
    .bind(details)
    .execute(db)
    .await
    .ok();
}
