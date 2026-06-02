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
  assert.equal(up.direction, 'bull'); /* UP-trend */
  /* decisive DOWN breadth counts too (a one-way down tape) */
  const down = detectRegime({
    btcMtf: { agreement: 'bearish', strength: 'partial' },
    bullishPct: 30,
  });
  assert.equal(down.trendScore, 2);
  assert.equal(down.regime, 'trending');
  assert.equal(down.direction, 'bear'); /* DOWN-trend — must NOT be treated like up */
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

test('detectRegime — direction splits a trend into bull / bear (the audit fix)', () => {
  /* Strong UP-trend → bull. */
  const bull = detectRegime({ btcMtf: { agreement: 'bullish', strength: 'full' }, bullishPct: 85 });
  assert.equal(bull.regime, 'trending');
  assert.equal(bull.direction, 'bull');
  /* Strong DOWN-trend → bear — the exact case the binary regime mislabeled as
     just 'trending' and then fed to the MOMENTUM profile (chasing a falling
     tape). It must now be distinguishable so consumers route it to contrarian. */
  const bear = detectRegime({ btcMtf: { agreement: 'bearish', strength: 'full' }, bullishPct: 15 });
  assert.equal(bear.regime, 'trending');
  assert.equal(bear.direction, 'bear');
  /* A range has no dominant direction. */
  const range = detectRegime({ btcMtf: { agreement: 'mixed', strength: 'none' }, bullishPct: 50 });
  assert.equal(range.regime, 'ranging');
  assert.equal(range.direction, 'none');
  /* Trending by breadth but BTC agreement mixed → no clear direction (we don't
     guess; 'none' keeps such a tape on the safe contrarian profile). */
  const ambig = detectRegime({
    btcMtf: { agreement: 'mixed', strength: 'partial' },
    bullishPct: 85,
  });
  assert.equal(ambig.regime, 'trending');
  assert.equal(ambig.direction, 'none');
  /* Cold / empty input → direction 'none'. */
  assert.equal(detectRegime().direction, 'none');
});

test('detectRegime — volatility axis from BTC 15m ATR% (design §4), orthogonal to direction', () => {
  /* High ATR% → volatile, independent of direction (an up-trend can be fast). */
  const volBull = detectRegime({
    btcMtf: { agreement: 'bullish', strength: 'full' },
    bullishPct: 80,
    btcAtrPct: 1.6,
  });
  assert.equal(volBull.direction, 'bull');
  assert.equal(volBull.volatility, 'high');
  assert.equal(volBull.inputs.btcAtrPct, 1.6); /* echoed + rounded */
  /* Calm tape → normal. */
  const calm = detectRegime({
    btcMtf: { agreement: 'bullish', strength: 'full' },
    bullishPct: 80,
    btcAtrPct: 0.5,
  });
  assert.equal(calm.volatility, 'normal');
  /* A volatile RANGE is valid too (volatility ⟂ regime). */
  const volRange = detectRegime({
    btcMtf: { agreement: 'mixed', strength: 'none' },
    bullishPct: 50,
    btcAtrPct: 2.0,
  });
  assert.equal(volRange.regime, 'ranging');
  assert.equal(volRange.volatility, 'high');
  /* Unknown / absent ATR degrades to 'normal' — never tighten on missing data. */
  assert.equal(
    detectRegime({ btcMtf: { agreement: 'bullish', strength: 'full' }, bullishPct: 80 }).volatility,
    'normal'
  );
  assert.equal(detectRegime().volatility, 'normal');
  assert.equal(detectRegime().inputs.btcAtrPct, null);
  /* Threshold is overridable via opts. */
  assert.equal(detectRegime({ btcAtrPct: 0.9 }, { volatilityHi: 0.8 }).volatility, 'high');
});
