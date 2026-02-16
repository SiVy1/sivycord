use axum::{extract::{State, Path}, http::{HeaderMap, StatusCode}, Json};
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, QueryOrder, QuerySelect, Set, ActiveModelTrait};
use sea_orm::sea_query::{Expr, Func};
use uuid::Uuid;

use crate::models::{Category, CreateCategoryRequest, Permissions, UpdateCategoryRequest};
use crate::entities::category;

use crate::state::AppState;
use crate::routes::auth::extract_claims;
use crate::routes::auth::UserInfo;
use crate::routes::roles::user_has_permission;
use crate::routes::servers::extract_server_id;

pub async fn list_categories(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Category>>, StatusCode> {
    let server_id = extract_server_id(&headers);

    
    let categories: Vec<Category> = category::Entity::find()
        .filter(category::Column::ServerId.eq(&server_id))
        .order_by_asc(category::Column::Position)
        .all(&state.db)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|c| Category {
            id: c.id,
            name: c.name,
            server_id: c.server_id,
            position: c.position,
        })
        .collect();
    Ok(Json(categories))
}

pub async fn create_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateCategoryRequest>,
) -> Result<(StatusCode, Json<Category>), (StatusCode, String)> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| (e.0, e.1))?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_CHANNELS)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission check error: {e}")))? 
    {
        return Err((StatusCode::FORBIDDEN, "Insufficient permissions".into()));
    }

    let server_id = extract_server_id(&headers);

    // Validate name
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 64 {
        return Err((StatusCode::BAD_REQUEST, "Invalid category name length".into()));
    }

    // Sanitize: only allow letters, numbers, hyphens, underscores
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ' ')
    {
        return Err((StatusCode::BAD_REQUEST, "Invalid characters in category name".into()));
    }

    // Get max position
    let max_position = category::Entity::find()
        .filter(category::Column::ServerId.eq(&server_id))
        .select_only()
        .column_as(Expr::col(category::Column::Position).max(), "max_position")
        .into_tuple::<(Option<i64>,)>()
        .one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get max category position: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?
        .and_then(|(pos,)| pos)
        .unwrap_or(0);

    let new_category = category::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        name: Set(name.clone()),
        server_id: Set(server_id.clone()),
        position: Set(max_position + 1),
    };

    let res = category::Entity::insert(new_category)
        .exec(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create category: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?;

    let category = Category {
        id: res.last_insert_id,
        name,
        server_id,
        position: max_position + 1,
    };

    Ok((StatusCode::CREATED, Json(category)))
}

async fn delete_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(category_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| (e.0, e.1))?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_CHANNELS)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission check error: {e}")))? 
    {
        return Err((StatusCode::FORBIDDEN, "Insufficient permissions".into()));
    }

    let server_id = extract_server_id(&headers);

    // Check if category exists and belongs to the server
    let category = category::Entity::find_by_id(&category_id)
        .filter(category::Column::ServerId.eq(&server_id))
        .one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to find category: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?
        .ok_or((StatusCode::NOT_FOUND, "Category not found".into()))?;

    // Deleting the category will cascade delete its channels due to the relation definition
    category::Entity::delete_by_id(category.id)
        .exec(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete category: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?;

    Ok(StatusCode::NO_CONTENT)
}

async fn update_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(category_id): Path<String>,
    Json(req): Json<UpdateCategoryRequest>,
) -> Result<(StatusCode, Json<Category>), (StatusCode, String)> {
    let claims = extract_claims(&state.jwt_secret, &headers).map_err(|e| (e.0, e.1))?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_CHANNELS)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Permission check error: {e}")))? 
    {
        return Err((StatusCode::FORBIDDEN, "Insufficient permissions".into()));
    }

    let server_id = extract_server_id(&headers);

    // Check if category exists and belongs to the server
    let mut category: category::ActiveModel = category::Entity::find_by_id(&category_id)
        .filter(category::Column::ServerId.eq(&server_id))
        .one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to find category: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        })?
        .ok_or((StatusCode::NOT_FOUND, "Category not found".into()))?
        .into();

    // Validate name
    let name = match req.name {
        Some(ref n) => n.trim().to_string(),
        None => return Err((StatusCode::BAD_REQUEST, "Category name is required".into())),
    };
    if name.is_empty() || name.len() > 64 {
        return Err((StatusCode::BAD_REQUEST, "Invalid category name length".into()));
    }

    // Sanitize: only allow letters, numbers, hyphens, underscores
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ' ')
    {
        return Err((StatusCode::BAD_REQUEST, "Invalid characters in category name".into()));
    }

    category.name = Set(name.clone());

    let res = category.update(&state.db).await.map_err(|e| {
        tracing::error!("Failed to update category: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
    })?;

    let updated_category = Category {
        id: res.id,
        name,
        server_id,
        position: res.position,
    };

    Ok((StatusCode::OK, Json(updated_category)))
}