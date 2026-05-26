/* Unit tests for vps/scanner-report.js — pins the report's verdict logic
   (which windows count as meaningful; V2 vs legacy and Trend vs V2) and the
   degrade-gracefully behaviour on missing/unavailable data. buildReport is
   pure; the fetch wrapper (main) is not tested. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReport } = require('../vps/scanner-report');

const ALL = {
  regime: { regime: 'ranging', trendScore: 1, inputs: { btcStrength: 'none', bullishPct: 23.7 } },
  scannerStats: {
    winRate: 7,
    totalEvaluated: 633,
    alpha: { alphaWinRate: 49 },
    byTier: { ULTRA: { winRate: 4, count: 135 }, STRONG: { winRate: 7, count: 498 } },
  },
};

/* opts.trendNet (+ trWin/trN) adds a challengerTrend block; omitting it mimics
   an older API response with no trend column. */
function ab(windowDays, champNet, chalNet, chalN, droppedNet, opts) {
  const o = opts || {};
  const e = {
    windowDays,
    champion: { avgNetGain: champNet, netWinRate: o.cWin || 31, surfaced: 300 },
    challenger: { avgNetGain: chalNet, netWinRate: o.vWin || 60, surfaced: chalN },
    dropped: { avgNetGain: droppedNet, count: 100 },
  };
  if (o.trendNet != null) {
    e.challengerTrend = {
      avgNetGain: o.trendNet,
      netWinRate: o.trWin || 60,
      surfaced: o.trN != null ? o.trN : chalN,
    };
    e.droppedTrend = { avgNetGain: 0, count: 50 };
  }
  return e;
}

test('buildReport — surfaces regime, alpha, and per-tier lines', () => {
  const out = buildReport(ALL, [ab(7, -0.75, 0.75, 75, -1.16)]);
  assert.match(out, /Regime: ranging/);
  assert.match(out, /breadth=23\.7%/);
  assert.match(out, /alpha: 49%/);
  assert.match(out, /ULTRA 4% \(135\)/);
});

test('buildReport — V2-vs-legacy verdict counts only meaningful windows', () => {
  const out = buildReport(ALL, [
    ab(2, 1.35, -3.46, 6, 1.7), // small V2 sample → ignored, flagged (low)
    ab(7, -0.75, 0.75, 75, -1.16),
    ab(30, -0.72, 0.9, 73, -1.16),
  ]);
  assert.match(out, /V2 vs legacy: beats on 2\/2 meaningful/);
  assert.match(out, /\(low\)/); // the 2-day row is flagged
});

test('buildReport — V2-vs-legacy verdict reports a loss on a meaningful window', () => {
  const out = buildReport(ALL, [ab(7, 0.5, -0.5, 40, 0.6)]); // meaningful (40), V2 worse
  assert.match(out, /V2 vs legacy: beats on 0\/1 meaningful/);
});

test('buildReport — Trend column + Trend-vs-V2 verdict when challengerTrend present', () => {
  const out = buildReport(ALL, [
    ab(7, -0.75, 0.2, 80, -1.11, { trendNet: 1.1, trWin: 70, trN: 75 }),
  ]);
  assert.match(out, /Trend/); // column header
  assert.match(out, /\+1\.10%\/70%/); // trend cell
  // trend (1.10) beats V2 (0.20) and legacy (-0.75) on the 1 meaningful window
  assert.match(out, /Trend \(live in trends\): beats V2 on 1\/1, beats legacy on 1\/1/);
});

test('buildReport — says "no meaningful sample" when every sample is tiny', () => {
  const out = buildReport(ALL, [ab(2, 1.35, -3.46, 6, 1.7)]);
  assert.match(out, /no window has a meaningful sample/);
});

test('buildReport — degrades gracefully on missing regime and unavailable windows', () => {
  const out = buildReport({}, [{ windowDays: 14, error: 'timeout' }]);
  assert.match(out, /Regime: \(not available\)/);
  assert.match(out, /14d.*\(unavailable\)/);
});

test('buildReport — renders the Live (actual stamped) section from the longest window', () => {
  const withLive = ab(30, -0.85, 0.2, 80, -1.11, { trendNet: 1.1, trN: 75 });
  withLive.live = {
    windowDays: 30,
    feePct: 0.2,
    legacy: { surfaced: 200, netWinRate: 25, avgNetGain: -0.9 },
    v2: { surfaced: 40, netWinRate: 60, avgNetGain: 0.3 },
    trend: { surfaced: 25, netWinRate: 68, avgNetGain: 1.2 },
  };
  const out = buildReport(ALL, [withLive]);
  assert.match(out, /Live \(actual signals surfaced under each profile, 30d\):/);
  assert.match(out, /trend \+1\.20%\/68% \(25\)/);
});

test('buildReport — flags a still-small live trend sample as not conclusive', () => {
  const withLive = ab(30, -0.85, 0.2, 80, -1.11, { trendNet: 1.1, trN: 75 });
  withLive.live = {
    windowDays: 30,
    feePct: 0.2,
    legacy: { surfaced: 200, netWinRate: 25, avgNetGain: -0.9 },
    v2: { surfaced: 40, netWinRate: 60, avgNetGain: 0.3 },
    trend: { surfaced: 5, netWinRate: 60, avgNetGain: 1.2 }, // < MIN_MEANINGFUL
  };
  const out = buildReport(ALL, [withLive]);
  assert.match(out, /trend sample < 20 — not yet conclusive/);
});
