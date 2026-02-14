# Deployment & Setup Guide — SivySpeak

## 🛠️ Command-Line Arguments

| Argument          | Environment Variable | Description                                           |
| :---------------- | :------------------- | :---------------------------------------------------- |
| `--port`          | `PORT`               | Port to listen on (default: `3000`)                   |
| `--db-path`       | `DATABASE_PATH`      | Path to the SQLite database (default: `sivyspeak.db`) |
| `--external-host` | `EXTERNAL_HOST`      | External domain/IP for invite tokens (e.g. `sync.pl`) |
| `--external-port` | `EXTERNAL_PORT`      | External port for invite tokens (e.g. `443`)          |

**Example (Windows):**

```powershell
.\sivyspeak-server.exe --port 8080
```

---

## 🛡️ Creating the First Admin (Setup Key)

On first start with an empty database the server generates a **one-time setup key** and prints it to the console:

```
  ╔══════════════════════════════════════════════╗
  ║          🔑 SETUP KEY (first admin)          ║
  ╠══════════════════════════════════════════════╣
  ║  setup-abc123...                             ║
  ╚══════════════════════════════════════════════╝
```

1. Start the server.
2. Copy the setup key from the log output.
3. Open the app, connect to the server, and register a new account.
4. Paste the setup key into the "Setup Key" field during registration.
5. Your account becomes the server admin. The key is consumed and cannot be reused.

---

## 🐧 Linux Deployment (Native — recommended)

The simplest and most lightweight way to run the server. No Docker required — just a single binary + systemd.

### Prerequisites

- A Linux machine (Debian/Ubuntu, Fedora, or Arch)
- `curl`, `gcc`, `pkg-config`, and OpenSSL dev headers (the script installs them automatically)

### Quick Start

1. Copy the `server/` folder to your Linux machine.
2. Run the installer:
   ```bash
   sudo EXTERNAL_HOST=yourdomain.com bash install.sh
   ```
3. Check the logs for the setup key:
   ```bash
   sudo journalctl -u sivyspeak --no-pager | grep setup
   ```

### Configuration

Edit `/opt/sivyspeak/.env` to change settings:

```bash
PORT=3000
DATABASE_PATH=/opt/sivyspeak/data/sivyspeak.db
EXTERNAL_HOST=yourdomain.com
EXTERNAL_PORT=443
# JWT_SECRET=  # leave empty to auto-generate
```

Then restart:

```bash
sudo systemctl restart sivyspeak
```

### Useful Commands

```bash
sudo systemctl status sivyspeak      # check status
sudo journalctl -u sivyspeak -f      # live logs
sudo systemctl restart sivyspeak     # restart
sudo systemctl stop sivyspeak        # stop
```

### Update

To update to a new version:

```bash
cd /path/to/server
git pull               # or copy new files
sudo bash install.sh   # rebuilds and restarts the service
```

The script preserves your existing `.env` and data.

---

## 🐳 Docker (Alternative)

If you prefer Docker, a Dockerfile and docker-compose.yml are included.

```bash
docker-compose up -d --build
docker-compose logs    # check for setup key
```

> Note: Docker requires more resources for building due to Rust compilation inside a container.

---

## 🌐 DNS & HTTPS Configuration

### 1. SRV Record (Easy Connection)

If you want users to type `yourdomain.com` instead of `yourdomain.com:3000`, add an SRV record:

- **Service:** `_sivyspeak`
- **Protocol:** `_tcp`
- **Priority / Weight:** `0`
- **Port:** `3000`
- **Target:** `yourdomain.com`

### 2. Nginx Reverse Proxy (SSL)

To use HTTPS (port 443):

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

> When using SSL (port 443), set `EXTERNAL_PORT=443` so invite tokens use `https://`.

---

## 🔑 Security Notes

- **JWT Secret**: Auto-generated and saved to `jwt_secret.key` on first run. Keep this file safe.
- **Data Persistence**: Database in `data/`, uploads in `uploads/`.
- **Setup Key**: One-time use. If lost before claiming, delete the database and restart.
