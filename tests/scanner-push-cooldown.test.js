/* Unit tests for src/scanner-push-cooldown.js — exercises the
   age-path and delta-path independently, the gate disable, and
   the defensive guards.

   Implements Phase 1.3 of SCANNER_AUDIT_2026_05_15.md. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COOLDOWN_MS,
  DELTA_THRESHOLD,
  shouldPushUltra,
  recordUltraPush,
} = require('../src/scanner-push-cooldown');

const NOW = 1_730_000_000_000;

/* ─── First-push behaviour ─────────────────────────────────────── */

test('shouldPushUltra — first push for a symbol is always allowed', () => {
  assert.equal(shouldPushUltra({}, 'BTC', NOW, 105), true);
});

test('shouldPushUltra — different symbols do not interfere', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  assert.equal(shouldPushUltra(state, 'ETH', NOW + 1000, 105), true);
});

/* ─── Age path ─────────────────────────────────────────────────── */

test('shouldPushUltra — within cooldown with low delta → BLOCKED', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  /* 1 minute later, score barely up — neither path qualifies. */
  assert.equal(shouldPushUltra(state, 'BTC', NOW + 60_000, 110), false);
});

test('shouldPushUltra — exactly at COOLDOWN_MS → ALLOWED via age path', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  /* >= cooldown is the boundary — no delta needed. */
  assert.equal(shouldPushUltra(state, 'BTC', NOW + COOLDOWN_MS, 106), true);
});

test('shouldPushUltra — past cooldown always allowed regardless of delta', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  assert.equal(shouldPushUltra(state, 'BTC', NOW + COOLDOWN_MS + 1, 105), true);
});

/* ─── Delta path (Phase 1.3) ───────────────────────────────────── */

test('shouldPushUltra — within cooldown but score jumps by DELTA_THRESHOLD → ALLOWED', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  /* delta = exactly threshold (30) at 1 minute in → bypass kicks in. */
  assert.equal(shouldPushUltra(state, 'BTC', NOW + 60_000, 105 + DELTA_THRESHOLD), true);
});

test('shouldPushUltra — within cooldown, delta just below threshold → BLOCKED', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  assert.equal(shouldPushUltra(state, 'BTC', NOW + 60_000, 105 + DELTA_THRESHOLD - 1), false);
});

test('shouldPushUltra — within cooldown, large delta → ALLOWED', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 102);
  /* The audit's "ULTRA reborn" example: 102 → 135 inside 5 minutes. */
  assert.equal(shouldPushUltra(state, 'BTC', NOW + 90_000, 135), true);
});

test('shouldPushUltra — score going DOWN never fires the delta bypass', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  /* A drop of 30 should NOT qualify — only positive deltas. */
  assert.equal(shouldPushUltra(state, 'BTC', NOW + 60_000, 75), false);
});

/* ─── Delta path disable ───────────────────────────────────────── */

test('shouldPushUltra — deltaPushEnabled:false reverts to old age-only behaviour', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  /* Same input that would normally bypass via delta path → blocked. */
  assert.equal(
    shouldPushUltra(state, 'BTC', NOW + 60_000, 200, { deltaPushEnabled: false }),
    false
  );
  /* Age path still works when disabled. */
  assert.equal(
    shouldPushUltra(state, 'BTC', NOW + COOLDOWN_MS, 105, { deltaPushEnabled: false }),
    true
  );
});

test('shouldPushUltra — opts omitted defaults deltaPushEnabled to true', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  /* No opts → delta bypass active. */
  assert.equal(shouldPushUltra(state, 'BTC', NOW + 60_000, 145), true);
});

/* ─── Defensive guards ─────────────────────────────────────────── */

test('shouldPushUltra — null state returns false (defensive)', () => {
  assert.equal(shouldPushUltra(null, 'BTC', NOW, 105), false);
});

test('shouldPushUltra — non-string symbol returns false', () => {
  assert.equal(shouldPushUltra({}, null, NOW, 105), false);
  assert.equal(shouldPushUltra({}, 42, NOW, 105), false);
});

test('shouldPushUltra — non-finite score returns false', () => {
  assert.equal(shouldPushUltra({}, 'BTC', NOW, NaN), false);
  assert.equal(shouldPushUltra({}, 'BTC', NOW, Infinity), false);
  assert.equal(shouldPushUltra({}, 'BTC', NOW, 'string'), false);
});

/* ─── recordUltraPush ──────────────────────────────────────────── */

test('recordUltraPush — stores ts and score', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  assert.deepEqual(state.BTC, { ts: NOW, score: 105 });
});

test('recordUltraPush — overwrites prior entry for the same symbol', () => {
  const state = {};
  recordUltraPush(state, 'BTC', NOW, 105);
  recordUltraPush(state, 'BTC', NOW + 1000, 130);
  assert.deepEqual(state.BTC, { ts: NOW + 1000, score: 130 });
});

test('recordUltraPush — null state is a no-op (returns it unchanged)', () => {
  /* Defensive: never crash on a missing state object. */
  assert.equal(recordUltraPush(null, 'BTC', NOW, 105), null);
});

/* ─── Constants exposed for the caller ─────────────────────────── */

test('COOLDOWN_MS matches the historical 5-minute window', () => {
  assert.equal(COOLDOWN_MS, 5 * 60 * 1000);
});

test('DELTA_THRESHOLD matches audit §6 P1.3 (30 points)', () => {
  assert.equal(DELTA_THRESHOLD, 30);
});
