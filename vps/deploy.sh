#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  NEXUS PRO V10 — VPS One-Shot Deployment Script
# ═══════════════════════════════════════════════════════════════
#  Target:  Ubuntu 22.04 / 24.04 on Contabo (root or sudo user)
#  Domain:  shamcyrpto.com (override via DOMAIN env var)
#  Repo:    cloned by the operator BEFORE running this script.
#
#  Usage (from inside the cloned repo on the VPS):
#      sudo bash vps/deploy.sh
#
#  Override domain / email at invocation:
#      sudo DOMAIN=mydomain.com EMAIL=me@mail.com bash vps/deploy.sh
#
#  This script is idempotent — re-running it skips already-completed
#  steps and re-applies config changes without breaking state.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────
DOMAIN="${DOMAIN:-shamcyrpto.com}"
EMAIL="${EMAIL:-admin@${DOMAIN}}"
APP_DIR="${APP_DIR:-$(pwd)}"
APP_USER="${APP_USER:-nexus}"
NODE_MAJOR="${NODE_MAJOR:-20}"
PM2_APP_NAME="${PM2_APP_NAME:-nexus-proxy}"

# Color helpers ─────────────────────────────────────────────────
C_RED='\033[0;31m'; C_GRN='\033[0;32m'; C_YLW='\033[0;33m'; C_BLU='\033[0;36m'; C_RST='\033[0m'
log()  { printf "${C_BLU}[deploy]${C_RST} %s\n" "$*"; }
ok()   { printf "${C_GRN}  ✓${C_RST} %s\n" "$*"; }
warn() { printf "${C_YLW}  !${C_RST} %s\n" "$*"; }
die()  { printf "${C_RED}  ✗${C_RST} %s\n" "$*" >&2; exit 1; }

# ─── Pre-flight checks ────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Run as root: sudo bash vps/deploy.sh"
[[ -f "${APP_DIR}/server.js" ]] || die "server.js not found in ${APP_DIR}. Run from the repo root."
[[ -f "${APP_DIR}/package.json" ]] || die "package.json not found. Wrong directory?"

log "Domain: ${DOMAIN} | Email: ${EMAIL} | App dir: ${APP_DIR}"

# ─── 1. System update + base packages ─────────────────────────
log "1/8  Installing base packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg ufw nginx git python3 python3-pip
ok "Base packages ready"

# ─── 2. Node.js (NodeSource) ──────────────────────────────────
log "2/8  Installing Node.js ${NODE_MAJOR}…"
if ! command -v node >/dev/null || [[ $(node -v | sed 's/v//' | cut -d. -f1) -lt ${NODE_MAJOR} ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
ok "Node $(node -v) | npm $(npm -v)"

# ─── 3. PM2 process manager ───────────────────────────────────
log "3/8  Installing PM2…"
if ! command -v pm2 >/dev/null; then
  npm install -g pm2 --silent
fi
ok "PM2 $(pm2 -v) ready"

# ─── 4. App user + dependencies ───────────────────────────────
log "4/8  Setting up app user '${APP_USER}'…"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd -r -m -s /bin/bash "${APP_USER}"
  ok "Created user ${APP_USER}"
else
  ok "User ${APP_USER} exists"
fi
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

log "    Installing npm dependencies (production only)…"
sudo -u "${APP_USER}" -H bash -c "cd '${APP_DIR}' && npm install --omit=dev --silent"
ok "Dependencies installed"

# ─── 5. .env bootstrap ────────────────────────────────────────
log "5/8  Bootstrapping .env…"
if [[ ! -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  sed -i "s|ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}|" "${APP_DIR}/.env"
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
  warn ".env created — edit ${APP_DIR}/.env to add TG_BOT_TOKEN / TG_CHAT_ID later."
else
  ok ".env exists (preserving existing values)"
fi

# ─── 6. nginx + Let's Encrypt ─────────────────────────────────
log "6/8  Configuring nginx for ${DOMAIN}…"
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
cat > "${NGINX_CONF}" <<NGINX
# NEXUS PRO — ${DOMAIN}
# Static assets are served directly from the repo working tree;
# /api/* and /notify are proxied to the Express server on :${PORT:-3000}.

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    # ACME http-01 challenge — kept on plain HTTP for certbot renewal.
    location /.well-known/acme-challenge/ { root /var/www/html; }

    # Everything else redirects to HTTPS (set up by certbot below).
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN} www.${DOMAIN};

    # certbot replaces these placeholders on first run.
    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # Static PWA assets (index.html, app.js, sw.js, src/*, style.css, …).
    root ${APP_DIR};
    index index.html;

    # Service Worker must always revalidate (so deploys actually land).
    location = /sw.js {
        add_header Cache-Control "no-cache";
        try_files \$uri =404;
    }

    # Long-cache hashed/static assets.
    location ~* \.(?:css|js|png|jpg|jpeg|gif|ico|svg|woff2?)\$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800, must-revalidate";
        try_files \$uri =404;
    }

    # Proxy /api/* and /notify to the Express server.
    location ~ ^/(api/|notify) {
        proxy_pass http://127.0.0.1:${PORT:-3000};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
        proxy_connect_timeout 5s;
    }

    # Default: serve the SPA shell.
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Reasonable upload limit (32 KB matches Express body parser).
    client_max_body_size 64k;
}
NGINX

ln -sf "${NGINX_CONF}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default

# Skip the HTTPS server block on first run (cert doesn't exist yet).
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  warn "First run — temporarily disabling HTTPS block until certbot issues a certificate."
  sed -i '/listen 443 ssl/,/^}$/d' "${NGINX_CONF}"
fi

nginx -t
systemctl reload nginx
ok "nginx configured"

log "    Issuing Let's Encrypt certificate…"
if [[ ! -d /opt/certbot ]]; then
  apt-get install -y -qq certbot python3-certbot-nginx
fi
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  certbot --nginx --non-interactive --agree-tos --email "${EMAIL}" \
          -d "${DOMAIN}" -d "www.${DOMAIN}" --redirect
  ok "TLS certificate issued"
else
  ok "Certificate already present (renewal handled by systemd timer)"
fi

# ─── 7. PM2 launch + auto-start ───────────────────────────────
log "7/8  Starting Express server with PM2…"
sudo -u "${APP_USER}" -H bash -c "cd '${APP_DIR}' && pm2 startOrReload ecosystem.config.cjs --update-env || pm2 start server.js --name '${PM2_APP_NAME}' --time"
sudo -u "${APP_USER}" -H bash -c "pm2 save"

# Generate the systemd unit that brings PM2 up on boot.
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" >/dev/null
ok "PM2 service active"

# ─── 8. Firewall ──────────────────────────────────────────────
log "8/8  Locking down firewall (ufw)…"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ok "Firewall: SSH + 80 + 443 open, all else blocked"

# ─── Done ─────────────────────────────────────────────────────
echo
printf "${C_GRN}═══ Deployment complete ═══${C_RST}\n"
echo "  Site:    https://${DOMAIN}"
echo "  Health:  https://${DOMAIN}/api/health"
echo "  Logs:    sudo -u ${APP_USER} pm2 logs ${PM2_APP_NAME}"
echo "  Status:  sudo -u ${APP_USER} pm2 status"
echo
echo "Next steps:"
echo "  1. Edit ${APP_DIR}/.env to add TG_BOT_TOKEN / TG_CHAT_ID (then 'pm2 restart ${PM2_APP_NAME}')."
echo "  2. (Optional) Deploy nexus_notifier.py via vps/V2_DEPLOY.md."
echo
