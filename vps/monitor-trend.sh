#!/usr/bin/env bash
#
# vps/monitor-trend.sh
#
# Periodic capture of the scanner report for the FORWARD trend-profile
# study. Cron appends a timestamped report to logs/scanner-report.log so
# the trend bucket's growth — and the legacy/v2/trend net comparison —
# becomes a time series, not a single point read. This is how we watch
# whether the live trend profile's edge holds as data accumulates.
#
# Install (capture every 6 hours):
#   ( crontab -l 2>/dev/null | grep -v monitor-trend.sh; \
#     echo "0 */6 * * * $(pwd)/vps/monitor-trend.sh" ) | crontab -
#
# Reads the local proxy on :3000 (same source as `npm run scanner-report`).
# Self-locating: resolves the repo root from its own path, so the cron
# entry works regardless of the clone directory.
set -euo pipefail

cd "$(dirname "$0")/.."
# cron runs with a minimal PATH — make sure the node binary is findable.
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

mkdir -p logs
{
  echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="
  node vps/scanner-report.js
  echo
} >> logs/scanner-report.log 2>&1
