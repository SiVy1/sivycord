# Build stage — cached dependency layer for faster rebuilds
FROM rust:1.84-slim-bookworm as builder

WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Cache dependencies — only re-download when Cargo.toml changes
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && \
    cargo build --release 2>/dev/null || true && \
    rm -rf src

# Build actual application
COPY . .
RUN touch src/main.rs && cargo build --release

# Run stage — minimal image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y libssl3 ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=builder /usr/src/app/target/release/sivyspeak-server /app/sivyspeak-server
COPY --from=builder /usr/src/app/migrations /app/migrations

RUN mkdir -p /app/data /app/uploads

ENV PORT=3000
ENV DATABASE_PATH=/app/data/sivyspeak.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/api/server || exit 1

CMD ["./sivyspeak-server"]
