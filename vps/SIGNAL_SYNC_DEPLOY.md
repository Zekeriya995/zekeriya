# NEXUS PRO — VPS Signal Sync Deployment

Make the platform display signals with their **real detection time**
(not the cold-start "now" stamp) by syncing the VPS signal log on
every PWA load.

After this is deployed, opening the app after 2 hours offline shows:

> 🐋 BTC تجميع حيتان — منذ ساعتين
> 🚀 SOL اختراق — منذ 35 دقيقة

instead of every backlog event being labelled "now".

---

## Step 1 — Drop the three Python files on the VPS

```bash
cd /root

curl -fsSL https://raw.githubusercontent.com/Zekeriya995/zekeriya/main/vps/signal_log.py    -o signal_log.py
curl -fsSL https://raw.githubusercontent.com/Zekeriya995/zekeriya/main/vps/signal_server.py -o signal_server.py
curl -fsSL https://raw.githubusercontent.com/Zekeriya995/zekeriya/main/vps/wire_signals.py  -o wire_signals.py

# Self-test the log module — appends three records and reads them back
python3 /root/signal_log.py
```

Expected output:

```
OK — 3 signals at /var/log/nexus-signals.jsonl
  1735…  BTC   ULTRA          score=92
  1735…  SOL   BREAKOUT       score=78
  1735…  ETH   WHALE_ACCUM    score=85
```

If `/var/log` isn't writable for the user running the notifier, the
log auto-falls back to `/tmp/nexus-signals.jsonl`.

---

## Step 2 — Wire the log into `nexus_notifier.py`

> Prerequisite: `wire_v2.py` must have been run first (the v2 quality
> gate provides the anchor lines we patch around).

```bash
sudo systemctl stop nexus-notifier
python3 /root/wire_signals.py
```

Expected:

```
✅ signal logging wired
   import added at top
   _check_ultra: 1 log_signal() inserted
   _check_gem:   1 log_signal() inserted
   syntax check: OK
   backup:       /root/nexus_notifier.py.bak.signals.<timestamp>
```

If the script reports `v2_gate not found`, run `wire_v2.py` first.

---

## Step 3 — Run `signal_server.py` as a systemd service

Create `/etc/systemd/system/nexus-signal.service`:

```ini
[Unit]
Description=NEXUS signal HTTP API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /root/signal_server.py
Restart=on-failure
RestartSec=5
# Optional shared secret — POST /signal calls must include
# X-Signal-Secret matching this value. GET /signals stays public.
Environment=NEXUS_SIGNAL_SECRET=
# Default port is 8787; override here if it clashes.
Environment=NEXUS_SIGNAL_PORT=8787

[Install]
WantedBy=multi-user.target
```

Enable + start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nexus-signal
sudo systemctl status nexus-signal --no-pager
```

Smoke-test:

```bash
curl -s http://127.0.0.1:8787/health
curl -s 'http://127.0.0.1:8787/signals?since=0&limit=5' | head -c 400
```

---

## Step 4 — Restart the notifier

```bash
sudo systemctl start nexus-notifier
sudo journalctl -u nexus-notifier -f --since "1 min ago"
```

Within a minute or two `/var/log/nexus-signals.jsonl` will start
growing. Watch live:

```bash
tail -f /var/log/nexus-signals.jsonl
```

---

## Step 5 — Expose the API via Cloudflare Tunnel

The PWA fetches over HTTPS, so the local 8787 port needs a public TLS
URL. Cloudflare Tunnel is free and works without a domain or
Let's Encrypt setup.

Install once:

```bash
# Debian / Ubuntu
sudo wget -O /usr/local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo chmod +x /usr/local/bin/cloudflared
```

Run the quick tunnel (no Cloudflare account needed):

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

You'll see a URL like:

```
+-------------------------------------------------------------+
|  Your quick tunnel has been created! Visit:                 |
|  https://random-name-123.trycloudflare.com                  |
+-------------------------------------------------------------+
```

Copy that URL.

For a permanent tunnel that survives reboots, follow Cloudflare's
"Named Tunnel" docs — but the quick tunnel is fine for testing.

To keep it running after you log out, run via `tmux` or as a service:

```ini
# /etc/systemd/system/nexus-tunnel.service
[Unit]
Description=Cloudflare Tunnel for NEXUS signal API
After=nexus-signal.service
Requires=nexus-signal.service

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nexus-tunnel
journalctl -u nexus-tunnel -n 20    # the tunnel URL is in the logs
```

---

## Step 6 — Paste the tunnel URL into the platform

Open the PWA on your phone. Sidebar (☰) → **🔗 مزامنة VPS** → paste the
tunnel URL → tap save.

Within 2 seconds the platform fetches `/signals?since=0` and merges
the last 24h of records into your notification log with their real
timestamps. After that, polling runs every 60 seconds while the app
is open.

The notification popup briefly shows:

> 🔄 مزامنة VPS — تمت مزامنة 47 إشارة جديدة من VPS

---

## Verification

- `journalctl -u nexus-signal -f` shows GET requests every minute.
- `tail -f /var/log/nexus-signals.jsonl` grows whenever the notifier
  fires a real signal.
- The platform's notification log shows entries with **منذ X دقيقة**
  badges, not "الآن".
- The Live System Status panel in the sidebar shows fresh latency
  even when the kline streams are quiet.

## Rollback

If anything misbehaves:

```bash
# 1. restore the backup wire_signals.py made
ls /root/nexus_notifier.py.bak.signals.*
sudo cp /root/nexus_notifier.py.bak.signals.<TIMESTAMP> /root/nexus_notifier.py
sudo systemctl restart nexus-notifier

# 2. stop the signal server / tunnel
sudo systemctl stop nexus-signal nexus-tunnel
sudo systemctl disable nexus-signal nexus-tunnel
```

`signal_log.py` is otherwise inert — leaving the file in place causes
no side effects. You can also clear the URL field in the platform
sidebar to immediately disable client-side syncing.
