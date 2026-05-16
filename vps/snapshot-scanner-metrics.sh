#!/usr/bin/env bash
#
# vps/snapshot-scanner-metrics.sh
#
# Captures a point-in-time snapshot of Scanner metrics for before/after
# comparison across remediation phases (see SCANNER_AUDIT_2026_05_15.md).
# Idempotent — safe to re-run any number of times.
#
# Usage:
#   ./vps/snapshot-scanner-metrics.sh                 # → data/scanner-baseline-YYYY-MM-DD.json
#   ./vps/snapshot-scanner-metrics.sh after-phase-1   # → data/scanner-baseline-after-phase-1.json
#
# Reads from:  http://localhost:3000/api/health  +  /api/metrics
# Requires:    curl (jq optional, used for pretty-print when present)
#
set -euo pipefail

LABEL="${1:-$(date +%Y-%m-%d)}"
OUTDIR="data"
OUTFILE="${OUTDIR}/scanner-baseline-${LABEL}.json"

mkdir -p "${OUTDIR}"

# Bound each call so a hung server can't stall the script.
METRICS=$(curl -s --max-time 10 http://localhost:3000/api/metrics 2>/dev/null || echo '{}')
HEALTH=$(curl -s --max-time 10 http://localhost:3000/api/health 2>/dev/null || echo '{}')

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if command -v jq >/dev/null 2>&1; then
  jq -n \
    --arg ts "${TS}" \
    --arg label "${LABEL}" \
    --argjson metrics "${METRICS}" \
    --argjson health "${HEALTH}" \
    '{snapshotAt: $ts, label: $label, metrics: $metrics, health: $health}' \
    > "${OUTFILE}"
else
  # No jq → emit a single-line JSON with raw bodies inlined. This works
  # because curl already returned valid JSON; we trust the proxy on this.
  printf '{"snapshotAt":"%s","label":"%s","metrics":%s,"health":%s}\n' \
    "${TS}" "${LABEL}" "${METRICS}" "${HEALTH}" > "${OUTFILE}"
fi

SIZE=$(wc -c < "${OUTFILE}")
echo "✓ Snapshot saved to ${OUTFILE} (${SIZE} bytes)"

# 200 bytes is the floor for a real response from both endpoints. Below
# that, the server is almost certainly down — bail loudly rather than
# committing an empty baseline.
if [ "${SIZE}" -lt 200 ]; then
  echo "WARNING: Snapshot is suspiciously small. Is the proxy running on :3000?"
  exit 1
fi
