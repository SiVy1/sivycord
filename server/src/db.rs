use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::path::Path;

pub async fn init_pool(db_path: &str) -> SqlitePool {
    let abs_path = std::fs::canonicalize(db_path)
        .unwrap_or_else(|_| std::path::PathBuf::from(db_path));
    tracing::info!("Database absolute path: {:?}", abs_path);

    // Ensure parent directory exists
    if let Some(parent) = Path::new(db_path).parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }

    let url = format!("sqlite:{}?mode=rwc", db_path);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .expect("Failed to connect to SQLite");

    // Run migrations
    run_migrations(&pool).await;

    pool
}

async fn run_migrations(pool: &SqlitePool) {
    if let Err(e) = sqlx::migrate!("./migrations").run(pool).await {
        tracing::error!("Database migration failed: {}", e);
        // We probably shouldn't continue if migrations failed
        panic!("Database migration failed: {}", e);
    }

    tracing::info!("Database migrations applied successfully");
}
