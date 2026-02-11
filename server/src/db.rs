use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::path::Path;

pub async fn init_pool(db_path: &str) -> SqlitePool {
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
    let migrations = [
        include_str!("../migrations/001_initial.sql"),
        include_str!("../migrations/002_voice_channels.sql"),
    ];

    for migration_sql in &migrations {
        // Strip comment lines first, then split by semicolons
        let cleaned: String = migration_sql
            .lines()
            .filter(|line| !line.trim_start().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");

        for statement in cleaned.split(';') {
            let stmt = statement.trim();
            if !stmt.is_empty() {
                sqlx::query(stmt)
                    .execute(pool)
                    .await
                    .unwrap_or_else(|e| {
                        tracing::warn!("Migration statement skipped: {e}");
                        Default::default()
                    });
            }
        }
    }

    tracing::info!("Database migrations applied successfully");
}
