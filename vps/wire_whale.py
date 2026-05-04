#!/usr/bin/env python3
"""
Wire v2 gate into _maybe_emit_whale().

Idempotent. Requires wire_v2.py to have run first (for the v2 import line).
Inserts gate AFTER dedup + waves checks, BEFORE render_whale().

Tier derivation:
  1. Try sum(w["amount"]) → tier_whale(total) — uses v1's existing thresholds
  2. Fallback if schema differs: kind=whale_single → Gold, else Silver
"""
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

TARGET = Path("/root/nexus_notifier.py")
BACKUP = Path(f"/root/nexus_notifier.py.bak.whale.{int(time.time())}")

WHALE_ANCHOR = re.compile(
    r"(\n    text = render_whale\(sym, ticker, waves\)\n)"
)

WHALE_INJECT = (
    "\n"
    "    # ===== v2 quality gate (whale) =====\n"
    "    try:\n"
    "        _v2_total = sum(w.get('amount', 0) for w in waves) if waves else 0\n"
    "    except Exception:\n"
    "        _v2_total = 0\n"
    "    if _v2_total > 0:\n"
    "        _v2_lc = tier_whale(_v2_total)\n"
    "    else:\n"
    "        _v2_lc = 'gold' if kind == 'whale_single' else 'silver'\n"
    "    _v2_score = {'diamond': 95, 'gold': 85, 'silver': 75, 'bronze': 50}.get(_v2_lc, 50)\n"
    "    _v2_ok, _v2_tier, _v2_reason = v2_gate(\n"
    "        sym, 'WHALE', _v2_score,\n"
    "        ticker.get('v', 0) or 0, ticker.get('c', 0) or 0\n"
    "    )\n"
    "    v2_log(sym, 'WHALE', _v2_ok, _v2_reason, _v2_tier, _v2_score, {})\n"
    "    if not _v2_ok:\n"
    "        return\n"
    "    # ===================================\n"
    "    text = render_whale(sym, ticker, waves)\n"
)


def fail(msg, code=1):
    print(f"❌ {msg}", file=sys.stderr)
    sys.exit(code)


def main():
    if not TARGET.exists():
        fail(f"missing: {TARGET}")

    src = TARGET.read_text()

    if "v2_gate(\n        sym, 'WHALE'" in src or "v2_gate(sym, 'WHALE'" in src:
        print("✅ whale already gated — no changes")
        sys.exit(0)

    if "from v2_patch import" not in src:
        fail("v2 import not found — run wire_v2.py first")

    shutil.copy(TARGET, BACKUP)
    print(f"📦 backup → {BACKUP}")

    new_src, n = WHALE_ANCHOR.subn(WHALE_INJECT, src, count=1)
    if n != 1:
        fail("whale anchor not found — _maybe_emit_whale structure changed")

    TARGET.write_text(new_src)

    result = subprocess.run(
        ["python3", "-m", "py_compile", str(TARGET)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("⚠️  syntax error — restoring backup")
        print(result.stderr)
        shutil.copy(BACKUP, TARGET)
        fail("rolled back")

    print("✅ whale wired + syntax OK")
    print(f"   backup: {BACKUP}")
    print()
    print("Next: 5-min DRY_RUN to see whale rejections")
    print("  > /tmp/v2_dry.log")
    print("  sudo systemctl stop nexus-notifier")
    print("  timeout 300 env NEXUS_DRY_RUN=1 PYTHONUNBUFFERED=1 \\")
    print("      python3 /root/nexus_notifier.py 2>&1 | tee /tmp/v2_dry.log | grep '\\[V2'")


if __name__ == "__main__":
    main()
