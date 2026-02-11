use axum::{
    extract::{Multipart, Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use crate::routes::auth;
use crate::state::AppState;

const MAX_EMOJI_SIZE: usize = 256 * 1024; // 256KB
const ALLOWED_TYPES: &[&str] = &["image/png", "image/gif", "image/webp"];

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CustomEmoji {
    pub id: String,
    pub name: String,
    pub upload_id: String,
    pub user_id: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct EmojiResponse {
    pub id: String,
    pub name: String,
    pub url: String,
    pub user_id: String,
}

/// List all custom emoji
pub async fn list_emoji(
    State(state): State<AppState>,
) -> Result<Json<Vec<EmojiResponse>>, StatusCode> {
    let emojis = sqlx::query_as::<_, CustomEmoji>("SELECT * FROM custom_emoji ORDER BY name ASC")
        .fetch_all(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result: Vec<EmojiResponse> = emojis
        .into_iter()
        .map(|e| EmojiResponse {
            id: e.id,
            name: e.name,
            url: format!("/api/uploads/{}", e.upload_id),
            user_id: e.user_id,
        })
        .collect();

    Ok(Json(result))
}

/// Upload a custom emoji (requires auth)
pub async fn create_emoji(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<EmojiResponse>), (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let mut emoji_name: Option<String> = None;
    let mut file_data: Option<(Vec<u8>, String)> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Multipart error: {e}"))
    })? {
        let field_name = field.name().unwrap_or("").to_string();

        if field_name == "name" {
            let text = field.text().await.map_err(|e| {
                (StatusCode::BAD_REQUEST, format!("Read error: {e}"))
            })?;
            emoji_name = Some(text.trim().to_lowercase());
        } else if field_name == "file" || field_name == "image" {
            let content_type = field.content_type().unwrap_or("").to_string();
            if !ALLOWED_TYPES.contains(&content_type.as_str()) {
                return Err((StatusCode::BAD_REQUEST, "Emoji must be PNG, GIF, or WebP".into()));
            }
            let data = field.bytes().await.map_err(|e| {
                (StatusCode::BAD_REQUEST, format!("Read error: {e}"))
            })?;
            if data.len() > MAX_EMOJI_SIZE {
                return Err((StatusCode::BAD_REQUEST, "Emoji too large (max 256KB)".into()));
            }
            file_data = Some((data.to_vec(), content_type));
        }
    }

    let name = emoji_name.ok_or((StatusCode::BAD_REQUEST, "Missing emoji name".into()))?;
    let (data, content_type) = file_data.ok_or((StatusCode::BAD_REQUEST, "Missing emoji image".into()))?;

    // Validate name
    if name.is_empty() || name.len() > 32 {
        return Err((StatusCode::BAD_REQUEST, "Emoji name must be 1-32 characters".into()));
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err((StatusCode::BAD_REQUEST, "Emoji name can only contain letters, numbers, and _".into()));
    }

    // Check duplicate
    let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM custom_emoji WHERE name = ?")
        .bind(&name)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;
    if existing.is_some() {
        return Err((StatusCode::CONFLICT, "Emoji name already taken".into()));
    }

    // Save file
    let upload_id = Uuid::new_v4().to_string();
    let ext = match content_type.as_str() {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    };

    tokio::fs::write(format!("./uploads/{upload_id}.{ext}"), &data)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Write error: {e}")))?;

    sqlx::query("INSERT INTO uploads (id, user_id, filename, mime_type, size) VALUES (?, ?, ?, ?, ?)")
        .bind(&upload_id)
        .bind(&claims.sub)
        .bind(format!("{name}.{ext}"))
        .bind(&content_type)
        .bind(data.len() as i64)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let emoji_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO custom_emoji (id, name, upload_id, user_id) VALUES (?, ?, ?, ?)")
        .bind(&emoji_id)
        .bind(&name)
        .bind(&upload_id)
        .bind(&claims.sub)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok((StatusCode::CREATED, Json(EmojiResponse {
        id: emoji_id,
        name,
        url: format!("/api/uploads/{upload_id}"),
        user_id: claims.sub,
    })))
}

/// Delete a custom emoji (owner only)
pub async fn delete_emoji(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;

    let emoji: CustomEmoji = sqlx::query_as("SELECT * FROM custom_emoji WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Emoji not found".into()))?;

    if emoji.user_id != claims.sub {
        return Err((StatusCode::FORBIDDEN, "You can only delete your own emoji".into()));
    }

    sqlx::query("DELETE FROM custom_emoji WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}
