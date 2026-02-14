use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use std::path::Path;

/// Initialize the database connection.
///
/// Supported URL schemes:
/// - `sqlite:<path>?mode=rwc` — SQLite (default, auto-runs migrations)
/// - `postgres://user:pass@host/db` — PostgreSQL
/// - `mysql://user:pass@host/db` — MySQL
///
/// For SQLite the existing incremental migrations are applied automatically.
/// For Postgres/MySQL run the provided `schema_postgres.sql` or `schema_mysql.sql`
/// before starting the server for the first time.
pub async fn init_db(db_url: &str) -> DatabaseConnection {
    // For SQLite, ensure parent directory exists and run migrations
    if db_url.starts_with("sqlite:") {
        let path = db_url
            .strip_prefix("sqlite:")
            .unwrap()
            .split('?')
            .next()
            .unwrap();
        if let Some(parent) = Path::new(path).parent() {
            tokio::fs::create_dir_all(parent).await.ok();
        }

        let abs_path = std::fs::canonicalize(path)
            .unwrap_or_else(|_| std::path::PathBuf::from(path));
        tracing::info!("Database absolute path: {:?}", abs_path);

        // Run SQLite migrations using sqlx (same version sea-orm uses internally)
        run_sqlite_migrations(db_url).await;
    }

    let mut opts = ConnectOptions::new(db_url);
    opts.max_connections(5);

    let db = Database::connect(opts)
        .await
        .expect("Failed to connect to database");

    tracing::info!("Database connected successfully ({})", db_url.split(':').next().unwrap_or("unknown"));

    db
}

/// Run SQLite incremental migrations via sqlx::migrate!
async fn run_sqlite_migrations(db_url: &str) {
    use sqlx::sqlite::SqlitePoolOptions;

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(db_url)
        .await
        .expect("Failed to connect to SQLite for migrations");

    if let Err(e) = sqlx::migrate!("./migrations").run(&pool).await {
        tracing::error!("Database migration failed: {}", e);
        panic!("Database migration failed: {}", e);
    }

    tracing::info!("SQLite migrations applied successfully");
    pool.close().await;
}
