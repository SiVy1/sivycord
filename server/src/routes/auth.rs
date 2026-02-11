use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use argon2::{
    password_hash::{rand_core::OsRng, SaltString, PasswordHash, PasswordHasher, PasswordVerifier},
    Argon2,
};
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;

// ─── JWT Claims ───

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,        // user_id
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

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), (StatusCode, String)> {
    let username = req.username.trim().to_lowercase();
    let display_name = req.display_name.trim().to_string();
    let password = req.password.trim().to_string();

    // Validate
    if username.len() < 3 || username.len() > 32 {
        return Err((StatusCode::BAD_REQUEST, "Username must be 3-32 characters".into()));
    }
    if !username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err((StatusCode::BAD_REQUEST, "Username can only contain letters, numbers, _ and -".into()));
    }
    if password.len() < 4 {
        return Err((StatusCode::BAD_REQUEST, "Password must be at least 4 characters".into()));
    }
    if display_name.is_empty() || display_name.len() > 32 {
        return Err((StatusCode::BAD_REQUEST, "Display name must be 1-32 characters".into()));
    }

    // Check duplicate
    let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM users WHERE username = ?")
        .bind(&username)
        .fetch_optional(&state.db)
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
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Hash error: {e}")))?
        .to_string();

    let user_id = Uuid::new_v4().to_string();

    sqlx::query("INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)")
        .bind(&user_id)
        .bind(&username)
        .bind(&display_name)
        .bind(&password_hash)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let token = create_jwt(&state.jwt_secret, &user_id, &username, &display_name)?;

    Ok((StatusCode::CREATED, Json(AuthResponse {
        token,
        user: UserInfo {
            id: user_id,
            username,
            display_name,
            avatar_url: None,
        },
    })))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    let username = req.username.trim().to_lowercase();

    #[derive(sqlx::FromRow)]
    struct UserRow {
        id: String,
        username: String,
        display_name: String,
        password_hash: String,
        avatar_url: Option<String>,
    }

    let user: UserRow = sqlx::query_as("SELECT id, username, display_name, password_hash, avatar_url FROM users WHERE username = ?")
        .bind(&username)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid username or password".into()))?;

    // Verify password
    let parsed_hash = PasswordHash::new(&user.password_hash)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Hash parse error".into()))?;

    Argon2::default()
        .verify_password(req.password.as_bytes(), &parsed_hash)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid username or password".to_string()))?;

    let token = create_jwt(&state.jwt_secret, &user.id, &user.username, &user.display_name)?;

    Ok(Json(AuthResponse {
        token,
        user: UserInfo {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
        },
    }))
}

pub async fn get_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UserInfo>, (StatusCode, String)> {
    let claims = extract_claims(&state.jwt_secret, &headers)?;

    #[derive(sqlx::FromRow)]
    struct UserRow {
        id: String,
        username: String,
        display_name: String,
        avatar_url: Option<String>,
    }

    let user: UserRow = sqlx::query_as("SELECT id, username, display_name, avatar_url FROM users WHERE id = ?")
        .bind(&claims.sub)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".into()))?;

    Ok(Json(UserInfo {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
    }))
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
    let auth = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, "Missing Authorization header".into()))?;

    let token = auth.strip_prefix("Bearer ")
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid Authorization format".into()))?;

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
