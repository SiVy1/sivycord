use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};
use sea_orm::*;
use uuid::Uuid;

use crate::entities::{upload, user};
use crate::routes::auth;
use crate::state::AppState;

const MAX_AVATAR_SIZE: usize = 8 * 1024 * 1024; // 8MB
const MAX_FILE_SIZE: usize = 25 * 1024 * 1024; // 25MB

const ALLOWED_IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp"];
const ALLOWED_FILE_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "video/mp4",
    "video/webm",
    "application/zip",
    "application/gzip",
];

fn get_extension(mime: &str) -> &str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/wav" => "wav",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "application/zip" => "zip",
        "application/gzip" => "gz",
        _ => "bin",
    }
}

/// Upload a file (requires auth)
pub async fn upload_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<(StatusCode, axum::Json<serde_json::Value>), (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name != "file" {
            continue;
        }

        let filename = field.file_name().unwrap_or("upload").to_string();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        if !ALLOWED_FILE_TYPES.contains(&content_type.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("File type {content_type} not allowed"),
            ));
        }

        let data = field
            .bytes()
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Read error: {e}")))?;

        if data.len() > MAX_FILE_SIZE {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("File too large (max {}MB)", MAX_FILE_SIZE / 1024 / 1024),
            ));
        }

        let id = Uuid::new_v4().to_string();
        let ext = get_extension(&content_type);
        let disk_filename = format!("{id}.{ext}");

        tokio::fs::write(format!("./uploads/{disk_filename}"), &data)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Write error: {e}"),
                )
            })?;

        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let new_upload = upload::ActiveModel {
            id: Set(id.clone()),
            user_id: Set(claims.sub.clone()),
            filename: Set(filename.clone()),
            mime_type: Set(content_type.clone()),
            size: Set(data.len() as i64),
            created_at: Set(now),
        };

        upload::Entity::insert(new_upload)
            .exec(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        return Ok((
            StatusCode::CREATED,
            axum::Json(serde_json::json!({
                "id": id,
                "filename": filename,
                "mime_type": content_type,
                "size": data.len(),
                "url": format!("/api/uploads/{id}")
            })),
        ));
    }

    Err((StatusCode::BAD_REQUEST, "No file field found".into()))
}

/// Serve an uploaded file
pub async fn serve_upload(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let upload_row = upload::Entity::find_by_id(&id)
        .one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let ext = get_extension(&upload_row.mime_type);
    let path = format!("./uploads/{}.{ext}", upload_row.id);

    let data = tokio::fs::read(&path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok((
        [
            (header::CONTENT_TYPE, upload_row.mime_type),
            (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
        ],
        Body::from(data),
    ))
}

/// Upload user avatar (requires auth, images only, 8MB max)
pub async fn upload_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name != "avatar" && field_name != "file" {
            continue;
        }

        let content_type = field.content_type().unwrap_or("").to_string();
        if !ALLOWED_IMAGE_TYPES.contains(&content_type.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                "Avatar must be PNG, JPEG, GIF, or WebP".into(),
            ));
        }

        let data = field
            .bytes()
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Read error: {e}")))?;

        if data.len() > MAX_AVATAR_SIZE {
            return Err((StatusCode::BAD_REQUEST, "Avatar too large (max 8MB)".into()));
        }

        let id = Uuid::new_v4().to_string();
        let ext = get_extension(&content_type);
        let disk_filename = format!("{id}.{ext}");

        tokio::fs::write(format!("./uploads/{disk_filename}"), &data)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Write error: {e}"),
                )
            })?;

        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let new_upload = upload::ActiveModel {
            id: Set(id.clone()),
            user_id: Set(claims.sub.clone()),
            filename: Set("avatar".to_string()),
            mime_type: Set(content_type.clone()),
            size: Set(data.len() as i64),
            created_at: Set(now),
        };

        upload::Entity::insert(new_upload)
            .exec(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        let avatar_url = format!("/api/uploads/{id}");

        user::Entity::update_many()
            .col_expr(user::Column::AvatarUrl, Expr::value(Some(avatar_url.clone())))
            .filter(user::Column::Id.eq(&claims.sub))
            .exec(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        return Ok(axum::Json(serde_json::json!({ "avatar_url": avatar_url })));
    }

    Err((StatusCode::BAD_REQUEST, "No file found".into()))
}
