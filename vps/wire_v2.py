#!/usr/bin/env python3
"""
Wire v2 gate into /root/nexus_notifier.py

Safe: backup → inject → syntax-check → auto-rollback on syntax error.
Idempotent: detects prior wiring and exits without changes.

Usage on VPS:
    python3 /root/wire_v2.py            # apply
    python3 /root/wire_v2.py --dry-run  # show patch, write nothing
"""
import argparse
import hashlib
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


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def transform(src: str) -> str:
    """Apply both injections + the import line. Raises ValueError on
    any anchor mismatch so the caller can decide whether to abort or
    retry against a different snapshot."""
    if IMPORT_LINE in src or "v2_gate" in src:
        raise ValueError("already wired")

    lines = src.split("\n")
    imp_indices = [
        i for i, l in enumerate(lines) if re.match(r"^(import |from )", l)
    ]
    if not imp_indices:
        raise ValueError("no import statements found in target")
    lines.insert(imp_indices[-1] + 1, IMPORT_LINE)
    out = "\n".join(lines)

    out, n = ULTRA_ANCHOR.subn(ULTRA_INJECT, out, count=1)
    if n != 1:
        raise ValueError("ULTRA anchor not found")

    out, n = GEM_ANCHOR.subn(GEM_INJECT, out, count=1)
    if n != 1:
        raise ValueError("GEM anchor not found")
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change without writing the file",
    )
    args = parser.parse_args()

    if not TARGET.exists():
        fail(f"missing: {TARGET}")
    if not PATCH.exists():
        fail(f"missing: {PATCH} — re-run the curl from Phase 2")

    src = TARGET.read_text()
    before_hash = sha256_of(TARGET)

    try:
        new_src = transform(src)
    except ValueError as e:
        msg = str(e)
        if msg == "already wired":
            print("✅ already wired — no changes made")
            sys.exit(0)
        fail(f"{msg} — file structure changed; aborted")

    if args.dry_run:
        added = len(new_src) - len(src)
        print("🔍 dry run — no file written")
        print(f"   target:        {TARGET}")
        print(f"   sha256 before: {before_hash}")
        print(f"   bytes added:   +{added}")
        print(f"   would write to: {TARGET}")
        sys.exit(0)

    shutil.copy(TARGET, BACKUP)
    print(f"📦 backup → {BACKUP}")

    TARGET.write_text(new_src)

    result = subprocess.run(
        ["python3", "-m", "py_compile", str(TARGET)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("⚠️  syntax error after wiring — restoring backup")
        print(result.stderr)
        shutil.copy(BACKUP, TARGET)
        fail("rolled back; nothing changed")

    after_hash = sha256_of(TARGET)
    print("✅ wired successfully")
    print(f"   sha256 before: {before_hash}")
    print(f"   sha256 after:  {after_hash}")
    print(f"   _check_ultra: 1 gate inserted")
    print(f"   _check_gem:   1 gate inserted (with synth score)")
    print(f"   syntax check: OK")
    print(f"   backup:       {BACKUP}")
    print()
    print("Next: refresh the drift manifest and run the DRY_RUN test")
    print("  bash /root/verify_drift.sh --record")
    print("  sudo systemctl stop nexus-notifier")
    print("  timeout 1800 env NEXUS_DRY_RUN=1 PYTHONUNBUFFERED=1 \\")
    print(
        "      python3 /root/nexus_notifier.py 2>&1 | tee /tmp/v2_dry.log | grep '\\[V2'"
    )


if __name__ == "__main__":
    main()
