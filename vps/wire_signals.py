#!/usr/bin/env python3
"""
NEXUS PRO — Wire signal_log into /root/nexus_notifier.py.

Idempotent: detects prior wiring and exits cleanly. On syntax error
after patching, restores the backup automatically so a botched anchor
match never leaves the production notifier broken.

Run on the VPS:

    python3 /root/wire_signals.py

What it does:

1. Adds `from signal_log import log_signal` near the other imports.
2. Inserts `log_signal(...)` calls right after the existing v2 gate
   in `_check_ultra` and `_check_gem` so every signal that survives
   the quality filter ALSO lands in the JSONL log.

If the v2 gate hasn't been wired yet (wire_v2.py wasn't run), this
script asks you to run wire_v2.py first — the anchors are part of
the v2 pipeline.
"""
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

TARGET = Path("/root/nexus_notifier.py")
BACKUP = Path(f"/root/nexus_notifier.py.bak.signals.{int(time.time())}")
IMPORT_LINE = "from signal_log import log_signal"

# Anchor: the v2 gate's `if not _v2_ok: return` line for ULTRA. We
# inject our log_signal() call AFTER the gate so dropped signals don't
# pollute the log — only the ones that would have been Telegram'd.
ULTRA_ANCHOR = re.compile(
    r"(    _v2_ok, _v2_tier, _v2_reason = v2_gate\(sym, 'ULTRA', score, v, c\)\n"
    r"    v2_log\(sym, 'ULTRA', _v2_ok, _v2_reason, _v2_tier, score, \{\}\)\n"
    r"    if not _v2_ok:\n"
    r"        return\n)"
)
ULTRA_INJECT = (
    "    _v2_ok, _v2_tier, _v2_reason = v2_gate(sym, 'ULTRA', score, v, c)\n"
    "    v2_log(sym, 'ULTRA', _v2_ok, _v2_reason, _v2_tier, score, {})\n"
    "    if not _v2_ok:\n"
    "        return\n"
    "    log_signal(sym, 'ULTRA', score, {'tier': _v2_tier, 'reason': _v2_reason, 'price': float(c) if c else 0})\n"
)

GEM_ANCHOR = re.compile(
    r"(    _synth = min\(100, 50 \+ int\(vx \* 4\) \+ min\(20, int\(c / 2\)\)\)\n"
    r"    _v2_ok, _v2_tier, _v2_reason = v2_gate\(sym, 'GEM', _synth, v, c\)\n"
    r"    v2_log\(sym, 'GEM', _v2_ok, _v2_reason, _v2_tier, _synth, \{\}\)\n"
    r"    if not _v2_ok:\n"
    r"        return\n)"
)
GEM_INJECT = (
    "    _synth = min(100, 50 + int(vx * 4) + min(20, int(c / 2)))\n"
    "    _v2_ok, _v2_tier, _v2_reason = v2_gate(sym, 'GEM', _synth, v, c)\n"
    "    v2_log(sym, 'GEM', _v2_ok, _v2_reason, _v2_tier, _synth, {})\n"
    "    if not _v2_ok:\n"
    "        return\n"
    "    log_signal(sym, 'GEM', _synth, {'tier': _v2_tier, 'reason': _v2_reason, 'vx': vx})\n"
)


def fail(msg, code=1):
    print(f"❌ {msg}", file=sys.stderr)
    sys.exit(code)


def main():
    if not TARGET.exists():
        fail(f"missing: {TARGET}")
    src = TARGET.read_text()

    if "log_signal(" in src and IMPORT_LINE in src:
        print("✅ already wired — no changes made")
        sys.exit(0)

    if "v2_gate" not in src:
        fail("v2_gate not found — run wire_v2.py first so the anchors exist")

    shutil.copy(TARGET, BACKUP)
    print(f"\U0001f4e6 backup → {BACKUP}")

    if IMPORT_LINE not in src:
        lines = src.split("\n")
        last_imp = max(
            (i for i, ln in enumerate(lines) if re.match(r"^(import |from )", ln)),
            default=0,
        )
        lines.insert(last_imp + 1, IMPORT_LINE)
        src = "\n".join(lines)

    new_src, n_u = ULTRA_ANCHOR.subn(ULTRA_INJECT, src, count=1)
    if n_u != 1:
        fail("ULTRA anchor not found — file structure changed; aborted")
    src = new_src

    new_src, n_g = GEM_ANCHOR.subn(GEM_INJECT, src, count=1)
    if n_g != 1:
        fail("GEM anchor not found — file structure changed; aborted")
    src = new_src

    TARGET.write_text(src)

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

    print("✅ signal logging wired")
    print(f"   import added at top")
    print(f"   _check_ultra: 1 log_signal() inserted")
    print(f"   _check_gem:   1 log_signal() inserted")
    print(f"   syntax check: OK")
    print(f"   backup:       {BACKUP}")
    print()
    print("Next: restart the notifier")
    print("  sudo systemctl restart nexus-notifier")
    print("  tail -f /var/log/nexus-signals.jsonl   # signals will start appearing")


if __name__ == "__main__":
    main()
