/* Unit tests for src/scanner-atr-zones.js — exhaustive boundary
   coverage on the pure ATR-aware SL/TP bounds calculation. The
   detector is a pure function so all tests are deterministic and
   synchronous.

   Implements Phase 2.A.4 of SCANNER_AUDIT_2026_05_15.md §6. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_MULTS, TIER1_MULTS, atrZones } = require('../src/scanner-atr-zones');

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

test('atrZones — Infinity override mults fall back to defaults (correctness NIT A1)', () => {
  /* `+Infinity > 0` is true but Number.isFinite catches it. Without
     this guard the stop becomes -Infinity (rescued later by the
     degenerate guard) but the override gate would be inconsistent
     with how NaN / -Infinity are already filtered. */
  const out = atrZones(100, 1, { stop: Infinity, tp1: Infinity, tp2: Infinity });
  assert.equal(out.stop, 98.5);
  assert.equal(out.tp1, 103);
  assert.equal(out.tp2, 105);
});

test('atrZones — -Infinity override mults fall back to defaults', () => {
  const out = atrZones(100, 1, { stop: -Infinity });
  assert.equal(out.stop, 98.5);
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

/* ─── Phase 2.A.4.b — Tier-aware multipliers ───────────────────── */

test('TIER1_MULTS — frozen so accidental mutation throws / no-ops', () => {
  assert.throws(() => {
    TIER1_MULTS.stop = 999;
  });
});

test('TIER1_MULTS — locked baseline values (stop=1.2, tp1=1.8, tp2=3.0)', () => {
  /* These set the tier-1 contract. If they change, the BTC/ETH TP
     distance changes — any retune must update this test consciously. */
  assert.equal(TIER1_MULTS.stop, 1.2);
  assert.equal(TIER1_MULTS.tp1, 1.8);
  assert.equal(TIER1_MULTS.tp2, 3.0);
});

test('TIER1_MULTS — R:R is 1.5 (1.8 / 1.2)', () => {
  /* Document the tier-1 R:R baseline so any future tuning that
     drops below 1.3 (the audit's stated profitability floor) gets
     caught here. */
  assert.equal(Math.round((TIER1_MULTS.tp1 / TIER1_MULTS.stop) * 10) / 10, 1.5);
});

test('atrZones — isTier1=true uses TIER1_MULTS as baseline', () => {
  /* price=100, atr=1, tier-1: stop=1.2, tp1=1.8, tp2=3.0
     → stop=98.8, tp1=101.8, tp2=103.0, rr=1.5 */
  const out = atrZones(100, 1, { isTier1: true });
  assert.equal(out.stop, 98.8);
  assert.equal(out.tp1, 101.8);
  assert.equal(out.tp2, 103);
  assert.equal(out.rr, 1.5);
});

test('atrZones — isTier1=false uses DEFAULT_MULTS as baseline', () => {
  /* Explicit false should match the no-opts behaviour. */
  const out = atrZones(100, 1, { isTier1: false });
  assert.equal(out.stop, 98.5);
  assert.equal(out.tp1, 103);
  assert.equal(out.tp2, 105);
  assert.equal(out.rr, 2);
});

test('atrZones — non-boolean isTier1 falls through to DEFAULT_MULTS (strict ===)', () => {
  /* Anything other than literal `true` — undefined, 1, "true", null —
     must NOT activate tier-1 defaults. Conservative-by-design: if
     the caller forgets to wire isTier1, the wider non-tier-1 bounds
     apply (visibly the same as pre-Phase-2.A.4.b behaviour). */
  for (const notTrue of [undefined, null, 1, 'true', 'yes', {}, []]) {
    const out = atrZones(100, 1, { isTier1: notTrue });
    assert.equal(out.stop, 98.5, `isTier1=${String(notTrue)} should fall through`);
    assert.equal(out.tp1, 103);
    assert.equal(out.tp2, 105);
  }
});

test('atrZones — tier-1 vs non-tier-1 produces materially tighter bounds', () => {
  /* The whole point of the tier-aware split: same price/ATR, different
     tier → different TP. If this invariant ever breaks (e.g., someone
     tunes TIER1_MULTS to match DEFAULT_MULTS), the test catches it. */
  const t1 = atrZones(100, 1, { isTier1: true });
  const t0 = atrZones(100, 1, { isTier1: false });
  assert.ok(t1.tp1 < t0.tp1, 'tier-1 TP1 must be tighter than non-tier-1');
  assert.ok(t1.tp2 < t0.tp2, 'tier-1 TP2 must be tighter than non-tier-1');
  /* Stop is also tighter in absolute ATR terms (1.2 vs 1.5), so stop
     price is HIGHER (closer to entry) for tier-1. */
  assert.ok(t1.stop > t0.stop, 'tier-1 stop must be closer to entry');
});

test('atrZones — BTC-shaped tier-1 fixture (2026-05-20 user observation)', () => {
  /* The exact case Ziko flagged: BTC at $77,160 with ATR $1,680
     (typical 15m ATR(14) for BTC during this session).
     Non-tier-1 (legacy):
       stop = 77160 - 1.5 * 1680 = 74640   → -3.27%
       tp1  = 77160 + 3.0 * 1680 = 82200   → +6.53%   ← too far for 1-4h
       tp2  = 77160 + 5.0 * 1680 = 85560   → +10.88%
     Tier-1 (new):
       stop = 77160 - 1.2 * 1680 = 75144   → -2.61%
       tp1  = 77160 + 1.8 * 1680 = 80184   → +3.92%   ← reachable in 1-4h
       tp2  = 77160 + 3.0 * 1680 = 82200   → +6.53%
     Lock the numbers so a future refactor can't quietly drift them. */
  const out = atrZones(77160, 1680, { isTier1: true });
  assert.equal(out.stop, 75144);
  assert.equal(out.tp1, 80184);
  assert.equal(out.tp2, 82200);
  assert.equal(out.rr, 1.5);
});

test('atrZones — non-tier-1 DOGE-shaped fixture unchanged by tier-1 wiring', () => {
  /* Regression guard: small-caps must keep their pre-2.A.4.b bounds.
     If a future change accidentally promotes everything to tier-1
     multipliers, this test fails. */
  const out = atrZones(0.1, 0.004, { isTier1: false });
  assert.ok(Math.abs(out.stop - 0.094) < 1e-9);
  assert.ok(Math.abs(out.tp1 - 0.112) < 1e-9);
  assert.ok(Math.abs(out.tp2 - 0.12) < 1e-9);
});

test('atrZones — numeric overrides still win over tier-1 baseline', () => {
  /* The override cascade: opts.stop / opts.tp1 / opts.tp2 win even
     when isTier1=true. Lets a future caller force a specific bound
     on a tier-1 symbol (e.g., for paper-trading scenarios). */
  const out = atrZones(100, 1, { isTier1: true, stop: 2, tp1: 4 });
  assert.equal(out.stop, 98); /* override 2, not tier-1 1.2 */
  assert.equal(out.tp1, 104); /* override 4, not tier-1 1.8 */
  assert.equal(out.tp2, 103); /* tier-1 baseline (3.0) since no override */
});

test('atrZones — invalid overrides on tier-1 fall back to TIER1_MULTS not DEFAULT_MULTS', () => {
  /* Subtle: when an override fails the _isPos gate, the fallback
     must be the tier-resolved baseline (TIER1_MULTS), NOT
     DEFAULT_MULTS. A regression here would silently use wider
     non-tier-1 bounds for tier-1 symbols whenever a caller passed
     a bogus override. */
  const out = atrZones(100, 1, { isTier1: true, stop: 0, tp1: -1, tp2: NaN });
  assert.equal(out.stop, 98.8); /* TIER1_MULTS.stop = 1.2 */
  assert.equal(out.tp1, 101.8); /* TIER1_MULTS.tp1 = 1.8 */
  assert.equal(out.tp2, 103); /* TIER1_MULTS.tp2 = 3.0 */
});
