/* Tests for src/whale-state.js — purely persisted-state read helpers
   that the UI depends on for whale-tier badging and PnL display.

   Important: these tests exercise the CURRENT behaviour, including a
   couple of known issues flagged by the engineering audit:

     - calcWhaleAvgEntry treats every wave as a buy (no side netting)
     - calcFlowRate inflates when two waves are seconds apart

   When those are fixed in src/whale-state.js, the affected tests below
   are updated alongside the fix (search for "AUDIT-F"). Pinning the
   current behaviour here means the fix PR shows the diff explicitly. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadScript } = require('./_setup.js');

/* whale-state.js reads `T` (price ticker) at call time — set up before load */
globalThis.T = {};
loadScript('src/whale-state.js');

function reset() {
  /* Wipe the persisted store between tests without re-loading the module
     (the `whaleWaves` reference is the same object). */
  for (const k of Object.keys(whaleWaves)) delete whaleWaves[k];
  for (const k of Object.keys(globalThis.T)) delete globalThis.T[k];
}

/* ─── calcRealTotalBuy ────────────────────────────────────────────── */

test('calcRealTotalBuy — returns 0 for unknown sym', () => {
  reset();
  assert.equal(calcRealTotalBuy('NOPE'), 0);
});

test('calcRealTotalBuy — returns 0 when waves array is empty', () => {
  reset();
  whaleWaves.BTC = { waves: [] };
  assert.equal(calcRealTotalBuy('BTC'), 0);
});

test('calcRealTotalBuy — sums confirmed waves only, ignores ESTIMATE', () => {
  reset();
  const now = Date.now();
  whaleWaves.BTC = {
    waves: [
      { time: now - 1000, amount: 100, source: 'CONFIRM' },
      { time: now - 2000, amount: 50, source: 'ESTIMATE' },
      { time: now - 3000, amount: 25, source: 'CONFIRM' },
    ],
  };
  assert.equal(calcRealTotalBuy('BTC'), 125);
});

test('calcRealTotalBuy — drops waves older than 2 h', () => {
  reset();
  const now = Date.now();
  whaleWaves.BTC = {
    waves: [
      { time: now - 1000, amount: 10, source: 'CONFIRM' },
      { time: now - 7200001, amount: 999, source: 'CONFIRM' } /* just past 2h */,
    ],
  };
  assert.equal(calcRealTotalBuy('BTC'), 10);
});

/* ─── calcWhaleAvgEntry ──────────────────────────────────────────── */

test('calcWhaleAvgEntry — returns 0 with no waves', () => {
  reset();
  assert.equal(calcWhaleAvgEntry('BTC'), 0);
});

test('calcWhaleAvgEntry — returns 0 when every wave is ESTIMATE or unpriced', () => {
  reset();
  whaleWaves.BTC = {
    waves: [
      { amount: 1, price: 100, source: 'ESTIMATE', time: Date.now() },
      { amount: 1, price: 0, source: 'CONFIRM', time: Date.now() },
    ],
  };
  assert.equal(calcWhaleAvgEntry('BTC'), 0);
});

test('calcWhaleAvgEntry — volume-weighted across confirmed priced waves', () => {
  reset();
  whaleWaves.BTC = {
    waves: [
      { amount: 1, price: 100, source: 'CONFIRM', time: Date.now() },
      { amount: 3, price: 200, source: 'CONFIRM', time: Date.now() },
      { amount: 99, price: 1, source: 'ESTIMATE', time: Date.now() } /* ignored */,
    ],
  };
  assert.equal(calcWhaleAvgEntry('BTC'), (1 * 100 + 3 * 200) / 4);
});

test('calcWhaleAvgEntry — sells reduce held amount, avg of remaining stays at cost basis (AUDIT-F4)', () => {
  /* Fixed: sells consume the position at the avg entry, leaving the
     remaining 5 units at the original cost of 100 each. */
  reset();
  whaleWaves.BTC = {
    waves: [
      { amount: 10, price: 100, source: 'CONFIRM', side: 'buy', time: Date.now() },
      { amount: 5, price: 200, source: 'CONFIRM', side: 'sell', time: Date.now() },
    ],
  };
  assert.equal(calcWhaleAvgEntry('BTC'), 100, 'avg of the 5 remaining units is 100');
});

test('calcWhaleAvgEntry — sells of the entire position return 0', () => {
  reset();
  whaleWaves.BTC = {
    waves: [
      { amount: 10, price: 100, source: 'CONFIRM', side: 'buy', time: Date.now() },
      { amount: 10, price: 200, source: 'CONFIRM', side: 'sell', time: Date.now() },
    ],
  };
  assert.equal(calcWhaleAvgEntry('BTC'), 0, 'fully closed position has no avg entry');
});

test('calcWhaleAvgEntry — sells that exceed held amount cap at zero (no negative)', () => {
  reset();
  whaleWaves.BTC = {
    waves: [
      { amount: 5, price: 100, source: 'CONFIRM', side: 'buy', time: Date.now() },
      { amount: 100, price: 200, source: 'CONFIRM', side: 'sell', time: Date.now() },
      { amount: 3, price: 150, source: 'CONFIRM', side: 'buy', time: Date.now() },
    ],
  };
  /* The sell over-shoots; held drops to 0. The next buy starts a fresh
     position of 3 units at 150. Avg = 150. */
  assert.equal(calcWhaleAvgEntry('BTC'), 150);
});

test('calcWhaleAvgEntry — waves without `side` field default to buy (legacy data)', () => {
  reset();
  whaleWaves.BTC = {
    waves: [
      { amount: 1, price: 100, source: 'CONFIRM', time: Date.now() } /* no side */,
      { amount: 3, price: 200, source: 'CONFIRM', time: Date.now() },
    ],
  };
  assert.equal(calcWhaleAvgEntry('BTC'), (1 * 100 + 3 * 200) / 4);
});

/* ─── calcWhalePnL ───────────────────────────────────────────────── */

test('calcWhalePnL — UNKNOWN when no avgEntry', () => {
  reset();
  assert.deepEqual(calcWhalePnL('BTC'), { pnl: 0, pct: 0, status: 'UNKNOWN' });
});

test('calcWhalePnL — UNKNOWN when ticker is missing', () => {
  reset();
  whaleWaves.BTC = { waves: [{ amount: 1, price: 100, source: 'CONFIRM', time: Date.now() }] };
  assert.deepEqual(calcWhalePnL('BTC'), { pnl: 0, pct: 0, status: 'UNKNOWN' });
});

test('calcWhalePnL — bucket boundaries', () => {
  reset();
  whaleWaves.BTC = { waves: [{ amount: 1, price: 100, source: 'CONFIRM', time: Date.now() }] };

  globalThis.T.BTC = { p: 103.01 };
  assert.equal(calcWhalePnL('BTC').status, 'PROFIT_TAKING_RISK');

  globalThis.T.BTC = { p: 101 };
  assert.equal(calcWhalePnL('BTC').status, 'IN_PROFIT');

  globalThis.T.BTC = { p: 99 };
  assert.equal(calcWhalePnL('BTC').status, 'UNDERWATER');

  globalThis.T.BTC = { p: 96.99 };
  assert.equal(calcWhalePnL('BTC').status, 'DEEP_LOSS_DUMP_RISK');
});

test('calcWhalePnL — pct math is correct against avgEntry', () => {
  reset();
  whaleWaves.BTC = { waves: [{ amount: 1, price: 100, source: 'CONFIRM', time: Date.now() }] };
  globalThis.T.BTC = { p: 110 };
  const out = calcWhalePnL('BTC');
  assert.equal(out.pct, 10);
  assert.equal(out.pnl, 10);
  assert.equal(out.avgEntry, 100);
});

/* ─── calcFlowRate ───────────────────────────────────────────────── */

test('calcFlowRate — returns 0 when fewer than 2 waves', () => {
  reset();
  whaleWaves.BTC = { waves: [{ amount: 100, time: Date.now() }] };
  assert.equal(calcFlowRate('BTC'), 0);
});

test('calcFlowRate — returns 0 when nothing is inside the 15-minute window', () => {
  reset();
  const old = Date.now() - 30 * 60 * 1000;
  whaleWaves.BTC = {
    waves: [
      { amount: 50, time: old },
      { amount: 50, time: old + 1000 },
    ],
  };
  assert.equal(calcFlowRate('BTC'), 0);
});

test('calcFlowRate — units / minute against the oldest in-window wave', () => {
  reset();
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  whaleWaves.BTC = {
    waves: [
      { amount: 200, time: tenMinAgo } /* oldest in 15-min window */,
      { amount: 100, time: Date.now() - 60 * 1000 },
    ],
  };
  /* total = 300, span ≈ 10 minutes  →  ~30/min (allow ±1 for jitter) */
  const r = calcFlowRate('BTC');
  assert.ok(r > 29 && r < 31, `expected ~30/min, got ${r}`);
});

test('calcFlowRate — clusters of waves within 1 minute do NOT explode (AUDIT-F7)', () => {
  /* Fixed: timeSpan is now floored at 1 minute, so two waves seconds
     apart produce `totalAmount / 1` instead of `totalAmount / (1/60)`.
     200 / 1 = 200, which sits well under the 50,000 alert threshold
     in app.js — no more false aggressive-flow alerts on clustered
     events. */
  reset();
  const now = Date.now();
  whaleWaves.BTC = {
    waves: [
      { amount: 100, time: now - 1000 } /* 1 s ago */,
      { amount: 100, time: now },
    ],
  };
  const r = calcFlowRate('BTC');
  assert.equal(r, 200, 'sub-minute cluster is rate-limited to total/1min');
});
