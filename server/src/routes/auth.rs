use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, Set, ActiveModelTrait};
use sea_orm::sea_query::OnConflict;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::entities::{user, server_member, role, user_role};
use crate::state::AppState;

// ─── JWT Claims ───

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // user_id
    pub username: String,
    pub display_name: String,
    pub exp: usize,
}

// ─── Request/Response types ───

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub display_name: String,
    /// Optional one-time setup key to claim admin on first registration
    pub setup_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserInfo,
}

#[derive(Debug, Serialize, Clone)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

// ─── Routes ───

/// Extract client IP from headers (X-Forwarded-For, X-Real-IP, or fallback)
fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string())
}

pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), (StatusCode, String)> {
    // Rate limit
    let ip = client_ip(&headers);
    if !state.auth_rate_limiter.check(&ip) {
        return Err((StatusCode::TOO_MANY_REQUESTS, "Too many requests, try again later".into()));
    }

    let username = req.username.trim().to_lowercase();
    let display_name = req.display_name.trim().to_string();
    let password = req.password.trim().to_string();

    // Validate
    if username.len() < 3 || username.len() > 32 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Username must be 3-32 characters".into(),
        ));
    }
    if !username
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Username can only contain letters, numbers, _ and -".into(),
        ));
    }
    if password.len() < 4 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Password must be at least 4 characters".into(),
        ));
    }
    if display_name.is_empty() || display_name.len() > 32 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Display name must be 1-32 characters".into(),
        ));
    }

    // Check duplicate
    let existing = user::Entity::find()
        .filter(user::Column::Username.eq(&username))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if existing.is_some() {
        return Err((StatusCode::CONFLICT, "Username already taken".into()));
    }

    // Hash password
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Hash error: {e}"),
            )
        })?
        .to_string();

    let user_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_user = user::ActiveModel {
        id: Set(user_id.clone()),
        username: Set(username.clone()),
        display_name: Set(display_name.clone()),
        password_hash: Set(password_hash),
        avatar_url: Set(None),
        created_at: Set(now.clone()),
    };

    user::Entity::insert(new_user)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Add user to the default server
    let sm = server_member::ActiveModel {
        server_id: Set("default".to_string()),
        user_id: Set(user_id.clone()),
        joined_at: Set(now.clone()),
    };
    let _ = server_member::Entity::insert(sm)
        .on_conflict(
            OnConflict::columns([server_member::Column::ServerId, server_member::Column::UserId])
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec(&state.db)
        .await;

    // If setup_key provided, validate and grant admin role
    if let Some(key) = &req.setup_key {
        let key = key.trim();
        if !key.is_empty() {
            let mut setup_key_guard = state.setup_key.lock().await;
            if let Some(ref valid_key) = *setup_key_guard {
                // Constant-time comparison to prevent timing attacks
                let keys_match = key.as_bytes().ct_eq(valid_key.as_bytes()).into();
                if keys_match {
                    // Grant admin role
                    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
                    let admin_role_id = "admin-role";

                    // Ensure Admin role exists (for default server)
                    let admin_role = role::ActiveModel {
                        id: Set(admin_role_id.to_string()),
                        name: Set("Admin".to_string()),
                        color: Set(Some("#FF0000".to_string())),
                        position: Set(999),
                        permissions: Set(crate::models::Permissions::ADMINISTRATOR.bits()),
                        created_at: Set(now.clone()),
                        server_id: Set("default".to_string()),
                    };
                    let _ = role::Entity::insert(admin_role)
                        .on_conflict(
                            OnConflict::column(role::Column::Id)
                                .do_nothing()
                                .to_owned(),
                        )
                        .do_nothing()
                        .exec(&state.db)
                        .await;

                    // Assign role
                    let ur = user_role::ActiveModel {
                        user_id: Set(user_id.clone()),
                        role_id: Set(admin_role_id.to_string()),
                        assigned_at: Set(now),
                    };
                    let _ = user_role::Entity::insert(ur)
                        .on_conflict(
                            OnConflict::columns([user_role::Column::UserId, user_role::Column::RoleId])
                                .do_nothing()
                                .to_owned(),
                        )
                        .do_nothing()
                        .exec(&state.db)
                        .await;

                    // Consume the key — one-time use
                    *setup_key_guard = None;

                    tracing::info!("Setup key claimed by user '{}' — admin role granted", &username);
                } else {
                    return Err((StatusCode::FORBIDDEN, "Invalid setup key".into()));
                }
            } else {
                return Err((StatusCode::GONE, "Setup key already used".into()));
            }
        }
    }

    let token = create_jwt(&state.jwt_secret, &user_id, &username, &display_name)?;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            token,
            user: UserInfo {
                id: user_id,
                username,
                display_name,
                avatar_url: None,
            },
        }),
    ))
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    // Rate limit
    let ip = client_ip(&headers);
    if !state.auth_rate_limiter.check(&ip) {
        return Err((StatusCode::TOO_MANY_REQUESTS, "Too many requests, try again later".into()));
    }

    let username = req.username.trim().to_lowercase();

    let user_row = user::Entity::find()
        .filter(user::Column::Username.eq(&username))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid username or password".into()))?;

    // Verify password
    let parsed_hash = PasswordHash::new(&user_row.password_hash)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Hash parse error".into()))?;

    Argon2::default()
        .verify_password(req.password.as_bytes(), &parsed_hash)
        .map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                "Invalid username or password".to_string(),
            )
        })?;

    let token = create_jwt(
        &state.jwt_secret,
        &user_row.id,
        &user_row.username,
        &user_row.display_name,
    )?;

    Ok(Json(AuthResponse {
        token,
        user: UserInfo {
            id: user_row.id,
            username: user_row.username,
            display_name: user_row.display_name,
            avatar_url: user_row.avatar_url,
        },
    }))
}

pub async fn get_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UserInfo>, (StatusCode, String)> {
    let claims = extract_claims(&state.jwt_secret, &headers)?;

    let user_row = user::Entity::find_by_id(&claims.sub)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".into()))?;

    Ok(Json(UserInfo {
        id: user_row.id,
        username: user_row.username,
        display_name: user_row.display_name,
        avatar_url: user_row.avatar_url,
    }))
}

/// GET /api/setup-status — check if a setup key is available (for fresh server)
pub async fn setup_status(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let has_key = state.setup_key.lock().await.is_some();
    Json(serde_json::json!({ "setup_key_available": has_key }))
}

// ─── JWT helpers ───

fn create_jwt(
    secret: &str,
    user_id: &str,
    username: &str,
    display_name: &str,
) -> Result<String, (StatusCode, String)> {
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(30))
        .unwrap()
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        username: username.to_string(),
        display_name: display_name.to_string(),
        exp: expiration,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("JWT error: {e}")))
}

pub fn extract_claims(secret: &str, headers: &HeaderMap) -> Result<Claims, (StatusCode, String)> {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or((
            StatusCode::UNAUTHORIZED,
            "Missing Authorization header".into(),
        ))?;

    let token = auth.strip_prefix("Bearer ").ok_or((
        StatusCode::UNAUTHORIZED,
        "Invalid Authorization format".into(),
    ))?;

    decode_jwt(secret, token)
}

pub fn decode_jwt(secret: &str, token: &str) -> Result<Claims, (StatusCode, String)> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| (StatusCode::UNAUTHORIZED, format!("Invalid token: {e}")))?;

    Ok(data.claims)
}
