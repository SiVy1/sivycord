mod db;
mod models;
mod routes;
mod state;
mod token;
mod ws;

use axum::{
    routing::{delete, get, post, put},
    Router,
};
use tower_http::cors::CorsLayer;

use state::AppState;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse()
        .expect("Invalid PORT");

    let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "sivycord.db".to_string());

    // JWT secret: from env or generate random
    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
        use rand::Rng;
        let secret: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(64)
            .map(char::from)
            .collect();
        tracing::info!("Generated random JWT secret (set JWT_SECRET env for persistence)");
        secret
    });

    // Ensure uploads directory exists
    tokio::fs::create_dir_all("./uploads").await.ok();

    tracing::info!("Initializing database at {db_path}");
    let pool = db::init_pool(&db_path).await;

    // Auto-generate an invite code on startup
    let invite_code = token::generate_invite_code();
    sqlx::query("INSERT INTO invite_codes (code, max_uses) VALUES (?, NULL)")
        .bind(&invite_code)
        .execute(&pool)
        .await
        .ok();

    let conn_token = models::ConnectionToken {
        host: "localhost".to_string(),
        port,
        invite_code: invite_code.clone(),
    };
    let encoded_token = token::encode_token(&conn_token);

    let state = AppState::new(pool.clone(), jwt_secret);

    let app = Router::new()
        // Auth
        .route("/api/register", post(routes::auth::register))
        .route("/api/login", post(routes::auth::login))
        .route("/api/me", get(routes::auth::get_me))
        // Uploads
        .route("/api/upload", post(routes::uploads::upload_file))
        .route("/api/uploads/{id}", get(routes::uploads::serve_upload))
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
        )
        .route("/api/invites", post(routes::invite::create_invite))
        .route("/api/join", post(routes::invite::join_server))
        .route("/api/join-direct", post(routes::invite::join_direct))
        .route("/api/server", get(routes::server_info::get_server_info))
        // WebSocket
        .route("/ws", get(ws::ws_handler))
        // Middleware
        .layer(CorsLayer::permissive())
        // State
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");

    println!();
    println!("  ╔══════════════════════════════════════════════╗");
    println!("  ║           SiVyCord Server v0.2.0             ║");
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
