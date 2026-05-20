/* Unit tests for src/scoring-rules.js — the unified scoring rules
   registry introduced in Phase 2.A.1 PR A. Locks the contract for
   the 5 migrated rules so any future change has to update this file
   in lock-step.

   These tests intentionally do NOT mock the registry; they import
   it directly and exercise its public API (RULES, THRESHOLDS,
   applyRules). That way the test suite IS the contract test the
   client-side migration (PR B) will hang off of. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RULES, THRESHOLDS, applyRules } = require('../src/scoring-rules');

/* ─── Shape & integrity ───────────────────────────────────────── */

test('RULES — is a frozen array', () => {
  assert.ok(Array.isArray(RULES));
  assert.ok(Object.isFrozen(RULES));
});

test('RULES — every rule has the required shape', () => {
  for (const rule of RULES) {
    assert.equal(typeof rule.id, 'string', `${rule.id}: id must be string`);
    assert.ok(rule.id.length > 0, `${rule.id}: id must be non-empty`);
    assert.equal(typeof rule.weight, 'number', `${rule.id}: weight must be number`);
    assert.ok(Number.isFinite(rule.weight), `${rule.id}: weight must be finite`);
    assert.equal(typeof rule.condition, 'function', `${rule.id}: condition must be function`);
    /* tag is allowed to be null (rule contributes score with no UI tag).
       When present, it's a non-empty string. */
    if (rule.tag !== null && rule.tag !== undefined) {
      assert.equal(typeof rule.tag, 'string', `${rule.id}: tag must be string when present`);
      assert.ok(rule.tag.length > 0, `${rule.id}: tag must be non-empty when present`);
    }
  }
});

test('RULES — every id is unique', () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(ids.length, new Set(ids).size, 'rule ids must be globally unique');
});

test('THRESHOLDS — frozen with the expected tier cutoffs', () => {
  assert.ok(Object.isFrozen(THRESHOLDS));
  assert.equal(THRESHOLDS.ULTRA, 100);
  assert.equal(THRESHOLDS.STRONG, 70);
  assert.equal(THRESHOLDS.MEDIUM, 50);
  assert.equal(THRESHOLDS.WEAK_MIN, 30);
});

/* ─── Individual rule behavior — pinned by the contract ──────── */

const TIER1_CTX = { isTier1: true, volume: 1e8, change: 1 };
const NEW_CTX = { isTier1: false, volume: 1e8, change: 1 };

function fire(id, ctx) {
  /* Run one rule by id, return true if it fired. Helper for the
     per-rule contract tests below. */
  const rule = RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`unknown rule id: ${id}`);
  return rule.condition(ctx);
}

test('TIER1_BONUS — fires when isTier1=true', () => {
  assert.equal(fire('TIER1_BONUS', TIER1_CTX), true);
  const r = RULES.find((r) => r.id === 'TIER1_BONUS');
  assert.equal(r.weight, 10);
  assert.equal(r.tag, '🏆TOP100');
});

test('TIER1_BONUS — does NOT fire when isTier1=false', () => {
  assert.equal(fire('TIER1_BONUS', NEW_CTX), false);
});

test('NEW_BONUS — fires when isTier1=false', () => {
  assert.equal(fire('NEW_BONUS', NEW_CTX), true);
  const r = RULES.find((r) => r.id === 'NEW_BONUS');
  assert.equal(r.weight, 2);
  assert.equal(r.tag, '🔍NEW');
});

test('NEW_BONUS — does NOT fire when isTier1=true', () => {
  assert.equal(fire('NEW_BONUS', TIER1_CTX), false);
});

test('TIER1_BONUS and NEW_BONUS — mutually exclusive', () => {
  /* The inline code in scanner-engine was `if (isTier1) {...} else
     {...}`. The registry models them as two independent rules with
     opposite conditions. The combined effect must still be that
     exactly one fires per ctx. */
  for (const ctx of [TIER1_CTX, NEW_CTX]) {
    const t1 = fire('TIER1_BONUS', ctx);
    const newB = fire('NEW_BONUS', ctx);
    assert.equal(t1 && newB, false, 'both must not fire for the same ctx');
    assert.equal(t1 || newB, true, 'exactly one must fire for any valid ctx');
  }
});

test('SILENT_ACCUMULATION — fires on high volume + small change', () => {
  assert.equal(fire('SILENT_ACCUMULATION', { isTier1: true, volume: 6e7, change: 1 }), true);
  /* Boundary: change of exactly 2 should NOT fire (strict <). */
  assert.equal(fire('SILENT_ACCUMULATION', { isTier1: true, volume: 6e7, change: 2 }), false);
  /* Negative change still fires if abs < 2. */
  assert.equal(fire('SILENT_ACCUMULATION', { isTier1: true, volume: 6e7, change: -1.5 }), true);
  /* Volume below 5e7 does not fire even with tiny change. */
  assert.equal(fire('SILENT_ACCUMULATION', { isTier1: true, volume: 4e7, change: 0.5 }), false);
});

test('EARLY_ENTRY — fires on mid volume + small positive change', () => {
  assert.equal(fire('EARLY_ENTRY', { isTier1: false, volume: 4e7, change: 1 }), true);
  /* Boundary: change of 0.3 fires (>=); 0.29 does not. */
  assert.equal(fire('EARLY_ENTRY', { isTier1: false, volume: 4e7, change: 0.3 }), true);
  assert.equal(fire('EARLY_ENTRY', { isTier1: false, volume: 4e7, change: 0.29 }), false);
  /* Boundary: change of 2 does NOT fire (strict <). */
  assert.equal(fire('EARLY_ENTRY', { isTier1: false, volume: 4e7, change: 2 }), false);
  /* Volume below 3e7 does not fire. */
  assert.equal(fire('EARLY_ENTRY', { isTier1: false, volume: 2e7, change: 1 }), false);
});

test('STEALTH — fires on big volume + early upward momentum', () => {
  assert.equal(fire('STEALTH', { isTier1: false, volume: 9e7, change: 1 }), true);
  /* Boundary: change exactly 3 does NOT fire (strict <). */
  assert.equal(fire('STEALTH', { isTier1: false, volume: 9e7, change: 3 }), false);
  /* Boundary: 0.5 fires (>=). */
  assert.equal(fire('STEALTH', { isTier1: false, volume: 9e7, change: 0.5 }), true);
  /* Volume below 8e7 does not fire even with valid change. */
  assert.equal(fire('STEALTH', { isTier1: false, volume: 7.9e7, change: 1 }), false);
});

/* ─── applyRules — aggregate behavior ─────────────────────────── */

test('applyRules — TIER1 coin with high vol + flat change fires multiple rules', () => {
  /* BTC-shaped: tier1, $80M volume, 0.5% change. Expected:
     TIER1_BONUS (+10), SILENT_ACC (+25), EARLY_ENTRY (+20),
     STEALTH (+15). NEW_BONUS does NOT fire (mutually exclusive
     with TIER1). Total = 70. */
  const out = applyRules({ isTier1: true, volume: 8e7, change: 0.5 });
  /* Volume 8e7 is NOT > 8e7 (strict >), so STEALTH does not fire.
     Recompute: TIER1 (10) + SILENT_ACC (25, since 8e7 > 5e7 and
     abs(0.5) < 2) + EARLY_ENTRY (20, since 8e7 > 3e7 and 0.5 in
     [0.3, 2)). NEW_BONUS doesn't fire. Total = 55. */
  assert.equal(out.scoreDelta, 55);
  assert.deepEqual(out.tagsDelta.sort(), ['🏆TOP100', '🐋ACC', '🔍EARLY'].sort());
});

test('applyRules — STEALTH fires at volume just above 8e7', () => {
  const out = applyRules({ isTier1: false, volume: 8.5e7, change: 1 });
  /* NEW_BONUS (2) + SILENT_ACC (25) + EARLY_ENTRY (20) + STEALTH (15)
     = 62. */
  assert.equal(out.scoreDelta, 62);
  assert.ok(out.tagsDelta.includes('🔍STEALTH'));
  assert.ok(out.tagsDelta.includes('🔍NEW'));
});

test('applyRules — no rules fire on a thin / quiet ticker', () => {
  /* Low volume, big move → none of these 5 rules apply. */
  const out = applyRules({ isTier1: false, volume: 1e6, change: 10 });
  /* NEW_BONUS still fires (it's a flat bonus on non-tier-1). */
  assert.equal(out.scoreDelta, 2);
  assert.deepEqual(out.tagsDelta, ['🔍NEW']);
});

test('applyRules — returns a fresh tagsDelta array each call', () => {
  /* Pure-function contract: caller mutating the returned array
     must not affect the next call. */
  const a = applyRules({ isTier1: true, volume: 6e7, change: 0.5 });
  a.tagsDelta.push('POLLUTE');
  const b = applyRules({ isTier1: true, volume: 6e7, change: 0.5 });
  assert.ok(!b.tagsDelta.includes('POLLUTE'));
});

test('applyRules — rejects nothing on an empty / malformed ctx', () => {
  /* Defensive: an empty ctx makes all isTier1-based conditions false
     and all volume/change conditions undefined → false. Should still
     return a well-formed result. */
  const out = applyRules({});
  assert.equal(typeof out.scoreDelta, 'number');
  assert.ok(Array.isArray(out.tagsDelta));
  /* NEW_BONUS fires because `ctx.isTier1 === false` is false for
     undefined, BUT condition is strictly `=== false`. So undefined
     isTier1 fires NEITHER. Locks the contract: an unset isTier1 is
     treated as ambiguous, not as "non-tier-1". */
  assert.equal(out.scoreDelta, 0);
  assert.deepEqual(out.tagsDelta, []);
});

/* ─── UMD-lite loader behavior ────────────────────────────────── */

test('UMD loader — exports are reachable from CommonJS require', () => {
  /* The test runner itself is CommonJS, so importing at the top of
     this file proves the server-side loader path works. This test
     is the explicit assertion. */
  assert.ok(RULES);
  assert.ok(THRESHOLDS);
  assert.equal(typeof applyRules, 'function');
});
