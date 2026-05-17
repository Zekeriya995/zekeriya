/* Unit tests for src/scanner-pd-detector.js — exercise every flag
   condition (fires above / does not fire at-or-below threshold),
   the missing-data fallbacks, and the score-adjustment ladder.

   Implements Phase 1.1 of SCANNER_AUDIT_2026_05_15.md. The detector
   is a pure function so all tests are deterministic and synchronous. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FLAG_THRESHOLDS,
  SCORE,
  detectPumpAndDump,
  applyToScore,
} = require('../src/scanner-pd-detector');

/* ─── Defensive input handling ────────────────────────────────── */

test('detectPumpAndDump — null / undefined / non-object input returns empty detection', () => {
  for (const bad of [null, undefined, 0, '', 'string', 42, true]) {
    const out = detectPumpAndDump(bad);
    assert.deepEqual(out.flags, []);
    assert.equal(out.count, 0);
    assert.equal(out.scoreAdjustment, 0);
  }
});

test('detectPumpAndDump — empty object returns empty detection', () => {
  const out = detectPumpAndDump({});
  assert.deepEqual(out.flags, []);
  assert.equal(out.count, 0);
  assert.equal(out.scoreAdjustment, 0);
});

/* ─── VERTICAL flag ────────────────────────────────────────────── */

test('VERTICAL — fires when change >= 15', () => {
  const out = detectPumpAndDump({ change: 15 });
  assert.equal(out.flags[0], 'VERTICAL:+15%');
});

test('VERTICAL — fires at well above threshold (rounds in label)', () => {
  const out = detectPumpAndDump({ change: 23.7 });
  assert.equal(out.flags[0], 'VERTICAL:+24%');
});

test('VERTICAL — does NOT fire just below threshold', () => {
  const out = detectPumpAndDump({ change: 14.99 });
  assert.deepEqual(out.flags, []);
});

test('VERTICAL — does NOT fire when change is missing or NaN', () => {
  assert.deepEqual(detectPumpAndDump({ change: null }).flags, []);
  assert.deepEqual(detectPumpAndDump({ change: undefined }).flags, []);
  assert.deepEqual(detectPumpAndDump({ change: NaN }).flags, []);
});

/* ─── FR_EXTREME flag ──────────────────────────────────────────── */

test('FR_EXTREME — fires when fr.rate > 0.1', () => {
  const out = detectPumpAndDump({ fr: { rate: 0.15 } });
  assert.equal(out.flags[0], 'FR_EXTREME:0.150');
});

test('FR_EXTREME — does NOT fire at exactly 0.1 (strict >)', () => {
  /* The client uses strict > 0.1 — preserve that boundary. */
  const out = detectPumpAndDump({ fr: { rate: 0.1 } });
  assert.deepEqual(out.flags, []);
});

test('FR_EXTREME — unit assertion: 0.05 (% per 8h) does NOT fire', () => {
  /* Per docs/SCANNER_PD_THRESHOLDS.md §3.2 — unit fragility test.
     The intended unit is "percent per 8h", so 0.05 (= 0.05% per 8h)
     must remain below the 0.1 threshold and not fire. */
  const out = detectPumpAndDump({ fr: { rate: 0.05 } });
  assert.deepEqual(out.flags, []);
});

test('FR_EXTREME — does NOT fire when fr is null / wrong shape', () => {
  assert.deepEqual(detectPumpAndDump({ fr: null }).flags, []);
  assert.deepEqual(detectPumpAndDump({ fr: {} }).flags, []);
  assert.deepEqual(detectPumpAndDump({ fr: { rate: 'string' } }).flags, []);
});

/* ─── LS_RETAIL_LONG flag ──────────────────────────────────────── */

test('LS_RETAIL_LONG — fires when ratio > 3', () => {
  const out = detectPumpAndDump({ ls: { ratio: 3.5 } });
  assert.equal(out.flags[0], 'LS_RETAIL_LONG:3.5');
});

test('LS_RETAIL_LONG — does NOT fire at exactly 3 (strict >)', () => {
  const out = detectPumpAndDump({ ls: { ratio: 3 } });
  assert.deepEqual(out.flags, []);
});

test('LS_RETAIL_LONG — does NOT fire when ls is missing or malformed', () => {
  assert.deepEqual(detectPumpAndDump({ ls: null }).flags, []);
  assert.deepEqual(detectPumpAndDump({ ls: {} }).flags, []);
});

/* ─── SMART_VS_RETAIL flag ─────────────────────────────────────── */

test('SMART_VS_RETAIL — fires only when BOTH halves are true', () => {
  const out = detectPumpAndDump({
    ls: { ratio: 2.5 },
    topTraders: { positions: [{ long: 0.3 }] },
  });
  assert.ok(out.flags.includes('SMART_VS_RETAIL'));
});

test('SMART_VS_RETAIL — does NOT fire if smart traders are net long', () => {
  const out = detectPumpAndDump({
    ls: { ratio: 2.5 },
    topTraders: { positions: [{ long: 0.5 }] } /* >= 0.4 → skip */,
  });
  assert.ok(!out.flags.includes('SMART_VS_RETAIL'));
});

test('SMART_VS_RETAIL — does NOT fire if retail is not long enough', () => {
  const out = detectPumpAndDump({
    ls: { ratio: 1.9 } /* <= 2 → skip */,
    topTraders: { positions: [{ long: 0.3 }] },
  });
  assert.ok(!out.flags.includes('SMART_VS_RETAIL'));
});

test('SMART_VS_RETAIL — uses the LATEST position from the array', () => {
  const out = detectPumpAndDump({
    ls: { ratio: 2.5 },
    topTraders: { positions: [{ long: 0.5 }, { long: 0.3 }] } /* last is the active one */,
  });
  assert.ok(out.flags.includes('SMART_VS_RETAIL'));
});

test('SMART_VS_RETAIL — empty positions array does not fire', () => {
  const out = detectPumpAndDump({
    ls: { ratio: 2.5 },
    topTraders: { positions: [] },
  });
  assert.ok(!out.flags.includes('SMART_VS_RETAIL'));
});

test('SMART_VS_RETAIL — missing topTraders entirely does not fire', () => {
  const out = detectPumpAndDump({
    ls: { ratio: 2.5 },
    /* no topTraders */
  });
  assert.ok(!out.flags.includes('SMART_VS_RETAIL'));
});

/* ─── THIN_PUMP flag ───────────────────────────────────────────── */

test('THIN_PUMP — fires when change >= 8 AND volume < $30M', () => {
  const out = detectPumpAndDump({ change: 9, volume: 25_000_000 });
  assert.ok(out.flags.includes('THIN_PUMP'));
});

test('THIN_PUMP — does NOT fire when volume is at threshold ($30M, strict <)', () => {
  const out = detectPumpAndDump({ change: 9, volume: 30_000_000 });
  assert.ok(!out.flags.includes('THIN_PUMP'));
});

test('THIN_PUMP — does NOT fire when change < 8', () => {
  const out = detectPumpAndDump({ change: 7.99, volume: 1_000_000 });
  assert.ok(!out.flags.includes('THIN_PUMP'));
});

test('THIN_PUMP — does NOT fire when volume is missing', () => {
  const out = detectPumpAndDump({ change: 10 });
  assert.ok(!out.flags.includes('THIN_PUMP'));
});

/* ─── Score-adjustment ladder ──────────────────────────────────── */

test('scoreAdjustment — 0 flags = 0', () => {
  const out = detectPumpAndDump({ change: 1 });
  assert.equal(out.scoreAdjustment, 0);
});

test('scoreAdjustment — 1 flag = 0 (still no penalty)', () => {
  const out = detectPumpAndDump({ fr: { rate: 0.15 } });
  assert.equal(out.count, 1);
  assert.equal(out.scoreAdjustment, 0);
});

test('scoreAdjustment — exactly 2 flags = -25 soft penalty', () => {
  const out = detectPumpAndDump({
    fr: { rate: 0.15 },
    ls: { ratio: 3.5 },
  });
  assert.equal(out.count, 2);
  assert.equal(out.scoreAdjustment, -25);
});

test('scoreAdjustment — 3+ flags = KILL (string sentinel)', () => {
  const out = detectPumpAndDump({
    change: 20 /* VERTICAL */,
    fr: { rate: 0.15 } /* FR_EXTREME */,
    ls: { ratio: 3.5 } /* LS_RETAIL_LONG */,
  });
  assert.equal(out.count, 3);
  assert.equal(out.scoreAdjustment, 'KILL');
});

test('scoreAdjustment — 4 flags also KILL', () => {
  const out = detectPumpAndDump({
    change: 20 /* VERTICAL */,
    volume: 10_000_000 /* combined with change → THIN_PUMP */,
    fr: { rate: 0.15 } /* FR_EXTREME */,
    ls: { ratio: 3.5 } /* LS_RETAIL_LONG */,
  });
  assert.ok(out.count >= 3);
  assert.equal(out.scoreAdjustment, 'KILL');
});

/* ─── applyToScore ─────────────────────────────────────────────── */

test('applyToScore — KILL floors at SCORE.KILL_FLOOR (-100)', () => {
  assert.equal(applyToScore(50, { scoreAdjustment: 'KILL' }), SCORE.KILL_FLOOR);
});

test('applyToScore — KILL preserves an already-lower score (no raise)', () => {
  assert.equal(applyToScore(-150, { scoreAdjustment: 'KILL' }), -150);
});

test('applyToScore — numeric adjustment is added', () => {
  assert.equal(applyToScore(80, { scoreAdjustment: -25 }), 55);
});

test('applyToScore — null detection returns score unchanged', () => {
  assert.equal(applyToScore(80, null), 80);
});

test('applyToScore — 0 adjustment returns score unchanged', () => {
  assert.equal(applyToScore(80, { scoreAdjustment: 0 }), 80);
});

/* ─── FLAG_THRESHOLDS contract ─────────────────────────────────── */

test('FLAG_THRESHOLDS — frozen so accidental mutation throws / no-ops', () => {
  /* Object.freeze makes mutation a no-op in non-strict mode and
     throws in strict mode (this file is strict). */
  assert.throws(() => {
    FLAG_THRESHOLDS.VERTICAL_CHANGE_PCT = 999;
  });
});

test('FLAG_THRESHOLDS — values match the client-side detector at app.js:2466-2474', () => {
  /* Parity check — these constants must mirror the client values
     that decision A (Unify) commits us to. Bumping any of these
     without updating app.js will break the contract test in
     Phase 2.A.5. */
  assert.equal(FLAG_THRESHOLDS.VERTICAL_CHANGE_PCT, 15);
  assert.equal(FLAG_THRESHOLDS.FR_EXTREME_RATE, 0.1);
  assert.equal(FLAG_THRESHOLDS.LS_RETAIL_LONG_RATIO, 3);
  assert.equal(FLAG_THRESHOLDS.SMART_TRADER_LONG_BELOW, 0.4);
  assert.equal(FLAG_THRESHOLDS.SMART_LS_RATIO_ABOVE, 2);
  assert.equal(FLAG_THRESHOLDS.THIN_PUMP_CHANGE_PCT, 8);
  assert.equal(FLAG_THRESHOLDS.THIN_PUMP_VOLUME_BELOW, 30_000_000);
});
