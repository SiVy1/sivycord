mod db;
mod models;
mod routes;
mod state;
mod token;
mod ws;

use axum::{
    extract::Request,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Router,
};
use clap::Parser;
use tower_http::cors::CorsLayer;

use state::AppState;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Port to listen on
    #[arg(short, long, env = "PORT", default_value_t = 3000)]
    port: u16,

    /// Database path
    #[arg(short, long, env = "DATABASE_PATH", default_value = "sivyspeak.db")]
    db_path: String,

    /// External host for invite tokens (e.g. your domain)
    #[arg(long, env = "EXTERNAL_HOST", default_value = "localhost")]
    external_host: String,

    /// External port for invite tokens (e.g. 443 for HTTPS)
    #[arg(long, env = "EXTERNAL_PORT")]
    external_port: Option<u16>,

    /// Admin nickname for first run
    #[arg(long, env = "ADMIN_NICK")]
    admin_nick: Option<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let args = Args::parse();
    let port = args.port;
    let db_path = args.db_path;

    // JWT secret: from env, from file, or generate and save to file
    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
        let secret_path = std::path::Path::new("jwt_secret.key");
        if let Ok(saved) = std::fs::read_to_string(secret_path) {
            let saved = saved.trim().to_string();
            if !saved.is_empty() {
                tracing::info!("Loaded JWT secret from jwt_secret.key");
                return saved;
            }
        }
        // Generate new secret and persist it
        use rand::Rng;
        let secret: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(64)
            .map(char::from)
            .collect();
        if let Err(e) = std::fs::write(secret_path, &secret) {
            tracing::warn!("Could not save JWT secret to file: {e}");
        } else {
            tracing::info!("Generated and saved JWT secret to jwt_secret.key");
        }
        secret
    });

    // Ensure uploads directory exists
    tokio::fs::create_dir_all("./uploads").await.ok();

    tracing::info!("Initializing database at {db_path}");
    let pool = db::init_pool(&db_path).await;

    // --- First-Run Admin Control ---
    if let Some(nick) = args.admin_nick {
        let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .unwrap_or(0);

        if user_count == 0 {
            use rand::Rng;
            use argon2::{password_hash::{SaltString, rand_core::OsRng}, Argon2, PasswordHasher};

            let temp_password: String = rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(12)
                .map(char::from)
                .collect();

            let salt = SaltString::generate(&mut OsRng);
            let argon2 = Argon2::default();
            let password_hash = argon2
                .hash_password(temp_password.as_bytes(), &salt)
                .expect("Failed to hash password")
                .to_string();

            let user_id = uuid::Uuid::new_v4().to_string();
            let username = nick.to_lowercase();
            let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

            // Create admin user
            sqlx::query("INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)")
                .bind(&user_id)
                .bind(&username)
                .bind(&nick)
                .bind(&password_hash)
                .execute(&pool)
                .await
                .expect("Failed to create admin user");

            // Ensure Admin role exists
            let admin_role_id = "admin-role";
            sqlx::query("INSERT OR IGNORE INTO roles (id, name, color, position, permissions, created_at) VALUES (?, 'Admin', '#FF0000', 999, ?, ?)")
                .bind(admin_role_id)
                .bind(models::Permissions::ADMINISTRATOR.bits())
                .bind(&now)
                .execute(&pool)
                .await
                .ok();

            // Assign Admin role
            sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_at) VALUES (?, ?, ?)")
                .bind(&user_id)
                .bind(admin_role_id)
                .bind(&now)
                .execute(&pool)
                .await
                .ok();

            println!();
            println!("  ╔══════════════════════════════════════════════╗");
            println!("  ║          FIRST-RUN ADMIN CREATED!            ║");
            println!("  ╠══════════════════════════════════════════════╣");
            println!("  ║  Username: {:<34}║", username);
            println!("  ║  Password: {:<34}║", temp_password);
            println!("  ╠══════════════════════════════════════════════╣");
            println!("  ║  PLEASE SAVE THESE CREDENTIALS NOW!          ║");
            println!("  ╚══════════════════════════════════════════════╝");
            println!();
        }
    }

    let invite_code = token::generate_invite_code();
    sqlx::query("INSERT OR IGNORE INTO invite_codes (code, max_uses) VALUES (?, NULL)")
        .bind(&invite_code)
        .execute(&pool)
        .await
        .ok();

    let conn_token = models::ConnectionToken {
        host: args.external_host.clone(),
        port: args.external_port.unwrap_or(port),
        invite_code: invite_code.clone(),
    };
    let encoded_token = token::encode_token(&conn_token);

    let state = AppState::new(
        pool.clone(),
        jwt_secret,
        args.external_host,
        args.external_port.unwrap_or(port),
    );

    let allowed_host = state.external_host.clone();
    let allowed_port = port;

    let app = Router::new()
        // Auth
        .route("/api/register", post(routes::auth::register))
        .route("/api/login", post(routes::auth::login))
        .route("/api/me", get(routes::auth::get_me))
        // Uploads
        .route("/api/upload", post(routes::uploads::upload_file))
        .route("/api/uploads/{id}", get(routes::uploads::serve_upload))
        .route("/api/uploads/emoji/{name}", get(routes::emoji::serve_emoji_by_name))
        .route("/api/me/avatar", put(routes::uploads::upload_avatar))
        // Emoji
        .route("/api/emoji", get(routes::emoji::list_emoji))
        .route("/api/emoji", post(routes::emoji::create_emoji))
        .route("/api/emoji/{id}", delete(routes::emoji::delete_emoji))
        // REST API
        .route("/api/channels", get(routes::channels::list_channels))
        .route("/api/channels", post(routes::channels::create_channel))
        .route(
            "/api/channels/{channel_id}/messages",
            get(routes::messages::get_messages),
        )        .route("/api/invites", post(routes::invite::create_invite))
        .route("/api/join", post(routes::invite::join_server))
        .route("/api/join-direct", post(routes::invite::join_direct))
        .route("/api/server", get(routes::server_info::get_server_info))
        .route("/api/server", put(routes::server_info::update_server_info))
        // Admin
        .route("/api/audit-logs", get(routes::audit_logs::list_audit_logs))
        .route("/api/stats", get(routes::stats::get_server_stats))
        .route("/api/invites", get(routes::invite::list_invites))
        .route("/api/invites/{code}", delete(routes::invite::delete_invite))
        // Members / Bans
        .route("/api/bans", get(routes::members::list_bans))
        .route("/api/members/{user_id}/kick", post(routes::members::kick_member))
        .route("/api/members/{user_id}/ban", post(routes::members::ban_member))
        .route("/api/members/{user_id}/ban", delete(routes::members::unban_member))
        // Roles
        .route("/api/roles", get(routes::roles::list_roles))
        .route("/api/roles", post(routes::roles::create_role))
        .route("/api/roles/{role_id}", put(routes::roles::update_role))
        .route("/api/roles/{role_id}", delete(routes::roles::delete_role))
        .route("/api/roles/assign", post(routes::roles::assign_role))
        .route("/api/roles/{user_id}/{role_id}", delete(routes::roles::remove_role))
        .route("/api/users/{user_id}/roles", get(routes::roles::get_user_roles))
        // Bots
        .route("/api/bots", get(routes::bots::list_bots))
        .route("/api/bots", post(routes::bots::create_bot))
        .route("/api/bots/{bot_id}", get(routes::bots::get_bot))
        .route("/api/bots/{bot_id}", put(routes::bots::update_bot))
        .route("/api/bots/{bot_id}", delete(routes::bots::delete_bot))
        .route("/api/bots/{bot_id}/regenerate-token", post(routes::bots::regenerate_bot_token))
        .route("/api/bots/message", post(routes::bots::bot_send_message))
        // Webhooks
        .route("/api/webhooks", get(routes::webhooks::list_webhooks))
        .route("/api/webhooks", post(routes::webhooks::create_webhook))
        .route("/api/webhooks/{webhook_id}", delete(routes::webhooks::delete_webhook))
        .route("/api/webhooks/{webhook_id}/{token}", post(routes::webhooks::execute_webhook))
        // WebSocket
        .route("/ws", get(ws::ws_handler))
        // Middleware
        .layer(CorsLayer::permissive())
        .layer(middleware::from_fn(move |req, next| {
            validate_host(req, next, allowed_host.clone(), allowed_port)
        }))
        // State
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");

    println!();
    println!("  ╔══════════════════════════════════════════════╗");
    println!("  ║          SivySpeak Server v0.2.0             ║");
    println!("  ╠══════════════════════════════════════════════╣");
    println!("  ║  Running on: http://localhost:{:<14}║", port);
    println!("  ╠══════════════════════════════════════════════╣");
    println!("  ║  Invite Token (copy into client):            ║");
    println!("  ║  {:<45}║", &encoded_token);
    println!("  ╚══════════════════════════════════════════════╝");
    println!();

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

/// Reject requests with an unexpected Host header (DNS rebinding protection).
async fn validate_host(
    req: Request,
    next: Next,
    allowed_host: String,
    allowed_port: u16,
) -> Response {
    if let Some(host_val) = req.headers().get("host").and_then(|v| v.to_str().ok()) {
        let host_str = host_val.split(':').next().unwrap_or(host_val);
        let is_local = host_str == "localhost" || host_str == "127.0.0.1" || host_str == "[::1]";
        let is_allowed = host_str == allowed_host;
        if !is_local && !is_allowed {
            return axum::http::Response::builder()
                .status(421)
                .body(axum::body::Body::from("Misdirected Request"))
                .unwrap()
                .into_response();
        }
    }
    next.run(req).await
}
