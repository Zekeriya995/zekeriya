#!/usr/bin/env python3
"""
NEXUS PRO — VPS heartbeat sender.

Posts a small JSON payload to the proxy's `/api/vps-heartbeat`
endpoint once a minute so the PWA can light up its `24/7` status
pill. This lets users see at a glance that nexus_notifier.py is
alive without having to SSH into the VPS.

Usage on the VPS:

    1. Install: drop this file at /root/heartbeat.py.
    2. Wire it from nexus_notifier.py at startup:

        from heartbeat import start_heartbeat
        start_heartbeat()

    3. (Optional) Bump the running counters from inside the
       v2_patch pipeline so the dashboard pill tooltip can show
       "sent / dropped today":

        from heartbeat import bump_sent, bump_dropped
        ...
        bump_sent()      # call when a Telegram message is sent
        bump_dropped()   # call when v2_should_send() returns False

The thread is a daemon, exits with the parent process. A failed POST
is silently retried at the next interval — never blocks notifier work.

Environment overrides:

    NEXUS_HEARTBEAT_URL    full URL of the endpoint (defaults to the
                           public proxy)
    NEXUS_NOTIFY_SECRET    same shared secret used for /notify;
                           sent in the X-Notify-Secret header
    NEXUS_HEARTBEAT_VERSION human-readable version label, e.g. "v2.1"
"""
import json
import os
import threading
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://jolly-bush-9254.nexus-proxy.workers.dev/api/vps-heartbeat"
INTERVAL_SECONDS = 60

_state = {
    "started_at": time.time(),
    "sent": 0,
    "dropped": 0,
}
_lock = threading.Lock()


def bump_sent(n: int = 1) -> None:
    with _lock:
        _state["sent"] += n


def bump_dropped(n: int = 1) -> None:
    with _lock:
        _state["dropped"] += n


def _post_once() -> None:
    url = os.environ.get("NEXUS_HEARTBEAT_URL", DEFAULT_URL)
    secret = os.environ.get("NEXUS_NOTIFY_SECRET", "")
    version = os.environ.get("NEXUS_HEARTBEAT_VERSION", "v2")
    with _lock:
        payload = {
            "version": version,
            "uptime": int(time.time() - _state["started_at"]),
            "notifierAlive": True,
            "sent": _state["sent"],
            "dropped": _state["dropped"],
        }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Notify-Secret": secret,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            r.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        # Silently swallow — the worker is the source of truth and a
        # transient failure here must NEVER block notifier work.
        pass


def _loop() -> None:
    # Send immediately on start so the pill flips green within 60s of
    # the first user opening the app post-deploy, then settle into the
    # 60-second cadence.
    _post_once()
    while True:
        time.sleep(INTERVAL_SECONDS)
        _post_once()


_thread_started = False


def start_heartbeat() -> None:
    """Idempotent — calling more than once is a no-op."""
    global _thread_started
    if _thread_started:
        return
    _thread_started = True
    t = threading.Thread(target=_loop, name="nexus-heartbeat", daemon=True)
    t.start()


if __name__ == "__main__":
    # Self-test: send one heartbeat synchronously and print the result.
    print("Sending heartbeat to:", os.environ.get("NEXUS_HEARTBEAT_URL", DEFAULT_URL))
    bump_sent(3)
    bump_dropped(7)
    _post_once()
    print("Done — check the PWA dashboard pill.")
