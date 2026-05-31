/* S1/S5 — scalp ("fast") trade-plan contract (2026-05 scanner audit).

   loadTrading builds the scalp card's entry/target/stop inline, so the logic
   can't be imported directly. What CAN be pinned is the contract it now relies
   on: the scalp routes through atrZones(price, atr15m, 0, 0, SCALP_MULTS) so
   that target AND stop both scale with the 15m ATR (symmetric), and atrZones
   returns null when ATR is absent so the scalp is skipped rather than shown
   with a fabricated reward:risk.

   The legacy plan fixed the target at +1.5% while only the stop tracked ATR,
   which (a) made the target ~5×ATR on a quiet coin — unreachable in 10-30min,
   yet displayed a flattering rr≈3.0 — and (b) when atr15m was missing, let the
   stop fall back to a 0.5% floor so the rr<1.5 gate could never drop it. These
   tests lock the new symmetric, skip-on-no-ATR behaviour. */

const test = require('node:test');
const assert = require('node:assert/strict');

/* The scalp card calls atrZones from src/scanner-helpers.js — the 5-arg
   form atrZones(price, atr, support, resistance, mults) — NOT the separate
   Node module src/scanner-atr-zones.js, whose 5th arg is isTier1 rather than
   a mults object. We exercise the exact function the app uses. */
const { atrZones } = require('../src/scanner-helpers');

/* The exact multipliers the scalp branch passes to atrZones. Mirror of the
   literal in app.js loadTrading — kept here so a change to the scalp's
   reward:risk shape is a deliberate, reviewed edit. */
const SCALP_MULTS = { stop: 1.2, t1: 2.4, t2: 3.6 };

function scalpRR(z) {
  return +((z.target1 - z.entry) / (z.entry - z.stop)).toFixed(1);
}

test('scalp plan — reward:risk is a constant 2.0, independent of volatility (S1)', () => {
  /* The headline symmetry fix: a quiet coin and a volatile one get the SAME
     rr, because target and stop scale together — no more rr=3.0 on quiet
     coins / rr=1.2 (dropped) on volatile ones. */
  const quiet = atrZones(100, 0.3, 0, 0, SCALP_MULTS); /* 0.3% 15m ATR */
  const volatile = atrZones(100, 1.2, 0, 0, SCALP_MULTS); /* 1.2% 15m ATR */
  assert.equal(scalpRR(quiet), 2.0);
  assert.equal(scalpRR(volatile), 2.0);
});

test('scalp plan — target is 2.4×ATR from entry (reachable), not a fixed %', () => {
  const z = atrZones(100, 0.5, 0, 0, SCALP_MULTS);
  assert.equal(+((z.target1 - z.entry) / 0.5).toFixed(1), 2.4);
  assert.equal(+((z.entry - z.stop) / 0.5).toFixed(1), 1.2);
});

test('scalp plan — a quiet coin no longer gets an unreachable 5×ATR target', () => {
  /* Legacy: target=+1.5% on a 0.3% ATR coin = 5×ATR. New: 2.4×ATR. */
  const z = atrZones(100, 0.3, 0, 0, SCALP_MULTS);
  const legacyTargetAtrMult = (100 * 1.015 - 100) / 0.3; /* = 5.0 */
  const newTargetAtrMult = (z.target1 - 100) / 0.3;
  assert.ok(legacyTargetAtrMult > 4.9);
  assert.ok(newTargetAtrMult < legacyTargetAtrMult);
  assert.equal(+newTargetAtrMult.toFixed(1), 2.4);
});

test('scalp plan — no ATR → null, so the scalp is skipped not fabricated (S5)', () => {
  assert.equal(atrZones(100, 0, 0, 0, SCALP_MULTS), null); /* zero ATR */
  assert.equal(atrZones(100, undefined, 0, 0, SCALP_MULTS), null); /* missing */
  assert.equal(atrZones(100, -1, 0, 0, SCALP_MULTS), null); /* junk */
});

test('scalp plan — entry is the live price (market scalp)', () => {
  const z = atrZones(2.5, 0.02, 0, 0, SCALP_MULTS);
  assert.equal(z.entry, 2.5);
  assert.ok(z.stop < z.entry && z.entry < z.target1);
});
