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
     score as before PR C (+10 from TIER1_BONUS only). If a
     future refactor inadvertently removes the precedence gate
     on TIER2_BONUS, this test catches it. */
  const out = applyRules({ isTier1: true, isTier2: true, volume: 6e7, change: 1.5 });
  /* Score: TIER1 (+10) + SILENT_ACC (+25, since 6e7>5e7 and
     abs(1.5)<2) + EARLY_ENTRY (+20, since 6e7>3e7 and 1.5 in
     [0.3, 2)). NO TIER2, NO NEW. Total = 55. */
  assert.equal(out.scoreDelta, 55);
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

test('applyRules — tier-2 client coin scores +5 (not +5+2)', () => {
  /* End-to-end check via applyRules: a tier-2 coin at $80M and
     +0.5% should fire TIER2_BONUS (+5), SILENT_ACC (+25),
     EARLY_ENTRY (+20). Total +50. Without the !== true gate on
     NEW_BONUS, it would also +2 to +52 — that's the regression
     this PR guards against. */
  const out = applyRules({ isTier1: false, isTier2: true, volume: 8e7, change: 0.5 });
  assert.equal(out.scoreDelta, 50);
  assert.deepEqual(out.tagsDelta.sort(), ['🥈T2', '🐋ACC', '🔍EARLY'].sort());
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
  /* SAGA-shaped: tier-1ish high volume, change = -15. Net score
     before this rule: TIER1 (10) + SILENT_ACC (would fire on |change|<2
     → no, change=-15 is far from flat → does NOT fire) + VOL bonuses
     in other rules... but FALLING_KNIFE adds -50. Walk the applyRules
     output explicitly. */
  const ctx = { isTier1: true, volume: 1e8, change: -15 };
  const out = applyRules(ctx);
  /* TIER1_BONUS (+10) and FALLING_KNIFE (-50) → net -40.
     SILENT_ACC needs |change|<2 → does NOT fire on -15.
     EARLY_ENTRY needs change in [0.3, 2) → does NOT fire on -15.
     STEALTH needs change in [0.5, 3) → does NOT fire on -15. */
  assert.equal(out.scoreDelta, -40);
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
