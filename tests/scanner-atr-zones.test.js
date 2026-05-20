/* Unit tests for src/scanner-atr-zones.js — exhaustive boundary
   coverage on the pure ATR-aware SL/TP bounds calculation. The
   detector is a pure function so all tests are deterministic and
   synchronous.

   Implements Phase 2.A.4 of SCANNER_AUDIT_2026_05_15.md §6. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_MULTS, atrZones } = require('../src/scanner-atr-zones');

/* ─── Defensive input handling ────────────────────────────────── */

test('atrZones — non-numeric / non-finite price returns null', () => {
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, '100', {}, []]) {
    assert.equal(atrZones(bad, 1), null);
  }
});

test('atrZones — non-positive price returns null', () => {
  assert.equal(atrZones(0, 1), null);
  assert.equal(atrZones(-1, 1), null);
});

test('atrZones — non-numeric / non-finite ATR returns null', () => {
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, '1', {}, []]) {
    assert.equal(atrZones(100, bad), null);
  }
});

test('atrZones — non-positive ATR returns null', () => {
  /* Real-world: indicator-engine returns null for too-few klines, but
     also worth locking that a literal 0 doesn't slip through. */
  assert.equal(atrZones(100, 0), null);
  assert.equal(atrZones(100, -1), null);
});

/* ─── Happy path — default multipliers ─────────────────────────── */

test('atrZones — default multipliers produce 2:1 R:R', () => {
  /* stop = price - 1.5 × atr;  tp1 = price + 3.0 × atr
     risk = 1.5 atr; reward = 3.0 atr; R:R = 2.0 */
  const out = atrZones(100, 1);
  assert.equal(out.stop, 98.5);
  assert.equal(out.tp1, 103);
  assert.equal(out.tp2, 105);
  assert.equal(out.rr, 2);
  assert.equal(out.atr, 1);
});

test('atrZones — BTC-shaped fixture (high price, low % volatility)', () => {
  /* BTC at 50,000 with ATR 750 (1.5% of price): tight SL relative to
     the legacy -3% (which would be -1500). Phase 2.A.4 motivation. */
  const out = atrZones(50000, 750);
  assert.equal(out.stop, 48875); /* 50000 - 1.5 * 750 */
  assert.equal(out.tp1, 52250); /* 50000 + 3 * 750 */
  assert.equal(out.tp2, 53750); /* 50000 + 5 * 750 */
});

test('atrZones — DOGE-shaped fixture (low price, high % volatility)', () => {
  /* DOGE at 0.10 with ATR 0.004 (4% of price): legacy -3% would stop
     at 0.097 — well inside one ATR of normal noise. New SL widens
     to 0.094 = -6%, reflecting actual market behavior. */
  const out = atrZones(0.1, 0.004);
  /* stop = 0.1 - 1.5 * 0.004 = 0.094 */
  assert.ok(Math.abs(out.stop - 0.094) < 1e-9);
  /* tp1 = 0.1 + 3 * 0.004 = 0.112 */
  assert.ok(Math.abs(out.tp1 - 0.112) < 1e-9);
  /* tp2 = 0.1 + 5 * 0.004 = 0.12 */
  assert.ok(Math.abs(out.tp2 - 0.12) < 1e-9);
});

/* ─── Multiplier overrides ─────────────────────────────────────── */

test('atrZones — override stop multiplier widens the stop', () => {
  const out = atrZones(100, 1, { stop: 2 });
  assert.equal(out.stop, 98); /* 100 - 2 * 1 */
  assert.equal(out.tp1, 103); /* unchanged */
});

test('atrZones — override tp1 multiplier tightens the target', () => {
  const out = atrZones(100, 1, { tp1: 2 });
  assert.equal(out.tp1, 102); /* 100 + 2 * 1 */
  assert.equal(out.rr, 1.33); /* (102-100) / (100-98.5) ≈ 1.33 */
});

test('atrZones — override tp2 multiplier moves the runner', () => {
  const out = atrZones(100, 1, { tp2: 10 });
  assert.equal(out.tp2, 110);
  assert.equal(out.tp1, 103); /* unchanged */
});

test('atrZones — non-positive override mults fall back to defaults', () => {
  /* A caller-supplied `{ stop: 0 }` or `{ stop: -1 }` would otherwise
     flip the stop above price or sit it AT price. Defensive fallback. */
  const zero = atrZones(100, 1, { stop: 0 });
  assert.equal(zero.stop, 98.5, 'zero override should not apply');
  const negative = atrZones(100, 1, { stop: -1 });
  assert.equal(negative.stop, 98.5, 'negative override should not apply');
});

test('atrZones — non-numeric override mults fall back to defaults', () => {
  const out = atrZones(100, 1, { stop: 'string', tp1: null, tp2: NaN });
  assert.equal(out.stop, 98.5);
  assert.equal(out.tp1, 103);
  assert.equal(out.tp2, 105);
});

/* ─── Degenerate-setup guard ───────────────────────────────────── */

test('atrZones — ATR large enough to drive stop ≤ 0 returns null', () => {
  /* price=10, atr=10, default stopMult=1.5 → stop = 10 - 15 = -5
     Reject. */
  assert.equal(atrZones(10, 10), null);
});

test('atrZones — ATR exactly equal to price/stopMult returns null', () => {
  /* stop = 100 - 1.5 * (100/1.5) = 100 - 100 = 0. !(0 > 0) → null. */
  assert.equal(atrZones(100, 100 / 1.5), null);
});

test('atrZones — degenerate override with stop mult ≥ price/atr returns null', () => {
  /* Caller-supplied override that produces stop ≤ 0. */
  const out = atrZones(100, 10, { stop: 100 });
  assert.equal(out, null);
});

/* ─── R:R math ─────────────────────────────────────────────────── */

test('atrZones — R:R is reward/risk rounded to 2 decimals', () => {
  /* default: reward = 3 atr, risk = 1.5 atr → 2.00 */
  assert.equal(atrZones(100, 1).rr, 2);
  /* tighter stop (stopMult=1, tp1Mult=3): reward = 3, risk = 1 → 3.00 */
  assert.equal(atrZones(100, 1, { stop: 1 }).rr, 3);
  /* wider stop (stopMult=2, tp1Mult=3): reward = 3, risk = 2 → 1.50 */
  assert.equal(atrZones(100, 1, { stop: 2 }).rr, 1.5);
});

test('atrZones — R:R correctness across volatility regimes', () => {
  /* R:R is scale-invariant: doubling ATR keeps the ratio constant. */
  const r1 = atrZones(100, 1).rr;
  const r2 = atrZones(100, 5).rr;
  const r3 = atrZones(100, 0.01).rr;
  assert.equal(r1, 2);
  assert.equal(r2, 2);
  assert.equal(r3, 2);
});

/* ─── Output shape ─────────────────────────────────────────────── */

test('atrZones — output rounds to 8 decimal places (token-precision)', () => {
  /* Crypto pairs go up to 8 decimals on the wire (Binance KAS/BONK).
     Locks the precision so a downstream Number stringification
     doesn't truncate or grow unexpectedly. */
  const out = atrZones(0.00012345, 0.0000001);
  assert.ok(typeof out.stop === 'number');
  /* stop = 0.00012345 - 1.5 * 1e-7 = 0.0001233 */
  assert.ok(Math.abs(out.stop - 0.0001233) < 1e-10);
});

test('atrZones — atr field on output echoes the input', () => {
  const out = atrZones(100, 2.5);
  assert.equal(out.atr, 2.5);
});

/* ─── Constants ────────────────────────────────────────────────── */

test('DEFAULT_MULTS — frozen so accidental mutation throws / no-ops', () => {
  assert.throws(() => {
    DEFAULT_MULTS.stop = 999;
  });
});

test('DEFAULT_MULTS — locked baseline values', () => {
  /* If these change, the audit's expected SL/TP behavior changes.
     Locks the contract — any future tuning has to update this test. */
  assert.equal(DEFAULT_MULTS.stop, 1.5);
  assert.equal(DEFAULT_MULTS.tp1, 3.0);
  assert.equal(DEFAULT_MULTS.tp2, 5.0);
});
