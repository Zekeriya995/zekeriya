#!/usr/bin/env python3
"""
NEXUS PRO — VPS signal HTTP server.

Tiny stdlib-only HTTP server that serves the JSONL log written by
signal_log.py. The PWA's src/signal-sync.js calls

    GET  /signals?since=<ms>   # read recent signals (public)
    GET  /health               # simple liveness probe (public)

Optional protected paths (only useful when nexus_notifier.py is on a
different host than this server — for the in-process import case the
log file is the bus instead):

    POST /signal               # write a single record from a remote
                                 worker; gated by NEXUS_SIGNAL_SECRET

Run as a systemd service on 127.0.0.1:8787, then expose to the
internet via a Cloudflare Tunnel:

    cloudflared tunnel --url http://127.0.0.1:8787

That returns a stable HTTPS URL like
`https://<random>.trycloudflare.com` — paste it into the platform's
"VPS URL" field. No domain, no Let's Encrypt setup, no firewall pokes.

Why stdlib-only: nexus_notifier.py runs on a Contabo box where the
user manages everything by hand. Adding Flask/FastAPI is one more pip
install + venv to keep current. http.server is Pythons-since-3.0 and
covers what we need (one-line responses, no streaming).
"""
import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# Allow running this file directly OR as `python -m vps.signal_server`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from signal_log import log_signal, read_signals  # noqa: E402

PORT = int(os.environ.get("NEXUS_SIGNAL_PORT", "8787"))
HOST = os.environ.get("NEXUS_SIGNAL_HOST", "127.0.0.1")
SECRET = os.environ.get("NEXUS_SIGNAL_SECRET", "")


class _Handler(BaseHTTPRequestHandler):
    """Hand-rolled router — three endpoints, all small."""

    server_version = "NexusSignal/1.0"

    def log_message(self, fmt, *args):  # noqa: A003 — overriding stdlib
        # Quiet by default; systemd/journalctl gets enough from stderr
        # if something blows up. Override via NEXUS_SIGNAL_VERBOSE=1.
        if os.environ.get("NEXUS_SIGNAL_VERBOSE") == "1":
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ─── helpers ─────────────────────────────────────────────────────

    def _json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # CORS: the PWA loads from a different origin; keep wide open
        # for GETs (data is non-sensitive — it's already in your alerts).
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Signal-Secret")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _check_secret(self):
        if not SECRET:
            return True
        return self.headers.get("X-Signal-Secret", "") == SECRET

    # ─── routes ──────────────────────────────────────────────────────

    def do_OPTIONS(self):  # noqa: N802
        # CORS preflight
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Signal-Secret")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)

        if url.path == "/health":
            self._json(200, {"ok": True, "service": "nexus-signal", "log": str(read_signals.__module__)})
            return

        if url.path == "/signals":
            qs = parse_qs(url.query)
            since = 0
            if qs.get("since"):
                try:
                    since = int(qs["since"][0])
                except ValueError:
                    since = 0
            limit = 200
            if qs.get("limit"):
                try:
                    limit = max(1, min(1000, int(qs["limit"][0])))
                except ValueError:
                    pass
            rows = read_signals(since_ms=since, limit=limit)
            self._json(200, {"ok": True, "count": len(rows), "signals": rows})
            return

        self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):  # noqa: N802
        url = urlparse(self.path)

        if url.path == "/signal":
            if not self._check_secret():
                self._json(401, {"ok": False, "error": "unauthorized"})
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length <= 0 or length > 8192:
                self._json(400, {"ok": False, "error": "bad_length"})
                return
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                self._json(400, {"ok": False, "error": "bad_json"})
                return
            log_signal(
                symbol=body.get("sym") or body.get("symbol", ""),
                kind=body.get("kind", ""),
                score=body.get("score", 0),
                payload=body.get("payload") or {},
            )
            self._json(200, {"ok": True})
            return

        self._json(404, {"ok": False, "error": "not_found"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), _Handler)
    print(f"NEXUS signal-server listening on http://{args.host}:{args.port}")
    if SECRET:
        print("POST /signal protected by NEXUS_SIGNAL_SECRET")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
