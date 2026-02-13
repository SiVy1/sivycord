# Deployment & Setup Guide - sivyspeak 6.7

This guide explains how to configure, secure, and deploy your server on both Windows and Linux.

## 🛠️ Command-Line Arguments

The server now supports several CLI arguments to make configuration easier:

| Argument          | Environment Variable | Description                                           |
| :---------------- | :------------------- | :---------------------------------------------------- |
| `--port`          | `PORT`               | Port to listen on (default: `3000`)                   |
| `--db-path`       | `DATABASE_PATH`      | Path to the SQLite database (default: `sivyspeak.db`)  |
| `--admin-nick`    | `ADMIN_NICK`         | Nickname for the first admin created on a fresh DB    |
| `--external-host` | `EXTERNAL_HOST`      | External domain/IP for invite tokens (e.g. `sync.pl`) |
| `--external-port` | `EXTERNAL_PORT`      | External port for invite tokens (e.g. `443`)          |

**Example (Windows):**

```powershell
.\sivyspeak-server.exe --port 8080 --admin-nick "MyCoolAdmin"
```

---

## 🛡️ Creating the First Admin

If you are starting with a **fresh database** and want to create an admin user immediately:

1.  Run the server with the `--admin-nick "YourName"` flag.
2.  The server will check if any users exist. If not, it will:
    - Create a user with the name `"YourName"`.
    - Generate a random 12-character password.
    - Assign the **Admin** role (with full permissions).
3.  **Check the console output!** The password will be printed there only once.

---

## 🐳 Deployment (Linux/Docker)

For the best experience on Linux, we provide a multi-stage Docker setup.

### Prerequisites

- Docker & Docker Compose installed on your Linux machine.

### Quick Start

1.  Copy the `server` folder to your Linux machine.
2.  Edit `docker-compose.yml` to set your desired `ADMIN_NICK`.
3.  Run:
    ```bash
    docker-compose up -d --build
    ```
4.  Check the logs to see your generated admin password:
    ```bash
    docker-compose logs
    ```

### Manual Build (Windows -> Linux)

If you just want to compile for Linux without Docker, we推荐 using Docker as it simplifies dependency management (OpenSSL, etc.).

---

## 🌐 DNS & HTTPS Configuration

To allow users to connect via a clean domain name and secure connection.

### 1. SRV Record (Easy Connection)

If you want users to just type `twojadomena.pl` instead of `twojadomena.pl:3000`, add an SRV record to your DNS provider:

- **Service:** `_sivyspeak`
- **Protocol:** `_tcp`
- **Priority:** `0`
- **Weight:** `0`
- **Port:** `3000` (default)
- **Target:** `twojadomena.pl` (your A record)

### 2. Nginx Reverse Proxy (SSL)

To use HTTPS and WSS (port 443), use Nginx as a reverse proxy:

```nginx
server {
    listen 443 ssl;
    server_name twojadomena.pl;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

> [!IMPORTANT]
> When using SSL (Port 443), make sure to set `EXTERNAL_PORT=443` so invite tokens use `https://`.

---

## 🔑 Security Notes

- **JWT Secret**: The server automatically generates a `jwt_secret.key` file if not provided via the `JWT_SECRET` environment variable. Keep this file safe!
- **Data Persistence**: When using Docker, your data is stored in the `./data` and `./uploads` folders on the host machine.
