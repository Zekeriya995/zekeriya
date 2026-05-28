/* Unit tests for vps/calibrate-weights.js — the L2 weight calibrator.
   Covers the pure core: _scoreUnderWeights / _evalProfile parity with
   scoring-rules; buildCandidate's data gates, walk-forward split,
   coordinate-descent convergence on synthetic data with a known optimum,
   the per-weight cap, and — most importantly — that validation never
   influences the fit (the leakage / walk-forward integrity test). */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCandidate,
  buildReport,
  _scoreUnderWeights,
  _evalProfile,
  _incumbentFor,
} = require('../vps/calibrate-weights');
const { RULES, applyRules, WEIGHTS_TREND } = require('../src/scoring-rules');

const NOW = 1_730_000_000_000;

/* Minimal ctx that triggers ONLY TIER1_BONUS (id='TIER1_BONUS', native
   weight 10). Other rules' conditions use strict typeof / === checks that
   fail on absent fields, so a bare { isTier1: true } isolates one rule. */
function tier1Ctx() {
  return { isTier1: true };
}
function neutralCtx() {
  return {}; /* no rule conditions fire */
}

function entry(opts) {
  return {
    s: opts.s || 'X',
    evaluated: true,
    outcome: 'win',
    pctChange: opts.pctChange,
    recordedAt: opts.recordedAt,
    weightsProfile: opts.weightsProfile || 'legacy',
    ctx: opts.ctx,
  };
}

/* ─── _scoreUnderWeights / _evalProfile ───────────────────────────── */

test('_scoreUnderWeights — matches applyRules when no overrides are given', () => {
  const ctx = tier1Ctx();
  const direct = applyRules(ctx, {});
  const ours = _scoreUnderWeights(ctx, {});
  assert.equal(ours, direct.scoreDelta);
});

test('_scoreUnderWeights — applies a per-rule override only when the rule fires', () => {
  const fires = tier1Ctx();
  const doesNotFire = neutralCtx();
  assert.equal(_scoreUnderWeights(fires, { TIER1_BONUS: 42 }), 42);
  assert.equal(_scoreUnderWeights(doesNotFire, { TIER1_BONUS: 42 }), 0);
});

test('_scoreUnderWeights — missing key falls back to the rule native weight', () => {
  const nativeTier1 = RULES.find((r) => r.id === 'TIER1_BONUS').weight;
  /* {} = no override → native weight is used. */
  assert.equal(_scoreUnderWeights(tier1Ctx(), {}), nativeTier1);
});

test('_evalProfile — qualified case: mean net of fees + win rate', () => {
  const entries = [
    entry({ ctx: tier1Ctx(), pctChange: 5, recordedAt: 1 }),
    entry({ ctx: tier1Ctx(), pctChange: -1, recordedAt: 2 }),
    entry({ ctx: tier1Ctx(), pctChange: 3, recordedAt: 3 }),
  ];
  const out = _evalProfile(
    entries,
    { TIER1_BONUS: 100 },
    {
      feePct: 0.2,
      threshold: 50,
      minSurface: 1,
    }
  );
  assert.equal(out.qualified, true);
  assert.equal(out.surfaced, 3);
  /* (5 + -1 + 3)/3 = 2.33 ; net = 2.33 − 0.2 = 2.13 */
  assert.equal(out.net, 2.13);
});

test('_evalProfile — below minSurface → unqualified with net=-Infinity', () => {
  const entries = [entry({ ctx: tier1Ctx(), pctChange: 5, recordedAt: 1 })];
  const out = _evalProfile(
    entries,
    { TIER1_BONUS: 100 },
    {
      feePct: 0.2,
      threshold: 50,
      minSurface: 5,
    }
  );
  assert.equal(out.qualified, false);
  assert.equal(out.net, -Infinity);
});

test('_incumbentFor — v2/trend return their override maps; legacy spans all rules', () => {
  const v2 = _incumbentFor('v2');
  const trend = _incumbentFor('trend');
  const legacy = _incumbentFor('legacy');
  assert.ok(Object.keys(trend).length > 0);
  assert.deepEqual(trend, Object.assign({}, WEIGHTS_TREND));
  assert.ok(Object.keys(v2).length > 0);
  /* legacy contains every rule id (the full search space for a sanity run). */
  for (const r of RULES) assert.ok(legacy[r.id] !== undefined);
});

/* ─── buildCandidate — data gates ────────────────────────────────── */

test('buildCandidate — skips with reason when sample < minSample', () => {
  const r = buildCandidate([], { profile: 'trend', minSample: 30 });
  assert.equal(r.skipped, true);
  assert.match(r.reason, /insufficient/);
  assert.equal(r.sample, 0);
});

test('buildCandidate — skips when the validation slice is too small after split', () => {
  /* 10 trend entries × split 0.9 → train 9, val 1 → < minVal=5 → skip */
  const entries = [];
  for (let i = 0; i < 10; i++) {
    entries.push(
      entry({ ctx: tier1Ctx(), pctChange: 1, recordedAt: NOW + i, weightsProfile: 'trend' })
    );
  }
  const r = buildCandidate(entries, {
    profile: 'trend',
    minSample: 5,
    minVal: 5,
    split: 0.9,
  });
  assert.equal(r.skipped, true);
  assert.match(r.reason, /validation/);
});

/* ─── buildCandidate — walk-forward integrity ────────────────────── */

test('buildCandidate — walk-forward split puts oldest entries in train, newest in val', () => {
  const entries = [];
  /* 20 entries dated 1..20; split 0.7 → train: 1..14, val: 15..20 */
  for (let i = 1; i <= 20; i++) {
    entries.push(
      entry({
        s: 'S' + i,
        ctx: tier1Ctx(),
        pctChange: 1,
        recordedAt: NOW + i * 1000,
        weightsProfile: 'trend',
      })
    );
  }
  const r = buildCandidate(entries, {
    profile: 'trend',
    minSample: 5,
    minVal: 5,
    minSurface: 1,
    threshold: 10,
    deltas: [5],
    cap: 20,
    maxPasses: 1,
  });
  assert.equal(r.skipped, false);
  assert.equal(r.trainSize, 14);
  assert.equal(r.valSize, 6);
});

test('buildCandidate — converges to a profitable direction on synthetic data with a known optimum', () => {
  /* 40 train + 20 val. Half of each split has ctx.isTier1=true and a positive
     outcome; the other half has no firing rules and a negative outcome. With
     incumbent TIER1_BONUS=5 (below threshold=10) NOTHING surfaces. The
     optimizer must raise TIER1_BONUS to surface the winners. */
  const entries = [];
  for (let i = 0; i < 60; i++) {
    const isWinner = i % 2 === 0;
    entries.push(
      entry({
        s: 'S' + i,
        ctx: isWinner ? tier1Ctx() : neutralCtx(),
        pctChange: isWinner ? 3 : -1,
        recordedAt: NOW + i * 1000,
        weightsProfile: 'trend',
      })
    );
  }
  const r = buildCandidate(entries, {
    profile: 'trend',
    incumbent: { TIER1_BONUS: 5 },
    minSample: 10,
    minVal: 5,
    minSurface: 1,
    threshold: 10,
    feePct: 0.2,
    deltas: [-2, 2, 5, 10],
    cap: 20,
    maxPasses: 4,
  });
  assert.equal(r.skipped, false);
  /* incumbent doesn't reach threshold; candidate should raise TIER1_BONUS */
  assert.ok(r.candidateWeights.TIER1_BONUS > 5);
  assert.ok(r.candidateVal.qualified, 'candidate should surface on validation');
  assert.ok(r.candidateVal.net > 0, 'val net should be positive after fit');
  assert.ok(r.diff.TIER1_BONUS, 'diff should report the rule that moved');
});

test('buildCandidate — respects the per-weight cap (no wholesale rewrites)', () => {
  const entries = [];
  for (let i = 0; i < 60; i++) {
    const isWinner = i % 2 === 0;
    entries.push(
      entry({
        ctx: isWinner ? tier1Ctx() : neutralCtx(),
        pctChange: isWinner ? 3 : -1,
        recordedAt: NOW + i * 1000,
        weightsProfile: 'trend',
      })
    );
  }
  const r = buildCandidate(entries, {
    profile: 'trend',
    incumbent: { TIER1_BONUS: 5 },
    minSample: 10,
    minVal: 5,
    minSurface: 1,
    threshold: 10,
    feePct: 0.2,
    deltas: [-50, 50] /* big deltas — the cap must clamp them */,
    cap: 3,
    maxPasses: 4,
  });
  assert.equal(r.skipped, false);
  /* TIER1_BONUS may move at most ±3 from the incumbent (5). */
  assert.ok(r.candidateWeights.TIER1_BONUS <= 5 + 3);
  assert.ok(r.candidateWeights.TIER1_BONUS >= 5 - 3);
});

/* THE KEY TEST: validation must NEVER influence the candidate weights. We
   build two histories with byte-identical TRAIN but OPPOSITE val outcomes;
   the candidate weights must be identical, while the val numbers differ. */
test('buildCandidate — walk-forward integrity: validation does NOT influence the fit', () => {
  const trainPart = [];
  for (let i = 0; i < 40; i++) {
    const isWinner = i % 2 === 0;
    trainPart.push(
      entry({
        s: 'TR' + i,
        ctx: isWinner ? tier1Ctx() : neutralCtx(),
        pctChange: isWinner ? 3 : -1,
        recordedAt: NOW + i * 1000,
        weightsProfile: 'trend',
      })
    );
  }
  const makeVal = (winnerPct, loserPct) => {
    const out = [];
    for (let i = 0; i < 20; i++) {
      const isWinner = i % 2 === 0;
      out.push(
        entry({
          s: 'VL' + i,
          ctx: isWinner ? tier1Ctx() : neutralCtx(),
          pctChange: isWinner ? winnerPct : loserPct,
          recordedAt: NOW + (100 + i) * 1000 /* strictly newer than train */,
          weightsProfile: 'trend',
        })
      );
    }
    return out;
  };

  const histA = trainPart.concat(makeVal(+3, -1)); /* val agrees with train */
  const histB = trainPart.concat(makeVal(-3, +1)); /* val REVERSED */

  const optsCommon = {
    profile: 'trend',
    incumbent: { TIER1_BONUS: 5 },
    minSample: 10,
    minVal: 5,
    minSurface: 1,
    threshold: 10,
    feePct: 0.2,
    deltas: [-5, -2, 2, 5, 10],
    cap: 20,
    maxPasses: 4,
  };
  const rA = buildCandidate(histA, optsCommon);
  const rB = buildCandidate(histB, optsCommon);

  /* Train is identical → candidate weights MUST be identical regardless of val.
     This is the no-leakage invariant. */
  assert.deepEqual(
    rA.candidateWeights,
    rB.candidateWeights,
    'leakage detected: validation altered the candidate weights'
  );

  /* But the validation numbers differ because val itself differs. */
  assert.notEqual(rA.candidateVal.net, rB.candidateVal.net);
});

/* ─── buildReport — text rendering ───────────────────────────────── */

test('buildReport — renders the SKIPPED path with a reason', () => {
  const text = buildReport(buildCandidate([], { profile: 'trend', minSample: 30 }));
  assert.match(text, /Calibrator \(L2\)/);
  assert.match(text, /Profile: trend/);
  assert.match(text, /\[SKIPPED\]/);
  assert.match(text, /keep accumulating/);
});

test('buildReport — renders the qualified path with incumbent vs candidate + a diff', () => {
  const entries = [];
  for (let i = 0; i < 60; i++) {
    const isWinner = i % 2 === 0;
    entries.push(
      entry({
        ctx: isWinner ? tier1Ctx() : neutralCtx(),
        pctChange: isWinner ? 3 : -1,
        recordedAt: NOW + i * 1000,
        weightsProfile: 'trend',
      })
    );
  }
  const r = buildCandidate(entries, {
    profile: 'trend',
    incumbent: { TIER1_BONUS: 5 },
    minSample: 10,
    minVal: 5,
    minSurface: 1,
    threshold: 10,
    deltas: [5, 10],
    cap: 20,
    maxPasses: 2,
  });
  const text = buildReport(r);
  assert.match(text, /Out-of-sample/);
  assert.match(text, /incumbent :/);
  assert.match(text, /candidate :/);
  assert.match(text, /TIER1_BONUS/);
  assert.match(text, /Candidate only/);
});
