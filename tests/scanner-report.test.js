/* Unit tests for vps/scanner-report.js — pins the report's verdict logic
   (which windows count as meaningful, and whether V2 beats legacy) and the
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

function ab(windowDays, champNet, chalNet, chalN, droppedNet, opts) {
  return {
    windowDays,
    champion: { avgNetGain: champNet, netWinRate: (opts && opts.cWin) || 31, surfaced: 300 },
    challenger: { avgNetGain: chalNet, netWinRate: (opts && opts.vWin) || 60, surfaced: chalN },
    dropped: { avgNetGain: droppedNet, count: 100 },
  };
}

test('buildReport — surfaces regime, alpha, and per-tier lines', () => {
  const out = buildReport(ALL, [ab(7, -0.75, 0.75, 75, -1.16)]);
  assert.match(out, /Regime: ranging/);
  assert.match(out, /breadth=23\.7%/);
  assert.match(out, /alpha: 49%/);
  assert.match(out, /ULTRA 4% \(135\)/);
});

test('buildReport — verdict ✅ when V2 beats legacy on all meaningful windows', () => {
  const out = buildReport(ALL, [
    ab(2, 1.35, -3.46, 6, 1.7), // small V2 sample → ignored in verdict, flagged (low)
    ab(7, -0.75, 0.75, 75, -1.16),
    ab(30, -0.72, 0.9, 73, -1.16),
  ]);
  assert.match(out, /✅ V2 beats legacy on all 2 meaningful/);
  assert.match(out, /\(low\)/); // the 2-day row is flagged
});

test('buildReport — verdict ⚠️ when V2 loses on a meaningful window', () => {
  const out = buildReport(ALL, [ab(7, 0.5, -0.5, 40, 0.6)]); // meaningful (40), V2 worse
  assert.match(out, /⚠️ V2 beats legacy on 0\/1 meaningful/);
});

test('buildReport — says "no meaningful sample" when every V2 sample is tiny', () => {
  const out = buildReport(ALL, [ab(2, 1.35, -3.46, 6, 1.7)]);
  assert.match(out, /no window has a meaningful V2 sample/);
});

test('buildReport — degrades gracefully on missing regime and unavailable windows', () => {
  const out = buildReport({}, [{ windowDays: 14, error: 'timeout' }]);
  assert.match(out, /Regime: \(not available\)/);
  assert.match(out, /14d.*\(unavailable\)/);
});
