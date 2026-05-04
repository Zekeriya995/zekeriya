#!/usr/bin/env python3
"""
Wire v2 gate into /root/nexus_notifier.py

Safe: backup → inject → syntax-check → auto-rollback on syntax error.
Idempotent: detects prior wiring and exits without changes.

Usage on VPS:
    python3 /root/wire_v2.py
"""
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

TARGET = Path("/root/nexus_notifier.py")
PATCH = Path("/root/v2_patch.py")
BACKUP = Path(f"/root/nexus_notifier.py.bak.wire.{int(time.time())}")

IMPORT_LINE = "from v2_patch import v2_gate, v2_log"

ULTRA_ANCHOR = re.compile(
    r"(\n    if score < ULTRA_MIN_SCORE:\n        return\n)"
)
ULTRA_INJECT = (
    "\n    if score < ULTRA_MIN_SCORE:\n        return\n"
    "    _v2_ok, _v2_tier, _v2_reason = v2_gate(sym, 'ULTRA', score, v, c)\n"
    "    v2_log(sym, 'ULTRA', _v2_ok, _v2_reason, _v2_tier, score, {})\n"
    "    if not _v2_ok:\n"
    "        return\n"
)

GEM_ANCHOR = re.compile(
    r"(\n    if vx < GEM_VX_MIN:\n        return\n)"
)
GEM_INJECT = (
    "\n    if vx < GEM_VX_MIN:\n        return\n"
    "    _synth = min(100, 50 + int(vx * 4) + min(20, int(c / 2)))\n"
    "    _v2_ok, _v2_tier, _v2_reason = v2_gate(sym, 'GEM', _synth, v, c)\n"
    "    v2_log(sym, 'GEM', _v2_ok, _v2_reason, _v2_tier, _synth, {})\n"
    "    if not _v2_ok:\n"
    "        return\n"
)


def fail(msg, code=1):
    print(f"❌ {msg}", file=sys.stderr)
    sys.exit(code)


def main():
    if not TARGET.exists():
        fail(f"missing: {TARGET}")
    if not PATCH.exists():
        fail(f"missing: {PATCH} — re-run the curl from Phase 2")

    src = TARGET.read_text()

    if IMPORT_LINE in src or "v2_gate" in src:
        print("✅ already wired — no changes made")
        sys.exit(0)

    shutil.copy(TARGET, BACKUP)
    print(f"📦 backup → {BACKUP}")

    lines = src.split("\n")
    last_imp = max(i for i, l in enumerate(lines)
                   if re.match(r"^(import |from )", l))
    lines.insert(last_imp + 1, IMPORT_LINE)
    src = "\n".join(lines)

    new_src, n = ULTRA_ANCHOR.subn(ULTRA_INJECT, src, count=1)
    if n != 1:
        fail("ULTRA anchor not found — file structure changed; aborted")
    src = new_src

    new_src, n = GEM_ANCHOR.subn(GEM_INJECT, src, count=1)
    if n != 1:
        fail("GEM anchor not found — file structure changed; aborted")
    src = new_src

    TARGET.write_text(src)

    result = subprocess.run(
        ["python3", "-m", "py_compile", str(TARGET)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("⚠️  syntax error after wiring — restoring backup")
        print(result.stderr)
        shutil.copy(BACKUP, TARGET)
        fail("rolled back; nothing changed")

    print(f"✅ wired successfully")
    print(f"   import added after line {last_imp + 1}")
    print(f"   _check_ultra: 1 gate inserted")
    print(f"   _check_gem:   1 gate inserted (with synth score)")
    print(f"   syntax check: OK")
    print(f"   backup:       {BACKUP}")
    print()
    print("Next: DRY_RUN test")
    print("  sudo systemctl stop nexus-notifier")
    print("  timeout 1800 env NEXUS_DRY_RUN=1 PYTHONUNBUFFERED=1 \\")
    print("      python3 /root/nexus_notifier.py 2>&1 | tee /tmp/v2_dry.log | grep '\\[V2'")


if __name__ == "__main__":
    main()
