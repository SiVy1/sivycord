# Build stage
FROM rust:nightly-slim-bookworm as builder

WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

COPY . .
RUN cargo build --release

# Run stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=builder /usr/src/app/target/release/sivycord-server /app/sivycord-server
COPY --from=builder /usr/src/app/migrations /app/migrations

# Create uploads directory
RUN mkdir /app/uploads

ENV PORT=3000
ENV DATABASE_PATH=/app/data/sivycord.db

EXPOSE 3000

CMD ["./sivycord-server"]
