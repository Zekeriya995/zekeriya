#!/usr/bin/env python3
"""
NEXUS PRO — VPS signal log (append-only JSONL).

Every signal nexus_notifier.py detects (ULTRA, GEM, whale-accumulation,
breakout, scanner-pick, …) is appended to /var/log/nexus-signals.jsonl
with the real wall-clock timestamp of detection. The PWA reads this
log via signal_server.py + a Cloudflare Tunnel so a user opening the
app after hours of being closed sees the actual event timeline:

    "BTC تجميع حيتان — منذ ساعتين"
    "SOL اختراق — منذ 35 دقيقة"

instead of the misleading "now" labels every signal currently gets
when the platform replays them on cold start.

Public API:

    from signal_log import log_signal
    log_signal(symbol="BTC", kind="ULTRA", score=92, payload={
        "tier": "Diamond",
        "reason": "whale_accumulation + early_breakout",
        "price": 81234.5,
    })

The file is opened in append mode for every call so the
process can be killed mid-write without corrupting earlier
records. JSONL keeps each line independent — a partial write
on a crash drops at most one event.

Bound by `MAX_BYTES`: when the log exceeds the cap we keep the last
~80 % and drop the oldest. A SQLite-backed store would be more
efficient, but the dependency-free stdlib path makes deployment
trivial — drop the file and go.
"""
import json
import os
import threading
import time
from pathlib import Path

LOG_PATH = Path(os.environ.get("NEXUS_SIGNAL_LOG", "/var/log/nexus-signals.jsonl"))
MAX_BYTES = 4 * 1024 * 1024  # ~4 MB → tens of thousands of records
KEEP_FRACTION = 0.8

_write_lock = threading.Lock()


def _ensure_dir() -> None:
    """Create the parent directory on first call (idempotent)."""
    parent = LOG_PATH.parent
    if not parent.exists():
        try:
            parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            # Fallback to /tmp if /var/log isn't writable
            globals()["LOG_PATH"] = Path("/tmp/nexus-signals.jsonl")


def log_signal(symbol: str, kind: str, score: int = 0, payload: dict = None) -> None:
    """Append one signal to the JSONL log.

    Parameters
    ----------
    symbol : "BTC", "ETH", … (USDT pair shorthand the platform uses).
    kind   : "ULTRA", "GEM", "WHALE_ACCUM", "BREAKOUT", "SCANNER_PICK",
             "PRICE_ALERT", or any other label the front-end groups by.
    score  : 0-100 confidence; the PWA can sort/filter on this.
    payload: anything else worth showing in the notification body —
             tier, reason, price, percentage move, ...
    """
    if not symbol or not kind:
        return
    record = {
        "t": int(time.time() * 1000),  # milliseconds — matches Date.now()
        "sym": str(symbol).upper(),
        "kind": str(kind).upper(),
        "score": int(score) if score else 0,
        "payload": payload if isinstance(payload, dict) else {},
    }
    line = json.dumps(record, separators=(",", ":"), ensure_ascii=False)
    with _write_lock:
        _ensure_dir()
        try:
            with LOG_PATH.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            return
        # Cheap size guard — only check every ~100 writes via timestamp parity.
        if record["t"] % 100 == 0:
            _maybe_rotate()


def _maybe_rotate() -> None:
    """Trim the log if it exceeds MAX_BYTES.

    We keep the last KEEP_FRACTION (default 80 %) of the file. The
    operation is best-effort; on failure the log keeps growing and a
    later call will retry.
    """
    try:
        size = LOG_PATH.stat().st_size
    except OSError:
        return
    if size <= MAX_BYTES:
        return
    keep = int(size * KEEP_FRACTION)
    try:
        with LOG_PATH.open("rb") as fh:
            fh.seek(-keep, os.SEEK_END)
            # Drop the (likely partial) first line so we keep clean records.
            fh.readline()
            tail = fh.read()
        tmp = LOG_PATH.with_suffix(".tmp")
        with tmp.open("wb") as out:
            out.write(tail)
        os.replace(tmp, LOG_PATH)
    except OSError:
        pass


def read_signals(since_ms: int = 0, limit: int = 200) -> list:
    """Read records with t >= since_ms. Returns newest-first up to `limit`.

    Used by signal_server.py to serve the PWA's /signals endpoint.
    Errors return [] so the API never 500s on a missing/empty file.
    """
    if not LOG_PATH.exists():
        return []
    out = []
    try:
        with LOG_PATH.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if rec.get("t", 0) >= since_ms:
                    out.append(rec)
    except OSError:
        return []
    out.sort(key=lambda r: r.get("t", 0), reverse=True)
    return out[:limit]


if __name__ == "__main__":
    # Self-test: write three records, read them back.
    log_signal("BTC", "ULTRA", 92, {"tier": "Diamond", "reason": "self-test"})
    log_signal("SOL", "BREAKOUT", 78, {"price": 215.4, "tf": "15m"})
    log_signal("ETH", "WHALE_ACCUM", 85, {"buy": 1240000})
    rows = read_signals()
    print(f"OK — {len(rows)} signals at {LOG_PATH}")
    for r in rows[:3]:
        print(f"  {r['t']}  {r['sym']:<5} {r['kind']:<14} score={r['score']}")
