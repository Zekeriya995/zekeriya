/* Unit tests for src/scanner-regime.js — the market-regime classifier.
   Pins the trendScore math + the degrade-to-ranging defaults so the
   contract holds before the classifier is allowed to drive weight
   selection. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectRegime, DEFAULTS } = require('../src/scanner-regime');

test('detectRegime — cold/empty input degrades to ranging', () => {
  assert.equal(detectRegime().regime, 'ranging');
  assert.equal(detectRegime({}).regime, 'ranging');
  assert.equal(detectRegime({ btcMtf: null, bullishPct: 50 }).trendScore, 0);
});

test('detectRegime — BTC full multi-TF agreement alone is trending', () => {
  const out = detectRegime({ btcMtf: { agreement: 'bearish', strength: 'full' }, bullishPct: 50 });
  assert.equal(out.trendScore, 2);
  assert.equal(out.regime, 'trending');
});

test('detectRegime — BTC partial + decisive breadth is trending', () => {
  const up = detectRegime({
    btcMtf: { agreement: 'bullish', strength: 'partial' },
    bullishPct: 70,
  });
  assert.equal(up.trendScore, 2);
  assert.equal(up.regime, 'trending');
  /* decisive DOWN breadth counts too (a one-way down tape) */
  const down = detectRegime({
    btcMtf: { agreement: 'bearish', strength: 'partial' },
    bullishPct: 30,
  });
  assert.equal(down.trendScore, 2);
  assert.equal(down.regime, 'trending');
});

test('detectRegime — BTC partial without decisive breadth stays ranging', () => {
  const out = detectRegime({
    btcMtf: { agreement: 'bullish', strength: 'partial' },
    bullishPct: 52,
  });
  assert.equal(out.trendScore, 1);
  assert.equal(out.regime, 'ranging');
});

test('detectRegime — decisive breadth alone (BTC mixed) is not enough', () => {
  const out = detectRegime({ btcMtf: { agreement: 'mixed', strength: 'none' }, bullishPct: 80 });
  assert.equal(out.trendScore, 1);
  assert.equal(out.regime, 'ranging');
});

test('detectRegime — the live mean-revert market (BTC mixed, breadth ~30%) reads ranging', () => {
  /* Mirrors the deployed snapshot: BTC agreement mixed/none, most coins red.
     The classifier MUST call this 'ranging' — that is the regime WEIGHTS_V2
     is validated for. */
  const out = detectRegime({ btcMtf: { agreement: 'mixed', strength: 'none' }, bullishPct: 31 });
  assert.equal(out.regime, 'ranging');
  assert.equal(out.inputs.btcStrength, 'none');
  assert.equal(out.inputs.bullishPct, 31);
});

test('detectRegime — echoes inputs and rounds bullishPct', () => {
  const out = detectRegime({
    btcMtf: { agreement: 'bullish', strength: 'full' },
    bullishPct: 66.666,
  });
  assert.equal(out.inputs.btcAgreement, 'bullish');
  assert.equal(out.inputs.btcStrength, 'full');
  assert.equal(out.inputs.bullishPct, 66.7);
});

test('detectRegime — opts can override thresholds', () => {
  /* Raise the bar so a full-agreement BTC is no longer enough on its own. */
  const out = detectRegime(
    { btcMtf: { agreement: 'bullish', strength: 'full' }, bullishPct: 50 },
    { trendScoreMin: 3 }
  );
  assert.equal(out.trendScore, 2);
  assert.equal(out.regime, 'ranging');
});

test('detectRegime — malformed btcMtf is treated as no trend', () => {
  assert.equal(detectRegime({ btcMtf: 'oops', bullishPct: 50 }).trendScore, 0);
  assert.equal(detectRegime({ btcMtf: { strength: 42 }, bullishPct: 50 }).trendScore, 0);
  assert.equal(DEFAULTS.TREND_SCORE_MIN, 2);
});
