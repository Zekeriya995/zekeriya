#!/usr/bin/env bash
# NEXUS PRO — weekly L2 calibration report (read-only, SAFE).
#
# Runs the L2 calibrator (vps/calibrate-weights.js) for each live weight profile
# and appends a timestamped report to logs/calibrate-report.log for human
# review. It NEVER applies weights — it only PROPOSES a diff (per the L2 design
# in docs/SCANNER_SELF_CALIBRATION_DESIGN.md). A qualified candidate that beats
# the incumbent out-of-sample is shipped by a human via a normal PR. Auto-apply
# is L3 and is deliberately not wired here.
#
# Install the weekly cron (run ONCE on the VPS, as the app user 'nexus'):
#   sudo -u nexus bash -c '(crontab -l 2>/dev/null | grep -v calibrate-weekly; \
#     echo "0 3 * * 0 bash -lc /root/zekeriya/vps/calibrate-weekly.sh") | crontab -'
#
# Run once now (to verify) + review:
#   sudo -u nexus bash /root/zekeriya/vps/calibrate-weekly.sh
#   tail -n 80 /root/zekeriya/logs/calibrate-report.log
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO/logs"
LOG="$LOG_DIR/calibrate-report.log"
mkdir -p "$LOG_DIR"

# Locate node — cron runs with a minimal PATH, so fall back to common installs.
NODE_BIN=""
for c in "$(command -v node 2>/dev/null)" /usr/local/bin/node /usr/bin/node \
  "$HOME"/.nvm/versions/node/*/bin/node; do
  if [ -n "$c" ] && [ -x "$c" ]; then
    NODE_BIN="$c"
    break
  fi
done
if [ -z "$NODE_BIN" ]; then
  echo "[$(date -u '+%F %T UTC')] calibrate-weekly: node not found in PATH/common locations" >>"$LOG"
  exit 1
fi

{
  echo "════════════════════════════════════════════════════════════"
  echo "[$(date -u '+%F %T UTC')] L2 calibration report (read-only)"
  echo "════════════════════════════════════════════════════════════"
  for profile in v2 trend; do
    echo "─── profile: $profile ───"
    "$NODE_BIN" "$REPO/vps/calibrate-weights.js" --profile "$profile" 2>&1 ||
      echo "[calibrate] run failed for profile=$profile"
    echo ""
  done
} >>"$LOG" 2>&1

# Keep the log bounded — retain the last ~2000 lines (≈40 weekly reports).
if [ "$(wc -l <"$LOG" 2>/dev/null || echo 0)" -gt 2000 ]; then
  tail -n 2000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
