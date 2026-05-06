#!/usr/bin/env bash
# verify_drift.sh — VPS deployment integrity checker
#
# Compares the running nexus_notifier.py + v2_patch.py against expected
# checksums recorded the last time wire_v2.py / wire_whale.py succeeded.
# Run BEFORE any wire_*.py to catch out-of-band edits, and AFTER deploys
# to confirm the wire produced the expected file shape.
#
# Usage:
#   bash /root/verify_drift.sh           # check
#   bash /root/verify_drift.sh --record  # snapshot current state
#   bash /root/verify_drift.sh --report  # human-readable summary
#
# Exit codes:
#   0  — checksums match expected (or --record/--report mode)
#   1  — drift detected, needs operator attention
#   2  — required file missing
#
# Files watched:
#   /root/nexus_notifier.py   (the daemon)
#   /root/v2_patch.py         (the quality gate)
#   /root/wire_v2.py          (the wiring tool)
#   /root/wire_whale.py       (the wiring tool)
#
# Manifest location:
#   /root/.nexus_drift_manifest.tsv  (tab-separated: path<TAB>sha256<TAB>recorded_at)
#
# The manifest is intentionally human-readable so an operator can diff
# it directly. It is NOT under git — each VPS has its own manifest
# matching that VPS's last-known-good state.

set -euo pipefail

MANIFEST="/root/.nexus_drift_manifest.tsv"
WATCHED_FILES=(
  "/root/nexus_notifier.py"
  "/root/v2_patch.py"
  "/root/wire_v2.py"
  "/root/wire_whale.py"
)

mode="check"
case "${1:-}" in
  --record) mode="record" ;;
  --report) mode="report" ;;
  --check|"") mode="check" ;;
  -h|--help)
    sed -n '1,30p' "$0"
    exit 0
    ;;
  *) echo "unknown flag: $1" >&2; exit 2 ;;
esac

sha_of() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo ""
    return
  fi
  sha256sum "$path" | awk '{print $1}'
}

case "$mode" in
  record)
    : > "$MANIFEST.tmp"
    for path in "${WATCHED_FILES[@]}"; do
      if [[ ! -f "$path" ]]; then
        echo "⚠️  skipping missing file: $path" >&2
        continue
      fi
      hash=$(sha_of "$path")
      printf '%s\t%s\t%s\n' "$path" "$hash" "$(date -u +%FT%TZ)" >> "$MANIFEST.tmp"
    done
    mv "$MANIFEST.tmp" "$MANIFEST"
    echo "✅ recorded $(wc -l <"$MANIFEST") file(s) → $MANIFEST"
    ;;

  report)
    if [[ ! -f "$MANIFEST" ]]; then
      echo "no manifest yet — run with --record first"
      exit 0
    fi
    echo "manifest: $MANIFEST"
    printf '%-40s %-16s %s\n' "PATH" "STATE" "EXPECTED-AT"
    while IFS=$'\t' read -r path expected ts; do
      [[ -z "$path" ]] && continue
      actual=$(sha_of "$path")
      if [[ -z "$actual" ]]; then
        state="MISSING"
      elif [[ "$actual" == "$expected" ]]; then
        state="ok"
      else
        state="DRIFT"
      fi
      printf '%-40s %-16s %s\n' "$path" "$state" "$ts"
    done < "$MANIFEST"
    ;;

  check)
    if [[ ! -f "$MANIFEST" ]]; then
      echo "❌ no manifest at $MANIFEST" >&2
      echo "   run: $0 --record   to snapshot the current state" >&2
      exit 2
    fi
    drift=0
    while IFS=$'\t' read -r path expected ts; do
      [[ -z "$path" ]] && continue
      if [[ ! -f "$path" ]]; then
        echo "❌ MISSING $path (expected ${expected:0:12}…  recorded $ts)" >&2
        drift=1
        continue
      fi
      actual=$(sha_of "$path")
      if [[ "$actual" != "$expected" ]]; then
        echo "❌ DRIFT $path" >&2
        echo "   expected ${expected:0:12}… (recorded $ts)" >&2
        echo "   actual   ${actual:0:12}…" >&2
        drift=1
      fi
    done < "$MANIFEST"
    if [[ "$drift" -eq 0 ]]; then
      echo "✅ all watched files match the recorded manifest"
    else
      echo "" >&2
      echo "Re-record after a deliberate change:" >&2
      echo "  $0 --record" >&2
      exit 1
    fi
    ;;
esac
