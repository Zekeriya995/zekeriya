/* NEXUS PRO — server-side ULTRA push cooldown gate.

   Pure-function replacement for the inline cooldown that lived in
   server.js's ULTRA push loop. Exists so the gate logic — including
   the Phase 1.3 delta-bypass — is unit-testable without spinning up
   the proxy and a fake push subscription.

   The gate has two paths to allow a push for a symbol:

     1. Age path  — the previous push for this symbol is older than
                    COOLDOWN_MS. Same as the original behaviour.
     2. Delta path (Phase 1.3) — the new score exceeds the previously
                    pushed score by DELTA_THRESHOLD or more, even if
                    the cooldown has not elapsed. This catches the
                    "ULTRA reborn" case the audit flagged in §6 P1.3:
                    a symbol pushed at 102 that climbs to 135 inside
                    the 5-minute window deserves a second alert.

   The delta path is gated by the `deltaPushEnabled` option (which
   the caller wires to SCANNER_ULTRA_DELTA_PUSH at boot). When false,
   the gate behaves exactly as the pre-1.3 code.

   State shape: { [symbol]: { ts: number, score: number } }
   The caller owns the state object so the same map can carry per-
   symbol cooldown across many runScannerOnServer ticks. */

'use strict';

const COOLDOWN_MS = 5 * 60 * 1000;
const DELTA_THRESHOLD = 30;

/* shouldPushUltra(state, sym, now, score, opts) — pure decision.
   Returns true if a push should be sent right now for this symbol /
   score, false if it should be suppressed by the cooldown.

   opts: { deltaPushEnabled?: boolean = true } */
function shouldPushUltra(state, sym, now, score, opts) {
  if (!state || typeof sym !== 'string' || typeof now !== 'number') return false;
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  const last = state[sym];
  if (!last) return true; /* never pushed → always allow */
  const ageOk = now - last.ts >= COOLDOWN_MS;
  if (ageOk) return true;
  const deltaPushEnabled = !opts || opts.deltaPushEnabled !== false;
  if (!deltaPushEnabled) return false;
  return score - last.score >= DELTA_THRESHOLD;
}

/* recordUltraPush(state, sym, now, score) — pure mutation.
   Records that a push WAS sent (caller's responsibility to ensure
   `sent > 0` before calling). Returns the state object so calls
   can be chained. */
function recordUltraPush(state, sym, now, score) {
  if (!state || typeof sym !== 'string') return state;
  state[sym] = { ts: now, score };
  return state;
}

module.exports = {
  COOLDOWN_MS,
  DELTA_THRESHOLD,
  shouldPushUltra,
  recordUltraPush,
};
