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

const {
  RULES,
  THRESHOLDS,
  applyRules,
  WEIGHTS_V2,
  WEIGHTS_TREND,
  effectiveWeight,
} = require('../src/scoring-rules');

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
  /* Wash-trade floors are part of THRESHOLDS so scanner-engine
     can import a single constants object. Locks the values that
     scoreSymbol's wash-reject reads via the registry (Phase 2.A.3). */
  assert.equal(THRESHOLDS.WASH_VOLUME_FLOOR, 500_000_000);
  assert.equal(THRESHOLDS.WASH_OI_FLOOR, 100_000);
});

/* ─── Individual rule behavior — pinned by the contract ──────── */

const TIER1_CTX = { isTier1: true, volume: 1e8, change: 1 };
const NEW_CTX = { isTier1: false, volume: 1e8, change: 1 };
/* Phase 2.A.1 PR C — tier-2 ctx is client-only territory. The
   server passes no `isTier2` field so its ctx looks like NEW_CTX
   (the historical shape, validated by SERVER_CTX_PRE_PRC below). */
const TIER2_CTX = { isTier1: false, isTier2: true, volume: 1e8, change: 1 };
const SERVER_CTX_PRE_PRC = { isTier1: false, volume: 1e8, change: 1 };

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

/* ─── Phase 2.A.1 PR C — TIER2_BONUS + 3-way mutual exclusion ── */

test('TIER2_BONUS — fires when isTier2=true', () => {
  assert.equal(fire('TIER2_BONUS', TIER2_CTX), true);
  const r = RULES.find((r) => r.id === 'TIER2_BONUS');
  assert.equal(r.weight, 5);
  assert.equal(r.tag, '🥈T2');
});

test('TIER2_BONUS — does NOT fire when isTier2 is absent (server ctx)', () => {
  /* The server's applyRules ctx omits isTier2 entirely. Strict
     `=== true` cleanly rejects undefined. This is the safety
     property that lets the server keep its pre-PR-C behaviour. */
  assert.equal(fire('TIER2_BONUS', SERVER_CTX_PRE_PRC), false);
  assert.equal(fire('TIER2_BONUS', TIER1_CTX), false);
  assert.equal(fire('TIER2_BONUS', NEW_CTX), false);
});

test('TIER2_BONUS — does NOT fire when isTier2=false (client tier-1 or new coin)', () => {
  assert.equal(fire('TIER2_BONUS', { ...TIER1_CTX, isTier2: false }), false);
  assert.equal(fire('TIER2_BONUS', { ...NEW_CTX, isTier2: false }), false);
});

test('NEW_BONUS — does NOT fire when isTier2=true (excludes tier-2 from NEW)', () => {
  /* PR C: the tier-2 gate on NEW_BONUS prevents both TIER2_BONUS
     and NEW_BONUS firing for a tier-2 coin. Without this, a
     tier-2 client signal would get +2 + +5 = +7 instead of +5,
     diverging from the inline if/else if/else the client used to
     run. */
  assert.equal(fire('NEW_BONUS', TIER2_CTX), false);
});

test('TIER2_BONUS — does NOT fire when isTier1=true even if isTier2=true (TIER1>TIER2 precedence)', () => {
  /* PR C regression guard: the client's `tier2Coins` list (a
     ranked-by-volume slice at app.js:79-81) is NOT enforced
     disjoint from the hardcoded TIER1 set. A hot major (BTC,
     ETH, SOL …) can land in BOTH. The inline if/else if was
     mutually exclusive by syntax — only the first branch fired,
     so BTC scored +10 (TIER1) not +15 (TIER1+TIER2). The
     `isTier1 !== true` gate on TIER2_BONUS preserves this
     precedence under the registry's independent-rules model.
     This test pins the regression — flipping the gate off
     would surface as BTC suddenly scoring +5 higher. */
  const overlapCtx = { isTier1: true, isTier2: true, volume: 1e8, change: 1 };
  assert.equal(fire('TIER1_BONUS', overlapCtx), true, 'TIER1 still fires');
  assert.equal(fire('TIER2_BONUS', overlapCtx), false, 'TIER2 must NOT fire when TIER1 wins');
  assert.equal(fire('NEW_BONUS', overlapCtx), false, 'NEW does not fire either');
});

test('applyRules — TIER1∩TIER2 overlap coin scores +10 (TIER1 only), NOT +15', () => {
  /* End-to-end regression: a BTC-shaped ctx that's both tier-1
     AND in the client's tier-2 list should produce the same
     TIER bonus as before PR C (+10 from TIER1_BONUS only — NOT
     +15 with TIER2 stacked). If a future refactor inadvertently
     removes the precedence gate on TIER2_BONUS, this test catches
     it. (Total score also includes VOL_NORMAL +10 after PR F.) */
  const out = applyRules({ isTier1: true, isTier2: true, volume: 6e7, change: 1.5 });
  /* Score: TIER1 (+10) + SILENT_ACC (+25, since 6e7>5e7 and
     abs(1.5)<2) + EARLY_ENTRY (+20, since 6e7>3e7 and 1.5 in
     [0.3, 2)) + VOL_NORMAL (+10, since 6e7>3e7 and <=1e8 — PR F).
     NO TIER2, NO NEW, NO CHANGE_* (change=1.5 < 3). Total = 65. */
  assert.equal(out.scoreDelta, 65);
  assert.ok(out.tagsDelta.includes('🏆TOP100'), 'must carry TIER1 tag');
  assert.ok(!out.tagsDelta.includes('🥈T2'), 'must NOT carry TIER2 tag on overlap');
  assert.ok(!out.tagsDelta.includes('🔍NEW'), 'must NOT carry NEW tag');
});

test('NEW_BONUS — fires for server-side ctx that omits isTier2 (preserves pre-PR-C server behaviour)', () => {
  /* `isTier2 !== true` is intentional (not `=== false`) so that an
     undefined isTier2 still passes the gate. This is exactly the
     pre-PR-C contract — server code passes no isTier2 and expects
     NEW_BONUS to fire for any non-tier-1 coin. */
  assert.equal(fire('NEW_BONUS', SERVER_CTX_PRE_PRC), true);
});

test('TIER1 / TIER2 / NEW — three-way mutual exclusion (client ctx)', () => {
  /* With both isTier1 and isTier2 supplied (client-shaped ctx),
     exactly ONE of the three tier-bonus rules must fire. This is
     the invariant the inline if/else if/else expressed; the
     registry now expresses it via three independent conditions
     plus the !== true gate on NEW_BONUS. */
  const ctxs = [
    { isTier1: true, isTier2: false, volume: 1e8, change: 1 } /* tier-1 */,
    { isTier1: false, isTier2: true, volume: 1e8, change: 1 } /* tier-2 */,
    { isTier1: false, isTier2: false, volume: 1e8, change: 1 } /* new */,
  ];
  for (const ctx of ctxs) {
    const fired = ['TIER1_BONUS', 'TIER2_BONUS', 'NEW_BONUS'].filter((id) => fire(id, ctx));
    assert.equal(
      fired.length,
      1,
      `exactly one tier rule must fire for ctx ${JSON.stringify(ctx)}; fired: ${fired.join(',')}`
    );
  }
});

test('applyRules — tier-2 client coin scores TIER2 only (NOT TIER2+NEW)', () => {
  /* End-to-end check via applyRules: a tier-2 coin at $80M and
     +0.5% should fire TIER2_BONUS (+5, NOT +5+2 — the !== true
     gate on NEW_BONUS prevents that), SILENT_ACC (+25),
     EARLY_ENTRY (+20), VOL_NORMAL (+10, PR F). Total = 60. */
  const out = applyRules({ isTier1: false, isTier2: true, volume: 8e7, change: 0.5 });
  assert.equal(out.scoreDelta, 60);
  assert.deepEqual(out.tagsDelta.sort(), ['🥈T2', '🐋ACC', '🔍EARLY', '📊VOL'].sort());
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

/* ─── Phase 2.A.1 PR D — FR / LS / coinalyzeFR rules ──────────── */

test('FR_VERY_NEG — fires on funding < -0.01', () => {
  assert.equal(fire('FR_VERY_NEG', { frRate: -0.02 }), true);
  assert.equal(fire('FR_VERY_NEG', { frRate: -0.011 }), true);
  /* Boundary: exactly -0.01 does NOT fire (strict <). */
  assert.equal(fire('FR_VERY_NEG', { frRate: -0.01 }), false);
  /* Positive rate does not fire. */
  assert.equal(fire('FR_VERY_NEG', { frRate: 0.005 }), false);
  const r = RULES.find((r) => r.id === 'FR_VERY_NEG');
  assert.equal(r.weight, 12);
  assert.equal(r.tag, 'FR⬇️');
});

test('FR_MILDLY_NEG — fires on -0.01 <= funding < 0', () => {
  assert.equal(fire('FR_MILDLY_NEG', { frRate: -0.005 }), true);
  assert.equal(fire('FR_MILDLY_NEG', { frRate: -0.01 }), true);
  /* Boundary: exactly 0 does NOT fire (strict <). */
  assert.equal(fire('FR_MILDLY_NEG', { frRate: 0 }), false);
  /* Below -0.01 falls into FR_VERY_NEG's range — must NOT also fire here. */
  assert.equal(fire('FR_MILDLY_NEG', { frRate: -0.015 }), false);
  const r = RULES.find((r) => r.id === 'FR_MILDLY_NEG');
  assert.equal(r.weight, 5);
  assert.equal(r.tag, 'FR-');
});

test('FR_OVEREXTENDED — fires on funding > 0.08', () => {
  assert.equal(fire('FR_OVEREXTENDED', { frRate: 0.1 }), true);
  /* Boundary: exactly 0.08 does NOT fire (strict >). */
  assert.equal(fire('FR_OVEREXTENDED', { frRate: 0.08 }), false);
  /* Below 0.08 does not fire even though it's still positive. */
  assert.equal(fire('FR_OVEREXTENDED', { frRate: 0.05 }), false);
  /* Negative rate doesn't fire. */
  assert.equal(fire('FR_OVEREXTENDED', { frRate: -0.5 }), false);
  const r = RULES.find((r) => r.id === 'FR_OVEREXTENDED');
  assert.equal(r.weight, -8);
  assert.equal(r.tag, 'FR⚠️');
});

test('FR chain — mutually exclusive across the rate spectrum', () => {
  /* PR D: the three FR_* rules must be mutually exclusive — exactly
     one (or none, in the [0, 0.08] neutral range) fires per ctx.
     This invariant is critical because the inline pre-PR-D code used
     if/else if/else, fire-at-most-once by syntax. */
  const samples = [
    { frRate: -0.5, expected: ['FR_VERY_NEG'] },
    { frRate: -0.011, expected: ['FR_VERY_NEG'] },
    { frRate: -0.01, expected: ['FR_MILDLY_NEG'] },
    { frRate: -0.005, expected: ['FR_MILDLY_NEG'] },
    { frRate: 0, expected: [] } /* neutral range start */,
    { frRate: 0.05, expected: [] } /* neutral range */,
    { frRate: 0.08, expected: [] } /* neutral range end */,
    { frRate: 0.1, expected: ['FR_OVEREXTENDED'] },
  ];
  for (const { frRate, expected } of samples) {
    const fired = ['FR_VERY_NEG', 'FR_MILDLY_NEG', 'FR_OVEREXTENDED'].filter((id) =>
      fire(id, { frRate })
    );
    assert.deepEqual(
      fired,
      expected,
      `frRate=${frRate}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(fired)}`
    );
  }
});

test('FR rules — missing frRate (typeof !== number) does NOT fire any', () => {
  /* Same Option-C pattern as TIER2_BONUS: strict typeof check so
     missing data cleanly no-ops. Important when either side passes
     no FR data (server: ctx.fr === null; client: FR[s] === undefined). */
  for (const bad of [undefined, null, NaN, '0.05', {}, [], true]) {
    /* NaN is typeof 'number' but isNaN — but our rules don't guard NaN.
       However, NaN comparisons (< / >=) always return false, so NO
       FR rule fires for NaN. Verify. */
    const fired = ['FR_VERY_NEG', 'FR_MILDLY_NEG', 'FR_OVEREXTENDED'].filter((id) =>
      fire(id, { frRate: bad })
    );
    assert.deepEqual(fired, [], `frRate=${String(bad)} should fire no rule`);
  }
});

test('LS_SHORTS — fires on long/short ratio < 0.8', () => {
  assert.equal(fire('LS_SHORTS', { lsRatio: 0.5 }), true);
  /* Boundary: exactly 0.8 does NOT fire (strict <). */
  assert.equal(fire('LS_SHORTS', { lsRatio: 0.8 }), false);
  assert.equal(fire('LS_SHORTS', { lsRatio: 1.2 }), false);
  const r = RULES.find((r) => r.id === 'LS_SHORTS');
  assert.equal(r.weight, 10);
  assert.equal(r.tag, '🩳SHORTS');
});

test('LS_SHORTS — missing lsRatio does NOT fire', () => {
  for (const bad of [undefined, null, NaN, '0.5', {}, []]) {
    assert.equal(fire('LS_SHORTS', { lsRatio: bad }), false);
  }
});

test('COINALYZE_FR_NEG — fires on multi-exchange FR < -0.01 (server-only)', () => {
  assert.equal(fire('COINALYZE_FR_NEG', { coinalyzeFRRate: -0.02 }), true);
  /* Boundary: exactly -0.01 does NOT fire (strict <). */
  assert.equal(fire('COINALYZE_FR_NEG', { coinalyzeFRRate: -0.01 }), false);
  assert.equal(fire('COINALYZE_FR_NEG', { coinalyzeFRRate: 0 }), false);
  const r = RULES.find((r) => r.id === 'COINALYZE_FR_NEG');
  assert.equal(r.weight, 8);
  assert.equal(r.tag, '🌐FR_NEG');
});

test('COINALYZE_FR_NEG — does NOT fire when coinalyzeFRRate is absent (client ctx)', () => {
  /* The client has no coinalyzeFR data source. Strict typeof-number
     check ensures the rule no-ops on the client cleanly — same
     Option-C pattern as TIER2_BONUS. Critical: this is what makes
     PR D bit-for-bit safe on the client (the client never had a
     '🌐FR_NEG' inline rule, so this rule firing on the client
     would be a regression). */
  const clientCtx = { isTier1: false, volume: 1e8, change: 1, frRate: -0.05, lsRatio: 0.5 };
  /* clientCtx has no coinalyzeFRRate at all. */
  assert.equal(fire('COINALYZE_FR_NEG', clientCtx), false);
});

test('applyRules — server full FR/LS coin sums all 4 FR/LS rules', () => {
  /* Server-style ctx with FR very-negative + low LS + coinalyze negative:
     FR_VERY_NEG (+12) + LS_SHORTS (+10) + COINALYZE_FR_NEG (+8) = +30 */
  const out = applyRules({
    isTier1: true,
    volume: 8e7,
    change: 1,
    frRate: -0.05,
    lsRatio: 0.5,
    coinalyzeFRRate: -0.03,
  });
  /* TIER1 (10) + SILENT_ACC (25, 8e7>5e7, abs(1)<2) + EARLY_ENTRY (20,
     8e7>3e7, 1 in [0.3,2)) + FR_VERY_NEG (12) + LS_SHORTS (10) +
     COINALYZE_FR_NEG (8) + VOL_NORMAL (10, PR F) = 95.
     STEALTH does NOT fire (8e7 not > 8e7).
     CHANGE_* does NOT fire (change=1 < 3). */
  assert.equal(out.scoreDelta, 95);
  assert.ok(out.tagsDelta.includes('FR⬇️'));
  assert.ok(out.tagsDelta.includes('🩳SHORTS'));
  assert.ok(out.tagsDelta.includes('🌐FR_NEG'));
  assert.ok(out.tagsDelta.includes('📊VOL'));
});

test('applyRules — client ctx (no coinalyzeFR) skips COINALYZE_FR_NEG cleanly', () => {
  /* Client-shaped ctx (no coinalyzeFRRate). FR_VERY_NEG + LS_SHORTS fire
     but COINALYZE_FR_NEG does not. Proves the Option-C strict-check
     keeps server-only data from polluting client scoring. */
  const out = applyRules({
    isTier1: false,
    isTier2: false,
    volume: 8e7,
    change: 1,
    frRate: -0.05,
    lsRatio: 0.5,
    /* no coinalyzeFRRate */
  });
  /* NEW (2) + SILENT_ACC (25) + EARLY (20) + FR_VERY_NEG (12) +
     LS_SHORTS (10) + VOL_NORMAL (10, PR F) = 79. */
  assert.equal(out.scoreDelta, 79);
  assert.ok(!out.tagsDelta.includes('🌐FR_NEG'), 'client must NOT see server-only tag');
});

/* ─── Phase 2.A.1 PR E — MTF / RSI / MACD rules (server-only data) */

test('MTF_BULL_FULL — fires only on strength=full AND bias=bullish', () => {
  assert.equal(fire('MTF_BULL_FULL', { mtfStrength: 'full', mtfBias: 'bullish' }), true);
  assert.equal(fire('MTF_BULL_FULL', { mtfStrength: 'full', mtfBias: 'bearish' }), false);
  assert.equal(fire('MTF_BULL_FULL', { mtfStrength: 'partial', mtfBias: 'bullish' }), false);
  const r = RULES.find((r) => r.id === 'MTF_BULL_FULL');
  assert.equal(r.weight, 15);
  assert.equal(r.tag, '🎯MTF_BULL');
});

test('MTF_BULL_PARTIAL — fires only on strength=partial AND bias=bullish', () => {
  assert.equal(fire('MTF_BULL_PARTIAL', { mtfStrength: 'partial', mtfBias: 'bullish' }), true);
  assert.equal(fire('MTF_BULL_PARTIAL', { mtfStrength: 'full', mtfBias: 'bullish' }), false);
  const r = RULES.find((r) => r.id === 'MTF_BULL_PARTIAL');
  assert.equal(r.weight, 8);
  assert.equal(r.tag, '🎯MTF_BULL_2');
});

test('MTF_BEAR_FULL — fires only on strength=full AND bias=bearish', () => {
  assert.equal(fire('MTF_BEAR_FULL', { mtfStrength: 'full', mtfBias: 'bearish' }), true);
  assert.equal(fire('MTF_BEAR_FULL', { mtfStrength: 'partial', mtfBias: 'bearish' }), false);
  const r = RULES.find((r) => r.id === 'MTF_BEAR_FULL');
  assert.equal(r.weight, -10);
  assert.equal(r.tag, '🎯MTF_BEAR');
});

test('MTF_BEAR_PARTIAL — fires only on strength=partial AND bias=bearish', () => {
  assert.equal(fire('MTF_BEAR_PARTIAL', { mtfStrength: 'partial', mtfBias: 'bearish' }), true);
  assert.equal(fire('MTF_BEAR_PARTIAL', { mtfStrength: 'full', mtfBias: 'bearish' }), false);
  const r = RULES.find((r) => r.id === 'MTF_BEAR_PARTIAL');
  assert.equal(r.weight, -5);
  assert.equal(r.tag, '🎯MTF_BEAR_2');
});

test('MTF — at most ONE of the 4 rules fires per ctx', () => {
  /* The inline pre-PR-E was an if/else if/else if/else if chain.
     The 4 registry rules cover the 4 unique (strength, bias)
     combos, so at most one matches. Verify exhaustively. */
  const inputs = [
    { mtfStrength: 'full', mtfBias: 'bullish', expected: 'MTF_BULL_FULL' },
    { mtfStrength: 'partial', mtfBias: 'bullish', expected: 'MTF_BULL_PARTIAL' },
    { mtfStrength: 'full', mtfBias: 'bearish', expected: 'MTF_BEAR_FULL' },
    { mtfStrength: 'partial', mtfBias: 'bearish', expected: 'MTF_BEAR_PARTIAL' },
    { mtfStrength: undefined, mtfBias: undefined, expected: null },
    { mtfStrength: 'partial', mtfBias: 'neutral', expected: null } /* unknown bias */,
    { mtfStrength: 'unknown', mtfBias: 'bullish', expected: null } /* unknown strength */,
  ];
  for (const { mtfStrength, mtfBias, expected } of inputs) {
    const fired = ['MTF_BULL_FULL', 'MTF_BULL_PARTIAL', 'MTF_BEAR_FULL', 'MTF_BEAR_PARTIAL'].filter(
      (id) => fire(id, { mtfStrength, mtfBias })
    );
    if (expected) {
      assert.deepEqual(fired, [expected], `strength=${mtfStrength} bias=${mtfBias}`);
    } else {
      assert.deepEqual(fired, [], `strength=${mtfStrength} bias=${mtfBias}`);
    }
  }
});

test('MTF rules — missing ctx fields (client) fire nothing', () => {
  /* The client doesn't compute MTF in quickScan — it passes no
     mtfStrength/mtfBias. Strict equality checks (=== 'full',
     === 'partial' etc.) cleanly reject undefined. */
  const clientCtx = { isTier1: false, isTier2: false, volume: 1e8, change: 1 };
  const fired = ['MTF_BULL_FULL', 'MTF_BULL_PARTIAL', 'MTF_BEAR_FULL', 'MTF_BEAR_PARTIAL'].filter(
    (id) => fire(id, clientCtx)
  );
  assert.deepEqual(fired, [], 'client ctx must fire no MTF rule');
});

test('RSI_OS — fires on rsi < 30', () => {
  assert.equal(fire('RSI_OS', { rsi: 25 }), true);
  assert.equal(fire('RSI_OS', { rsi: 29.9 }), true);
  /* Boundary: exactly 30 does NOT fire (strict <). */
  assert.equal(fire('RSI_OS', { rsi: 30 }), false);
  assert.equal(fire('RSI_OS', { rsi: 50 }), false);
  const r = RULES.find((r) => r.id === 'RSI_OS');
  assert.equal(r.weight, 10);
  assert.equal(r.tag, '📉RSI_OS');
});

test('RSI_OB — fires on rsi > 70', () => {
  assert.equal(fire('RSI_OB', { rsi: 75 }), true);
  /* Boundary: exactly 70 does NOT fire (strict >). */
  assert.equal(fire('RSI_OB', { rsi: 70 }), false);
  assert.equal(fire('RSI_OB', { rsi: 50 }), false);
  const r = RULES.find((r) => r.id === 'RSI_OB');
  assert.equal(r.weight, -8);
  assert.equal(r.tag, '📈RSI_OB');
});

test('RSI rules — missing rsi (typeof !== number) fires nothing', () => {
  for (const bad of [undefined, null, NaN, '50', {}, [], true]) {
    assert.equal(fire('RSI_OS', { rsi: bad }), false, `RSI_OS rsi=${String(bad)}`);
    assert.equal(fire('RSI_OB', { rsi: bad }), false, `RSI_OB rsi=${String(bad)}`);
  }
});

test('MACD_BULL_CROSS — fires only on macdCross === "bull"', () => {
  assert.equal(fire('MACD_BULL_CROSS', { macdCross: 'bull' }), true);
  assert.equal(fire('MACD_BULL_CROSS', { macdCross: 'bear' }), false);
  assert.equal(fire('MACD_BULL_CROSS', { macdCross: undefined }), false);
  const r = RULES.find((r) => r.id === 'MACD_BULL_CROSS');
  assert.equal(r.weight, 12);
  assert.equal(r.tag, '📊MACD_BULL');
});

test('MACD_BEAR_CROSS — fires only on macdCross === "bear"', () => {
  assert.equal(fire('MACD_BEAR_CROSS', { macdCross: 'bear' }), true);
  assert.equal(fire('MACD_BEAR_CROSS', { macdCross: 'bull' }), false);
  const r = RULES.find((r) => r.id === 'MACD_BEAR_CROSS');
  assert.equal(r.weight, -8);
  assert.equal(r.tag, '📊MACD_BEAR');
});

test('applyRules — full MTF bullish + RSI oversold + MACD bull cross sums correctly', () => {
  /* Tier-1 BTC-shaped ctx with all three momentum confirmations:
     TIER1 (+10) + SILENT_ACC (+25) + EARLY (+20) + MTF_BULL_FULL (+15)
     + RSI_OS (+10) + MACD_BULL_CROSS (+12) + VOL_NORMAL (+10, PR F)
     = +102.
     STEALTH does NOT fire (8e7 not > 8e7, strict).
     CHANGE_* does NOT fire (change=0.5 < 3). */
  const out = applyRules({
    isTier1: true,
    volume: 8e7,
    change: 0.5,
    mtfStrength: 'full',
    mtfBias: 'bullish',
    rsi: 25,
    macdCross: 'bull',
  });
  assert.equal(out.scoreDelta, 102);
  assert.ok(out.tagsDelta.includes('🎯MTF_BULL'));
  assert.ok(out.tagsDelta.includes('📉RSI_OS'));
  assert.ok(out.tagsDelta.includes('📊MACD_BULL'));
});

test('applyRules — client ctx (no MTF/RSI/MACD fields) skips all 8 rules', () => {
  /* Regression guard: passing a client-shaped ctx with no MTF / rsi
     / macdCross fields produces the same score as if those rules
     didn't exist. Important because the client doesn't compute
     these values in quickScan, so PR E must NOT change client
     scoring. */
  const out = applyRules({ isTier1: false, isTier2: false, volume: 8e7, change: 1 });
  /* NEW (2) + SILENT_ACC (25, 8e7>5e7 && abs(1)<2) + EARLY (20) +
     VOL_NORMAL (10, PR F). Total = 57. */
  assert.equal(out.scoreDelta, 57);
  for (const t of [
    '🎯MTF_BULL',
    '🎯MTF_BULL_2',
    '🎯MTF_BEAR',
    '🎯MTF_BEAR_2',
    '📉RSI_OS',
    '📈RSI_OB',
    '📊MACD_BULL',
    '📊MACD_BEAR',
  ]) {
    assert.ok(!out.tagsDelta.includes(t), `client must NOT see ${t}`);
  }
});

/* ─── Phase 2.A.1 PR F — VOL chain + change-band rules ───────── */

test('VOL_MEGA — fires on volume > 1e9', () => {
  assert.equal(fire('VOL_MEGA', { volume: 2e9 }), true);
  /* Boundary: exactly 1e9 does NOT fire (strict >). */
  assert.equal(fire('VOL_MEGA', { volume: 1e9 }), false);
  const r = RULES.find((r) => r.id === 'VOL_MEGA');
  assert.equal(r.weight, 25);
  assert.equal(r.tag, '🔥MEGA_VOL');
});

test('VOL_HIGH — fires on volume in (1e8, 1e9]', () => {
  assert.equal(fire('VOL_HIGH', { volume: 5e8 }), true);
  assert.equal(fire('VOL_HIGH', { volume: 1e9 }), true); /* upper inclusive */
  /* Boundary: exactly 1e8 does NOT fire (strict >). */
  assert.equal(fire('VOL_HIGH', { volume: 1e8 }), false);
  assert.equal(fire('VOL_HIGH', { volume: 2e9 }), false); /* above range */
  const r = RULES.find((r) => r.id === 'VOL_HIGH');
  assert.equal(r.weight, 18);
  assert.equal(r.tag, '📊HIGH_VOL');
});

test('VOL_NORMAL — fires on volume in (3e7, 1e8]', () => {
  assert.equal(fire('VOL_NORMAL', { volume: 5e7 }), true);
  assert.equal(fire('VOL_NORMAL', { volume: 1e8 }), true); /* upper inclusive */
  /* Boundary: exactly 3e7 does NOT fire (strict >). */
  assert.equal(fire('VOL_NORMAL', { volume: 3e7 }), false);
  assert.equal(fire('VOL_NORMAL', { volume: 5e8 }), false); /* above range */
  const r = RULES.find((r) => r.id === 'VOL_NORMAL');
  assert.equal(r.weight, 10);
  assert.equal(r.tag, '📊VOL');
});

test('VOL chain — exactly one rule fires across the volume spectrum', () => {
  /* The 3 server VOL tiers form a mutually-exclusive precedence
     chain by their disjoint ranges (the client's lowercase
     '📊vol' tier in (1e7, 3e7] stays inline). Verify exhaustively. */
  const samples = [
    { volume: 5e9, expected: 'VOL_MEGA' },
    { volume: 2e9, expected: 'VOL_MEGA' },
    { volume: 1.1e9, expected: 'VOL_MEGA' },
    { volume: 1e9, expected: 'VOL_HIGH' } /* upper boundary */,
    { volume: 5e8, expected: 'VOL_HIGH' },
    { volume: 1.1e8, expected: 'VOL_HIGH' },
    { volume: 1e8, expected: 'VOL_NORMAL' } /* upper boundary */,
    { volume: 5e7, expected: 'VOL_NORMAL' },
    { volume: 3.1e7, expected: 'VOL_NORMAL' },
    { volume: 3e7, expected: null } /* server has no 4th tier */,
    { volume: 2e7, expected: null } /* client emits '📊vol' inline; registry does not */,
    { volume: 5e6, expected: null },
  ];
  for (const { volume, expected } of samples) {
    const fired = ['VOL_MEGA', 'VOL_HIGH', 'VOL_NORMAL'].filter((id) => fire(id, { volume }));
    if (expected) {
      assert.deepEqual(fired, [expected], `volume=${volume}`);
    } else {
      assert.deepEqual(fired, [], `volume=${volume} should fire nothing`);
    }
  }
});

test('CHANGE_RISING — fires on change in [3, 5)', () => {
  assert.equal(fire('CHANGE_RISING', { change: 3 }), true);
  assert.equal(fire('CHANGE_RISING', { change: 4 }), true);
  /* Boundary: exactly 5 does NOT fire (strict <). */
  assert.equal(fire('CHANGE_RISING', { change: 5 }), false);
  /* Below 3 does not fire. */
  assert.equal(fire('CHANGE_RISING', { change: 2.9 }), false);
  const r = RULES.find((r) => r.id === 'CHANGE_RISING');
  assert.equal(r.weight, 8);
  assert.equal(r.tag, '📈RISING');
});

test('CHANGE_LATE — fires on change in [5, 8)', () => {
  assert.equal(fire('CHANGE_LATE', { change: 5 }), true);
  assert.equal(fire('CHANGE_LATE', { change: 7.9 }), true);
  /* Boundary: exactly 8 does NOT fire (strict <). */
  assert.equal(fire('CHANGE_LATE', { change: 8 }), false);
  /* Below 5 does not fire. */
  assert.equal(fire('CHANGE_LATE', { change: 4.9 }), false);
  const r = RULES.find((r) => r.id === 'CHANGE_LATE');
  assert.equal(r.weight, -5);
  assert.equal(r.tag, '⚠️LATE');
});

test('CHANGE_PENALTY_GT3 — fires on change > 3 (independent overlap with RISING/LATE)', () => {
  assert.equal(fire('CHANGE_PENALTY_GT3', { change: 3.1 }), true);
  assert.equal(fire('CHANGE_PENALTY_GT3', { change: 100 }), true);
  /* Boundary: exactly 3 does NOT fire (strict >). */
  assert.equal(fire('CHANGE_PENALTY_GT3', { change: 3 }), false);
  const r = RULES.find((r) => r.id === 'CHANGE_PENALTY_GT3');
  assert.equal(r.weight, -15);
  assert.equal(r.tag, null); /* tagless score-only adjustment */
});

test('CHANGE_PENALTY_GT5 — fires on change > 5 (independent overlap with LATE)', () => {
  assert.equal(fire('CHANGE_PENALTY_GT5', { change: 5.1 }), true);
  /* Boundary: exactly 5 does NOT fire (strict >). */
  assert.equal(fire('CHANGE_PENALTY_GT5', { change: 5 }), false);
  const r = RULES.find((r) => r.id === 'CHANGE_PENALTY_GT5');
  assert.equal(r.weight, -30);
  assert.equal(r.tag, null);
});

test('CHANGE rules — overlapping combinations match the pre-PR-F inline behaviour', () => {
  /* Verify the additive-overlap behaviour the inline if-chain had:
       change=4   : RISING (+8) + PENALTY_GT3 (-15)               = -7
       change=6   : LATE (-5)  + PENALTY_GT3 (-15) + PENALTY_GT5  = -50
       change=10  : just PENALTY_GT3 + PENALTY_GT5 (RISING/LATE  = -45
                    don't fire above 8)
       change=3   : RISING only (penalty needs > 3)                = +8
       change=5   : LATE only (penalty needs > 5; penalty_gt3      = -5+(-15) = -20
                    catches it because 5 > 3, but penalty_gt5
                    needs > 5 strictly)
     Just exercise applyRules for these edge cases. Bound contracts
     pinned individually above; this is the overlap matrix. */
  /* change=4 */
  let out = applyRules({ isTier1: false, isTier2: false, volume: 1e6, change: 4 });
  /* NEW (2) + RISING (8) + PENALTY_GT3 (-15) = -5 */
  assert.equal(out.scoreDelta, -5);
  /* change=6 */
  out = applyRules({ isTier1: false, isTier2: false, volume: 1e6, change: 6 });
  /* NEW (2) + LATE (-5) + PENALTY_GT3 (-15) + PENALTY_GT5 (-30) = -48 */
  assert.equal(out.scoreDelta, -48);
});

/* ─── Phase 2.A.1 PR G — AT_HIGH / BOTTOM / TAKER / COINALYZE_OI */

test('AT_HIGH — fires near daily high with small positive change', () => {
  /* price 99.5, high 100 → (100-99.5)/99.5 ≈ 0.5% < 1.5% ✓
     change 1 ∈ (0, 3) ✓ → fires */
  assert.equal(fire('AT_HIGH', { high: 100, low: 95, price: 99.5, change: 1, volume: 1e7 }), true);
  /* Boundary: change=0 does NOT fire (strict >). */
  assert.equal(fire('AT_HIGH', { high: 100, low: 95, price: 99.5, change: 0, volume: 1e7 }), false);
  /* Boundary: change=3 does NOT fire (strict <). */
  assert.equal(fire('AT_HIGH', { high: 100, low: 95, price: 99.5, change: 3, volume: 1e7 }), false);
  /* Too far from high (5% away) — does NOT fire. */
  assert.equal(fire('AT_HIGH', { high: 100, low: 95, price: 95, change: 1, volume: 1e7 }), false);
  const r = RULES.find((r) => r.id === 'AT_HIGH');
  assert.equal(r.weight, 12);
  assert.equal(r.tag, '🎯AT_HIGH');
});

test('AT_HIGH — missing or non-numeric high/price does NOT fire', () => {
  for (const bad of [undefined, null, NaN, '100', {}]) {
    assert.equal(fire('AT_HIGH', { high: bad, price: 99, change: 1 }), false);
    assert.equal(fire('AT_HIGH', { high: 100, price: bad, change: 1 }), false);
  }
});

test('BOTTOM — fires in lower 25% of daily range with volume > 5e6', () => {
  /* range 95-100, price=96 → (96-95)/(100-95) = 20% < 25% ✓
     volume 1e7 > 5e6 ✓ → fires */
  assert.equal(fire('BOTTOM', { high: 100, low: 95, price: 96, volume: 1e7 }), true);
  /* Price at top of range (price=99) → 80% > 25% → does NOT fire. */
  assert.equal(fire('BOTTOM', { high: 100, low: 95, price: 99, volume: 1e7 }), false);
  /* high===low (sideways) → guarded, does NOT fire. */
  assert.equal(fire('BOTTOM', { high: 100, low: 100, price: 100, volume: 1e7 }), false);
  /* Volume below 5e6 → does NOT fire. */
  assert.equal(fire('BOTTOM', { high: 100, low: 95, price: 96, volume: 1e6 }), false);
  const r = RULES.find((r) => r.id === 'BOTTOM');
  assert.equal(r.weight, 10);
  assert.equal(r.tag, '📉BOTTOM');
});

test('BOTTOM — missing high/low/price does NOT fire (typeof gates)', () => {
  for (const bad of [undefined, null, NaN, '99']) {
    assert.equal(fire('BOTTOM', { high: bad, low: 95, price: 96, volume: 1e7 }), false);
    assert.equal(fire('BOTTOM', { high: 100, low: bad, price: 96, volume: 1e7 }), false);
    assert.equal(fire('BOTTOM', { high: 100, low: 95, price: bad, volume: 1e7 }), false);
  }
});

test('TAKER_SKEW — fires when ratio > avg * 1.3', () => {
  assert.equal(fire('TAKER_SKEW', { takerAvg: 1, takerRatio: 1.5 }), true);
  /* Boundary: ratio exactly avg*1.3 does NOT fire (strict >). */
  assert.equal(fire('TAKER_SKEW', { takerAvg: 1, takerRatio: 1.3 }), false);
  /* Avg <= 0 does NOT fire (div-by-zero guard). */
  assert.equal(fire('TAKER_SKEW', { takerAvg: 0, takerRatio: 1.5 }), false);
  const r = RULES.find((r) => r.id === 'TAKER_SKEW');
  assert.equal(r.weight, 15);
  assert.equal(r.tag, '💹TAKER');
});

test('TAKER_SKEW — missing data does NOT fire', () => {
  for (const bad of [undefined, null, NaN, '1.5', {}]) {
    assert.equal(fire('TAKER_SKEW', { takerAvg: bad, takerRatio: 1.5 }), false);
    assert.equal(fire('TAKER_SKEW', { takerAvg: 1, takerRatio: bad }), false);
  }
});

test('COINALYZE_OI — fires on positive aggregated OI with flat change', () => {
  assert.equal(fire('COINALYZE_OI', { coinalyzeOIValue: 5e6, change: 1 }), true);
  assert.equal(fire('COINALYZE_OI', { coinalyzeOIValue: 5e6, change: -2 }), true);
  /* Boundary: |change|=3 does NOT fire (strict <). */
  assert.equal(fire('COINALYZE_OI', { coinalyzeOIValue: 5e6, change: 3 }), false);
  assert.equal(fire('COINALYZE_OI', { coinalyzeOIValue: 5e6, change: -3 }), false);
  /* Zero/negative OI value does NOT fire. */
  assert.equal(fire('COINALYZE_OI', { coinalyzeOIValue: 0, change: 1 }), false);
  const r = RULES.find((r) => r.id === 'COINALYZE_OI');
  assert.equal(r.weight, 6);
  assert.equal(r.tag, '🌐OI');
});

test('COINALYZE_OI — does NOT fire on client ctx (no coinalyzeOIValue field)', () => {
  /* Option-C pattern: client has no aggregated multi-exchange OI
     feed. The strict typeof gate makes the rule cleanly no-op
     when coinalyzeOIValue is absent — same as COINALYZE_FR_NEG
     in PR D and the MTF rules in PR E. */
  const clientCtx = { isTier1: false, isTier2: false, volume: 1e8, change: 1 };
  assert.equal(fire('COINALYZE_OI', clientCtx), false);
});

/* ─── Phase 2.A.1 PR H — REVERSAL / BTC_OK_* / CVD_BUY ────────── */

test('REVERSAL — fires on change in [-10, -3] with volume > 5e7', () => {
  assert.equal(fire('REVERSAL', { change: -5, volume: 1e8 }), true);
  assert.equal(fire('REVERSAL', { change: -3, volume: 1e8 }), true); /* upper boundary */
  assert.equal(fire('REVERSAL', { change: -10, volume: 1e8 }), true); /* lower boundary */
  /* Outside the [-10, -3] range — does NOT fire. */
  assert.equal(fire('REVERSAL', { change: -2, volume: 1e8 }), false);
  assert.equal(fire('REVERSAL', { change: -11, volume: 1e8 }), false);
  /* Volume below 5e7 — does NOT fire. */
  assert.equal(fire('REVERSAL', { change: -5, volume: 4e7 }), false);
  const r = RULES.find((r) => r.id === 'REVERSAL');
  assert.equal(r.weight, 12);
  assert.equal(r.tag, '🔄REVERSAL');
});

test('BTC_OK_BONUS / BTC_NOT_OK_PENALTY — mutually exclusive based on btcMarketOk', () => {
  assert.equal(fire('BTC_OK_BONUS', { btcMarketOk: true }), true);
  assert.equal(fire('BTC_OK_BONUS', { btcMarketOk: false }), false);
  assert.equal(fire('BTC_NOT_OK_PENALTY', { btcMarketOk: false }), true);
  assert.equal(fire('BTC_NOT_OK_PENALTY', { btcMarketOk: true }), false);
  /* Neither fires when btcMarketOk is undefined (server-side ctx
     before PR H wires it). Critical: this is the bit-for-bit
     server-preservation property. */
  assert.equal(fire('BTC_OK_BONUS', {}), false);
  assert.equal(fire('BTC_NOT_OK_PENALTY', {}), false);
  /* BTC_NOT_OK_PENALTY is tagless (the inline pre-PR-H also
     emitted no tag for the penalty branch). */
  const r = RULES.find((r) => r.id === 'BTC_NOT_OK_PENALTY');
  assert.equal(r.tag, null);
});

test('CVD_BUY — fires only on trend === "BUYING" with positive delta + change < 3', () => {
  assert.equal(fire('CVD_BUY', { cvdTrend: 'BUYING', cvdDelta: 1000, change: 1 }), true);
  /* Boundary: change=3 does NOT fire (strict <). */
  assert.equal(fire('CVD_BUY', { cvdTrend: 'BUYING', cvdDelta: 1000, change: 3 }), false);
  /* Other trends do NOT fire. */
  assert.equal(fire('CVD_BUY', { cvdTrend: 'SELLING', cvdDelta: 1000, change: 1 }), false);
  assert.equal(fire('CVD_BUY', { cvdTrend: 'NEUTRAL', cvdDelta: 1000, change: 1 }), false);
  /* Negative delta does NOT fire. */
  assert.equal(fire('CVD_BUY', { cvdTrend: 'BUYING', cvdDelta: -100, change: 1 }), false);
  const r = RULES.find((r) => r.id === 'CVD_BUY');
  assert.equal(r.weight, 20);
  assert.equal(r.tag, '📊CVD_BUY');
});

test('CVD_BUY — server ctx (no cvdTrend/cvdDelta) cleanly no-ops', () => {
  /* Server has no aggCVD feed. Verify the rule does not fire
     for a server-shaped ctx. */
  const serverCtx = { isTier1: true, volume: 1e8, change: 1 };
  assert.equal(fire('CVD_BUY', serverCtx), false);
});

/* ─── applyRules — aggregate behavior ─────────────────────────── */

test('applyRules — TIER1 coin with high vol + flat change fires multiple rules', () => {
  /* BTC-shaped: tier1, $80M volume, 0.5% change. */
  const out = applyRules({ isTier1: true, volume: 8e7, change: 0.5 });
  /* Volume 8e7 is NOT > 8e7 (strict >), so STEALTH does not fire.
     Recompute: TIER1 (10) + SILENT_ACC (25, since 8e7 > 5e7 and
     abs(0.5) < 2) + EARLY_ENTRY (20, since 8e7 > 3e7 and 0.5 in
     [0.3, 2)) + VOL_NORMAL (10, since 8e7 > 3e7 && <=1e8 — PR F).
     NEW_BONUS doesn't fire. CHANGE_* doesn't fire (change=0.5 < 3).
     Total = 65. */
  assert.equal(out.scoreDelta, 65);
  assert.deepEqual(out.tagsDelta.sort(), ['🏆TOP100', '🐋ACC', '🔍EARLY', '📊VOL'].sort());
});

test('applyRules — STEALTH fires at volume just above 8e7', () => {
  const out = applyRules({ isTier1: false, volume: 8.5e7, change: 1 });
  /* NEW (2) + SILENT_ACC (25) + EARLY (20) + STEALTH (15) +
     VOL_NORMAL (10, 8.5e7 in (3e7, 1e8] — PR F) = 72. */
  assert.equal(out.scoreDelta, 72);
  assert.ok(out.tagsDelta.includes('🔍STEALTH'));
  assert.ok(out.tagsDelta.includes('🔍NEW'));
  assert.ok(out.tagsDelta.includes('📊VOL'));
});

test('applyRules — thin / quiet ticker fires only the tier bonus + late penalties', () => {
  /* Low volume (1e6 < 3e7, no VOL rule fires), big move (change=10
     > 5 → CHANGE_PENALTY_GT3 -15 AND CHANGE_PENALTY_GT5 -30; but
     change >= 8 so RISING/LATE do NOT fire). */
  const out = applyRules({ isTier1: false, volume: 1e6, change: 10 });
  /* NEW (2) + CHANGE_PENALTY_GT3 (-15, tagless) +
     CHANGE_PENALTY_GT5 (-30, tagless) = -43. No VOL_*
     (1e6 < 3e7), no RISING/LATE (change >= 8). */
  assert.equal(out.scoreDelta, -43);
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

test('UMD loader — browser branch attaches to window.SCORING_RULES (NIT fix)', () => {
  /* Pre-merge SRE review flagged that only the CommonJS branch of
     the UMD-lite loader had test coverage. Run the same file in a
     vm context with `window` defined and `module` undefined to
     exercise the browser branch. Catches a regression where the
     browser global path silently breaks (e.g., a future ES-module
     migration that drops the window assignment). */
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'scoring-rules.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.ok(sandbox.window.SCORING_RULES, 'window.SCORING_RULES must be defined');
  assert.ok(Array.isArray(sandbox.window.SCORING_RULES.RULES));
  assert.equal(typeof sandbox.window.SCORING_RULES.applyRules, 'function');
  assert.equal(sandbox.window.SCORING_RULES.THRESHOLDS.ULTRA, 100);
});

/* ─── Deep-freeze contract (NIT fix from correctness review) ──── */

test('RULES — each rule object is individually frozen', () => {
  /* The outer Object.freeze(RULES) prevents push/pop but not
     RULES[0].weight = 999. The PR-A polish wraps each rule in its
     own Object.freeze so the registry is genuinely tamper-proof. */
  for (const rule of RULES) {
    assert.ok(Object.isFrozen(rule), `${rule.id}: rule object must be frozen`);
  }
});

test('RULES — mutating a rule throws (strict mode)', () => {
  /* This file is strict mode; in non-strict mode the assignment
     would silently fail. Either way, the value never changes. */
  assert.throws(() => {
    RULES[0].weight = 999;
  });
  /* And verify the value did not change. */
  assert.equal(RULES[0].weight, 10);
});

/* ─── FALLING_KNIFE rule (defensive suppression) ──────────────── */

test('FALLING_KNIFE — fires when change < -10', () => {
  const fam = RULES.find((r) => r.id === 'FALLING_KNIFE');
  assert.ok(fam, 'FALLING_KNIFE rule must exist in registry');
  assert.equal(fam.weight, -50);
  assert.equal(fam.tag, '🔪FALLING');
  /* Boundary: exactly -10 does NOT fire (strict <). */
  assert.equal(fam.condition({ change: -10 }), false);
  /* Anything below -10 fires. */
  assert.equal(fam.condition({ change: -10.01 }), true);
  assert.equal(fam.condition({ change: -16.31 }), true); /* SAGA case */
});

test('FALLING_KNIFE — does NOT fire on neutral / positive change', () => {
  const fam = RULES.find((r) => r.id === 'FALLING_KNIFE');
  assert.equal(fam.condition({ change: 0 }), false);
  assert.equal(fam.condition({ change: 5 }), false);
  assert.equal(fam.condition({ change: -5 }), false);
  assert.equal(fam.condition({ change: -9.99 }), false);
});

test('FALLING_KNIFE — does NOT fire when change is missing or non-numeric', () => {
  const fam = RULES.find((r) => r.id === 'FALLING_KNIFE');
  assert.equal(fam.condition({}), false);
  assert.equal(fam.condition({ change: undefined }), false);
  assert.equal(fam.condition({ change: null }), false);
  assert.equal(fam.condition({ change: 'string' }), false);
  assert.equal(fam.condition({ change: NaN }), false);
});

test('FALLING_KNIFE — penalty drops a STRONG-scoring coin below the gate', () => {
  /* SAGA-shaped: tier-1ish high volume, change = -15. */
  const ctx = { isTier1: true, volume: 1e8, change: -15 };
  const out = applyRules(ctx);
  /* TIER1_BONUS (+10) + FALLING_KNIFE (-50) + VOL_NORMAL (+10,
     1e8 in (3e7, 1e8] strict-inclusive upper — PR F) = -30.
     SILENT_ACC needs |change|<2 → does NOT fire on -15.
     EARLY_ENTRY needs change in [0.3, 2) → does NOT fire on -15.
     STEALTH needs change in [0.5, 3) → does NOT fire on -15.
     CHANGE_* needs change > 3 → does NOT fire on -15. */
  assert.equal(out.scoreDelta, -30);
  assert.ok(out.tagsDelta.includes('🏆TOP100'));
  assert.ok(out.tagsDelta.includes('🔪FALLING'));
});

test('FALLING_KNIFE — does not interfere with a recovering coin at -8%', () => {
  /* A coin down 8% should NOT trigger the rule. Tests the explicit
     boundary the audit calls out (false negatives preferred over
     false positives — but only for actual crashes). */
  const ctx = { isTier1: false, volume: 1e8, change: -8 };
  const out = applyRules(ctx);
  assert.ok(!out.tagsDelta.includes('🔪FALLING'));
});

/* ─── WEIGHTS_V2 — evidence-based weight profile (P0) ──────────────── */

test('WEIGHTS_V2 — is frozen and every key maps to a real rule id', () => {
  assert.ok(Object.isFrozen(WEIGHTS_V2));
  const ids = new Set(RULES.map((r) => r.id));
  for (const key of Object.keys(WEIGHTS_V2)) {
    assert.ok(ids.has(key), `${key} must be a real rule id (typo guard)`);
    assert.equal(typeof WEIGHTS_V2[key], 'number', `${key} weight must be numeric`);
  }
});

test('WEIGHTS_V2 — neutralises the measured structural losers to 0', () => {
  for (const id of [
    'TIER1_BONUS',
    'SILENT_ACCUMULATION',
    'COINALYZE_OI',
    'AT_HIGH',
    'VOL_NORMAL',
  ]) {
    assert.equal(WEIGHTS_V2[id], 0, `${id} should be neutralised`);
  }
});

test('WEIGHTS_V2 — boosts the proven contrarian predictors above native weight', () => {
  for (const id of ['LS_SHORTS', 'NEW_BONUS', 'REVERSAL', 'BOTTOM', 'RSI_OS', 'FR_VERY_NEG']) {
    const native = RULES.find((r) => r.id === id).weight;
    assert.ok(WEIGHTS_V2[id] > native, `${id} should be boosted above its native weight ${native}`);
  }
});

test('effectiveWeight — legacy path returns the native weight', () => {
  const tier1 = RULES.find((r) => r.id === 'TIER1_BONUS');
  assert.equal(effectiveWeight(tier1, false), tier1.weight);
  assert.equal(effectiveWeight(tier1, false), 10);
});

test('effectiveWeight — V2 path returns the override when present', () => {
  const tier1 = RULES.find((r) => r.id === 'TIER1_BONUS');
  const shorts = RULES.find((r) => r.id === 'LS_SHORTS');
  assert.equal(effectiveWeight(tier1, true), 0);
  assert.equal(effectiveWeight(shorts, true), 20);
});

test('effectiveWeight — V2 path falls back to native weight for un-overridden rules', () => {
  const knife = RULES.find((r) => r.id === 'FALLING_KNIFE');
  assert.ok(!Object.prototype.hasOwnProperty.call(WEIGHTS_V2, 'FALLING_KNIFE'));
  assert.equal(effectiveWeight(knife, true), knife.weight);
});

test('applyRules — no opts and weightsV2:false are identical (backward compatible)', () => {
  const ctx = { isTier1: true, volume: 6e7, change: 1.5 };
  assert.deepEqual(applyRules(ctx, { weightsV2: false }), applyRules(ctx));
});

test('applyRules — V2 changes weights but never which rules fire', () => {
  /* The same conditions fire under both profiles — only the summed
     weight differs. Verified across a spread of ctx shapes so the
     invariant can't silently break when a future rule is added. */
  const ctxs = [
    { isTier1: true, volume: 1, change: 0 },
    { isTier1: true, volume: 6e7, change: 1.5 },
    { isTier1: false, volume: 1e8, change: -8 },
    { isTier1: false, volume: 5e7, change: 2, frRate: -0.03, lsRatio: 0.5 },
  ];
  for (const ctx of ctxs) {
    const legacy = applyRules(ctx);
    const v2 = applyRules(ctx, { weightsV2: true });
    assert.deepEqual(v2.tagsDelta, legacy.tagsDelta);
    let expected = 0;
    for (const rule of RULES) {
      if (rule.condition(ctx)) expected += effectiveWeight(rule, true);
    }
    assert.equal(v2.scoreDelta, expected);
  }
});

test('applyRules — a Top-100-only coin loses its +10 under V2', () => {
  /* isTier1 with sub-threshold volume/change fires TIER1_BONUS alone:
     +10 on the legacy profile, 0 under V2 (Top-100 bias removed). */
  const ctx = { isTier1: true, volume: 1, change: 0 };
  const legacy = applyRules(ctx);
  const v2 = applyRules(ctx, { weightsV2: true });
  assert.deepEqual(legacy.tagsDelta, ['🏆TOP100']);
  assert.equal(legacy.scoreDelta, 10);
  assert.equal(v2.scoreDelta, 0);
});

/* ─── WEIGHTS_TREND + regime profile selection ────────────────────── */

test('WEIGHTS_TREND — frozen, every key a real rule id, numeric', () => {
  assert.ok(Object.isFrozen(WEIGHTS_TREND));
  const ids = new Set(RULES.map((r) => r.id));
  for (const key of Object.keys(WEIGHTS_TREND)) {
    assert.ok(ids.has(key), `${key} must be a real rule id`);
    assert.equal(typeof WEIGHTS_TREND[key], 'number');
  }
});

test('WEIGHTS_TREND — neutralises structural losers, rewards trend, reduces contrarian', () => {
  for (const id of ['TIER1_BONUS', 'SILENT_ACCUMULATION', 'COINALYZE_OI', 'VOL_NORMAL']) {
    assert.equal(WEIGHTS_TREND[id], 0, `${id} stays neutralised in any regime`);
  }
  /* trend-confirmation rewarded (>= native), the inverse of V2's stance */
  const nativeMtfBull = RULES.find((r) => r.id === 'MTF_BULL_FULL').weight;
  assert.ok(WEIGHTS_TREND.MTF_BULL_FULL >= nativeMtfBull);
  /* mean-revert boosters reduced vs the ranging (V2) profile */
  assert.ok(WEIGHTS_TREND.LS_SHORTS < WEIGHTS_V2.LS_SHORTS);
  assert.ok(WEIGHTS_TREND.RSI_OS < WEIGHTS_V2.RSI_OS);
});

test('effectiveWeight — resolves v2 / trend / legacy (+ boolean alias)', () => {
  const tier1 = RULES.find((r) => r.id === 'TIER1_BONUS');
  const mtf = RULES.find((r) => r.id === 'MTF_BULL_FULL');
  assert.equal(effectiveWeight(tier1, 'legacy'), tier1.weight);
  assert.equal(effectiveWeight(tier1, null), tier1.weight);
  assert.equal(effectiveWeight(tier1, false), tier1.weight);
  assert.equal(effectiveWeight(tier1, 'v2'), 0);
  assert.equal(effectiveWeight(tier1, true), 0); // boolean alias preserved
  assert.equal(effectiveWeight(mtf, 'trend'), WEIGHTS_TREND.MTF_BULL_FULL);
  assert.equal(effectiveWeight(mtf, 'v2'), WEIGHTS_V2.MTF_BULL_FULL);
});

test('applyRules — opts.profile selects the map; weightsV2 alias + precedence', () => {
  const ctx = { isTier1: true, volume: 1, change: 0 }; // fires TIER1_BONUS only
  assert.equal(applyRules(ctx, { profile: 'legacy' }).scoreDelta, 10);
  assert.equal(applyRules(ctx, { profile: 'v2' }).scoreDelta, 0);
  assert.equal(applyRules(ctx, { profile: 'trend' }).scoreDelta, 0);
  assert.deepEqual(applyRules(ctx, { weightsV2: true }), applyRules(ctx, { profile: 'v2' }));
  /* explicit profile wins over the weightsV2 alias */
  assert.equal(applyRules(ctx, { profile: 'legacy', weightsV2: true }).scoreDelta, 10);
});

test('applyRules — trend profile scoreDelta equals sum of effectiveWeight over fired rules', () => {
  const ctxs = [
    { isTier1: true, volume: 6e7, change: 1.5 },
    { isTier1: false, volume: 1e8, change: -8 },
    { mtfStrength: 'full', mtfBias: 'bullish', volume: 1, change: 0 },
  ];
  for (const ctx of ctxs) {
    const out = applyRules(ctx, { profile: 'trend' });
    let expected = 0;
    for (const rule of RULES) {
      if (rule.condition(ctx)) expected += effectiveWeight(rule, 'trend');
    }
    assert.equal(out.scoreDelta, expected);
  }
});
