mod db;
mod entities;
mod models;
mod routes;
mod state;
mod token;
mod ws;

use axum::{
    extract::{DefaultBodyLimit, Request},
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

    /// Database URL (sqlite:<path>?mode=rwc, postgres://..., mysql://...)
    #[arg(short, long, env = "DATABASE_URL")]
    db_url: Option<String>,

    /// Database path (legacy, for SQLite — overridden by --db-url)
    #[arg(long, env = "DATABASE_PATH", default_value = "sivyspeak.db")]
    db_path: String,

    /// External host for invite tokens (e.g. your domain)
    #[arg(long, env = "EXTERNAL_HOST", default_value = "localhost")]
    external_host: String,

    /// External port for invite tokens (e.g. 443 for HTTPS)
    #[arg(long, env = "EXTERNAL_PORT")]
    external_port: Option<u16>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let args = Args::parse();
    let port = args.port;
    let db_path = args.db_path.clone();

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

    // Build database URL: prefer --db-url, fall back to --db-path (SQLite)
    let db_url = args.db_url.unwrap_or_else(|| format!("sqlite:{}?mode=rwc", args.db_path));

    tracing::info!("Initializing database: {}", db_url.split('?').next().unwrap_or(&db_url));
    let db = db::init_db(&db_url).await;

    // Seed default invite code (ignore conflict)
    let invite_code = token::generate_invite_code();
    {
        use sea_orm::{EntityTrait, Set};
        use entities::invite_code;
        let seed = invite_code::ActiveModel {
            code: Set(invite_code.clone()),
            created_at: Set(chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()),
            uses: Set(0),
            max_uses: Set(None),
            server_id: Set("default".to_string()),
        };
        let _ = invite_code::Entity::insert(seed)
            .on_conflict(
                sea_orm::sea_query::OnConflict::column(invite_code::Column::Code)
                    .do_nothing()
                    .to_owned(),
            )
            .do_nothing()
            .exec(&db)
            .await;
    }

    let conn_token = models::ConnectionToken {
        host: args.external_host.clone(),
        port: args.external_port.unwrap_or(port),
        invite_code: invite_code.clone(),
    };
    let encoded_token = token::encode_token(&conn_token);

    let state = AppState::new(
        db.clone(),
        jwt_secret,
        args.external_host,
        args.external_port.unwrap_or(port),
    );

    // --- Setup Key: generate if no users exist ---
    {
        use sea_orm::{EntityTrait, PaginatorTrait};
        let user_count = entities::user::Entity::find()
            .count(&db)
            .await
            .unwrap_or(0);

        if user_count == 0 {
            use rand::Rng;
            let key: String = rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(24)
                .map(char::from)
                .collect();
            let setup_key = format!("setup-{}", key);
            *state.setup_key.lock().await = Some(setup_key.clone());

            println!();
            println!("  ╔══════════════════════════════════════════════╗");
            println!("  ║          🔑 SETUP KEY (first admin)          ║");
            println!("  ╠══════════════════════════════════════════════╣");
            println!("  ║  {:<45}║", &setup_key);
            println!("  ╠══════════════════════════════════════════════╣");
            println!("  ║  Enter this key when registering to become   ║");
            println!("  ║  the server admin. One-time use only!        ║");
            println!("  ╚══════════════════════════════════════════════╝");
            println!();
        }
    }

    let allowed_host = state.external_host.clone();
    let allowed_port = port;

    let app = Router::new()
        // Auth
        .route("/api/register", post(routes::auth::register))
        .route("/api/login", post(routes::auth::login))
        .route("/api/me", get(routes::auth::get_me))
        .route("/api/setup-status", get(routes::auth::setup_status))
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
        // E2E Encryption
        .route("/api/keys", put(routes::encryption::upload_key))
        .route("/api/keys/{user_id}", get(routes::encryption::get_user_key))
        .route("/api/channels/{channel_id}/keys", get(routes::encryption::get_channel_keys))
        .route("/api/channels/{channel_id}/encrypted", put(routes::encryption::set_channel_encrypted))
        // Messages
        .route("/api/messages/{message_id}", put(routes::messages::edit_message))
        .route("/api/messages/{message_id}", delete(routes::messages::delete_message))
        // Federation
        .route("/api/federation", get(routes::federation::get_federation_status))
        .route("/api/federation/peers", post(routes::federation::add_peer))
        .route("/api/federation/accept", post(routes::federation::accept_peer))
        .route("/api/federation/peers/{peer_id}", delete(routes::federation::remove_peer))
        .route("/api/federation/peers/{peer_id}/activate", post(routes::federation::activate_peer))
        .route("/api/federation/channels", post(routes::federation::link_channel))
        .route("/api/federation/channels/{link_id}", delete(routes::federation::unlink_channel))
        .route("/api/federation/message", post(routes::federation::receive_federated_message)
            .layer(DefaultBodyLimit::max(65_536))) // 64KB limit for federation messages
        // Multi-Server (Guilds)
        .route("/api/servers", get(routes::servers::list_servers))
        .route("/api/servers", post(routes::servers::create_server))
        .route("/api/servers/{server_id}", get(routes::servers::get_server))
        .route("/api/servers/{server_id}", put(routes::servers::update_server))
        .route("/api/servers/{server_id}", delete(routes::servers::delete_server))
        .route("/api/servers/{server_id}/join", post(routes::servers::join_server_by_id))
        .route("/api/servers/{server_id}/leave", post(routes::servers::leave_server))
        .route("/api/servers/{server_id}/members", get(routes::servers::list_server_members))
        // WebSocket
        .route("/ws", get(ws::ws_handler))
        // Middleware
        .layer(CorsLayer::permissive())
        .layer(middleware::from_fn(move |req, next| {
            validate_host(req, next, allowed_host.clone(), allowed_port)
        }))
        // State
        .with_state(state.clone());

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

    // WARN-3 + WARN-5: Background cleanup task for empty channels and rate limiter
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            cleanup_state.cleanup_empty_channels();
            cleanup_state.auth_rate_limiter.cleanup();
        }
    });

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
