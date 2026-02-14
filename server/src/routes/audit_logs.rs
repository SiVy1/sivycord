use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use crate::AppState;
use crate::models::{AuditLog, Permissions};
use crate::routes::auth::extract_claims;
use crate::routes::roles::user_has_permission;
use crate::routes::servers::extract_server_id;

pub async fn list_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AuditLog>>, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;
    if !user_has_permission(&state, &claims.sub, Permissions::VIEW_AUDIT_LOG).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    let server_id = extract_server_id(&headers);

    let logs: Vec<AuditLog> = sqlx::query_as(
        "SELECT * FROM audit_logs WHERE server_id = ? ORDER BY created_at DESC LIMIT 100"
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Ok(Json(logs))
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
