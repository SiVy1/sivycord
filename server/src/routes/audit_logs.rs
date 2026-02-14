use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use sea_orm::{EntityTrait, QueryOrder, QuerySelect, Set};
use crate::entities::audit_log;
use crate::models::{AuditLog, Permissions};
use crate::routes::auth::extract_claims;
use crate::routes::roles::user_has_permission;
use crate::routes::servers::extract_server_id;
use crate::state::AppState;

pub async fn list_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AuditLog>>, StatusCode> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| e.0)?;
    if !user_has_permission(&state, &claims.sub, Permissions::VIEW_AUDIT_LOG).await? {
        return Err(StatusCode::FORBIDDEN);
    }

    let server_id = extract_server_id(&headers);

    let logs: Vec<AuditLog> = audit_log::Entity::find()
        .filter(audit_log::Column::ServerId.eq(&server_id))
        .order_by_desc(audit_log::Column::CreatedAt)
        .limit(100)
        .all(&state.db)
        .await
        .unwrap_or_default();

    Ok(Json(logs))
}

pub async fn create_audit_log(
    db: &sea_orm::DatabaseConnection,
    user_id: &str,
    user_name: &str,
    action: &str,
    target_id: Option<&str>,
    target_name: Option<&str>,
    details: Option<&str>,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let log = audit_log::ActiveModel {
        id: Set(id),
        user_id: Set(user_id.to_string()),
        user_name: Set(user_name.to_string()),
        action: Set(action.to_string()),
        target_id: Set(target_id.map(|s| s.to_string())),
        target_name: Set(target_name.map(|s| s.to_string())),
        details: Set(details.map(|s| s.to_string())),
        created_at: Set(now),
        server_id: Set("default".to_string()),
    };

    let _ = audit_log::Entity::insert(log).exec(db).await;
}
