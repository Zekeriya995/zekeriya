/* Unit tests for src/scanner-engine.js — the always-on server-side
   pass that mirrors the PWA's quickScan and feeds /api/all's signals
   plus the ULTRA + Top-3 push triggers. Covers the score-out paths
   that matter for the trigger thresholds (ULTRA cutoff, Top 3
   ordering, hard rejects) without re-testing every individual tag
   the helpers fire. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runScannerPass,
  scoreSymbol,
  STABLE_SET,
  TIER1_SYMBOLS,
  regimeTierBump,
  BEAR_TIER_BUMP,
  VOLATILE_TIER_BUMP,
} = require('../src/scanner-engine');

function tk(over) {
  return Object.assign({ price: 100, change: 1, volume: 1e8, high: 102, low: 98 }, over);
}

test('STABLE_SET excludes obvious stablecoins', () => {
  for (const s of ['USDT', 'USDC', 'DAI', 'TUSD', 'BUSD', 'FDUSD', 'USDP', 'PYUSD']) {
    assert.equal(STABLE_SET.has(s), true, s + ' should be a stablecoin');
  }
  assert.equal(STABLE_SET.has('BTC'), false);
});

test('STABLE_SET covers the 2024-2026 generation (USD1, RLUSD, USDE...)', () => {
  /* The live audit on 2026-05-13 caught USD1 and RLUSD leaking into
     Top 10 because they were missing. This locks the regression. */
  for (const s of ['USD1', 'RLUSD', 'USDE', 'USDM', 'FRAX', 'GHO', 'CRVUSD', 'USDD']) {
    assert.equal(STABLE_SET.has(s), true, s + ' should be a stablecoin');
  }
});

test('TIER1_SYMBOLS contains the majors', () => {
  for (const s of ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']) {
    assert.equal(TIER1_SYMBOLS.has(s), true, s + ' should be tier 1');
  }
});

/* ─── scoreSymbol ─────────────────────────────────────────────────── */

test('scoreSymbol — null when no ticker data', () => {
  assert.equal(scoreSymbol('FOO', { ticker: null }), null);
});

test('scoreSymbol — null when overheated (>= 8% change)', () => {
  const r = scoreSymbol('BTC', { ticker: tk({ change: 9 }) });
  assert.equal(r, null);
});

test('scoreSymbol — null when volume below tier-1 floor', () => {
  /* BTC is tier 1 → minVol = 1M. 500K is below. */
  const r = scoreSymbol('BTC', { ticker: tk({ volume: 500_000 }) });
  assert.equal(r, null);
});

test('scoreSymbol — null on wash-trading (huge volume, oi = 0)', () => {
  /* CHIP pattern: $1.18B spot volume with $0 perp OI. */
  const r = scoreSymbol('CHIP', {
    ticker: tk({ volume: 1.2e9, change: -3, price: 0.06 }),
    oi: 0,
  });
  assert.equal(r, null, 'wash-trade fingerprint should reject');
});

test('scoreSymbol — null on wash-trading even when oi is missing entirely', () => {
  /* Live VPS audit caught this case: CHIP was filtered when oi=0 was
     supplied to the test but production has cache.oi[\'CHIP\'] =
     undefined because Binance Futures refuses the symbol. The filter
     must treat missing-OI same as zero-OI for any non-tier-1 symbol. */
  const r = scoreSymbol('CHIP', {
    ticker: tk({ volume: 1.2e9, change: -3, price: 0.06 }),
    /* deliberately no `oi` key */
  });
  assert.equal(r, null, 'missing OI on huge-volume non-tier1 must reject');
});

test('scoreSymbol — tier-1 majors survive even with missing OI', () => {
  /* BTC at $1.1B volume must survive a transient OI fetch failure
     because TIER1 are hand-verified legitimate. */
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 1.2e9, change: 0.5 }),
    /* deliberately no `oi` key */
  });
  assert.ok(r, 'tier1 must pass when oi data is temporarily missing');
});

test('scoreSymbol — keeps symbols with huge volume AND real OI', () => {
  /* A non-tier1 symbol with both high volume and real OI should pass. */
  const r = scoreSymbol('NEWCOIN', {
    ticker: tk({ volume: 1.2e9, change: 0.5 }),
    oi: 50_000_000,
  });
  assert.ok(r, 'real symbols with both volume and OI should pass');
});

test('scoreSymbol — keeps small-volume symbols even when oi is zero', () => {
  /* A $50M-volume coin with no OI should NOT be wash-rejected — the
     filter only fires above the WASH_VOLUME_FLOOR. */
  const r = scoreSymbol('NEWCOIN', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    oi: 0,
  });
  assert.ok(r);
});

test('scoreSymbol — tier-1 majors get the TOP100 bonus tag', () => {
  const r = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  assert.ok(r);
  assert.ok(r.tags.includes('🏆TOP100'));
});

test('scoreSymbol — silent accumulation tag fires on flat+volume', () => {
  const r = scoreSymbol('BTC', { ticker: tk({ volume: 6e7, change: 0.5 }) });
  assert.ok(r.tags.includes('🐋ACC'));
});

test('scoreSymbol — late entry penalty (change > 5)', () => {
  const flat = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const late = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 6 }) });
  assert.ok(flat && late);
  assert.ok(flat.score > late.score, 'late entries must score lower than flat ones');
});

test('scoreSymbol — funding-rate negative adds points', () => {
  const noFr = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const withFr = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    fr: { rate: -0.02 },
  });
  assert.ok(withFr.score > noFr.score);
  assert.ok(withFr.tags.includes('FR⬇️'));
});

test('scoreSymbol — coinalyze multi-exchange FR negative confirms', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    coinalyzeFR: { rate: -0.02 },
  });
  assert.ok(r.tags.includes('🌐FR_NEG'));
});

test('scoreSymbol — bitfinex margin long >= 65 confirms', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    bitfinex: { longPct: 75 },
  });
  assert.ok(r.tags.includes('📊BFX_LONG'));
});

test('scoreSymbol — whale wave Tier A adds 20 + whale tag', () => {
  const noWhale = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const tierA = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    whaleWave: { engine: { rank: 'A', confidence: 90 } },
  });
  assert.ok(tierA.score - noWhale.score >= 19, 'Tier A should add ~20 points');
  assert.ok(tierA.tags.includes('🐋WHALE_A'));
});

test('scoreSymbol — whale wave Tier D (distribution) penalises score', () => {
  const tierD = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    whaleWave: { engine: { rank: 'D', confidence: 60 } },
  });
  assert.ok(tierD.tags.includes('🐋DUMPED'));
});

test('scoreSymbol — multi-TF full bullish agreement adds 15 + MTF_BULL tag', () => {
  const noMtf = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const withMtf = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    mtfAgreement: { agreement: 'bullish', strength: 'full', count: 3, tfs: ['15m', '1h', '4h'] },
  });
  assert.ok(withMtf.score - noMtf.score >= 14, 'full bullish MTF should add ~15');
  assert.ok(withMtf.tags.includes('🎯MTF_BULL'));
});

test('scoreSymbol — multi-TF partial bullish adds the lighter +8 bonus', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    mtfAgreement: { agreement: 'bullish', strength: 'partial', count: 2, tfs: ['15m', '1h'] },
  });
  assert.ok(r.tags.includes('🎯MTF_BULL_2'));
});

test('scoreSymbol — multi-TF full bearish penalises and tags', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    mtfAgreement: { agreement: 'bearish', strength: 'full', count: 3, tfs: ['15m', '1h', '4h'] },
  });
  assert.ok(r.tags.includes('🎯MTF_BEAR'));
});

test('scoreSymbol — multi-TF mixed verdict does nothing to the score', () => {
  const baseline = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const mixed = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    mtfAgreement: { agreement: 'mixed', strength: 'none', count: 0, tfs: ['15m', '1h', '4h'] },
  });
  assert.equal(mixed.score, baseline.score);
});

test('scoreSymbol — RSI oversold (<30) adds bullish bonus + RSI_OS tag', () => {
  const baseline = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const oversold = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    indicator: { rsi: 25, macd: { h: 0, signal: 0, cross: 'none' } },
  });
  assert.ok(oversold.score - baseline.score >= 9);
  assert.ok(oversold.tags.includes('📉RSI_OS'));
});

test('scoreSymbol — RSI overbought (>70) penalises score + RSI_OB tag', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    indicator: { rsi: 75, macd: { h: 0, signal: 0, cross: 'none' } },
  });
  assert.ok(r.tags.includes('📈RSI_OB'));
});

test('scoreSymbol — MACD bull cross adds 12 + MACD_BULL tag', () => {
  const baseline = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const bullCross = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    indicator: { rsi: 50, macd: { h: 10, signal: 5, cross: 'bull' } },
  });
  assert.ok(bullCross.score - baseline.score >= 11);
  assert.ok(bullCross.tags.includes('📊MACD_BULL'));
});

test('scoreSymbol — MACD bear cross penalises + MACD_BEAR tag', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    indicator: { rsi: 50, macd: { h: -10, signal: -5, cross: 'bear' } },
  });
  assert.ok(r.tags.includes('📊MACD_BEAR'));
});

test('scoreSymbol — MACD histogram only (no fresh cross) gets the lighter +3', () => {
  const baseline = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const histPos = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    indicator: { rsi: 50, macd: { h: 5, signal: 2, cross: 'none' } },
  });
  /* +3 is the only delta — not +12 like a fresh cross. */
  const delta = histPos.score - baseline.score;
  assert.ok(delta >= 2 && delta <= 4, 'mild MACD bias should be ~3, got ' + delta);
});

test('scoreSymbol — bullish news sentiment adds 5 + BULL_NEWS tag', () => {
  const baseline = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const bull = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    newsSentiment: { positive: 15, negative: 3, neutral: 5, total: 23 },
  });
  assert.ok(bull.score - baseline.score >= 4);
  assert.ok(bull.tags.includes('📰BULL_NEWS'));
});

test('scoreSymbol — bearish news sentiment penalises + BEAR_NEWS tag', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    newsSentiment: { positive: 3, negative: 15, neutral: 5, total: 23 },
  });
  assert.ok(r.tags.includes('📰BEAR_NEWS'));
});

test('scoreSymbol — thin news cycle (total < 20) does not fire either tag', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    newsSentiment: { positive: 8, negative: 1, neutral: 2, total: 11 },
  });
  assert.ok(!r.tags.includes('📰BULL_NEWS'));
  assert.ok(!r.tags.includes('📰BEAR_NEWS'));
});

test('scoreSymbol — output includes manipulationRisk on every signal', () => {
  const r = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  assert.ok(r.manipulationRisk);
  assert.equal(typeof r.manipulationRisk.risk, 'number');
  assert.equal(typeof r.manipulationRisk.verdict, 'string');
  assert.ok(Array.isArray(r.manipulationRisk.reasons));
  assert.equal(r.manipulationRisk.verdict, 'LOW', 'a clean BTC signal should be LOW risk');
});

test('scoreSymbol — penny non-tier1 raises manipulation risk', () => {
  /* Non-tier-1 token at $0.005 with no other red flags. */
  const r = scoreSymbol('PENNY', { ticker: tk({ volume: 5e7, change: 0.5, price: 0.005 }) });
  assert.ok(r.manipulationRisk.reasons.includes('penny price'));
  assert.ok(r.manipulationRisk.risk >= 15);
});

test('scoreSymbol — tier-1 majors are exempt from penny / vol-OI flags', () => {
  /* BTC-style: tier-1 even at a fictional low price. */
  const r = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5, price: 0.001 }) });
  assert.equal(r.manipulationRisk.verdict, 'LOW');
});

test('scoreSymbol — extreme funding rate (>50%) flags manipulation', () => {
  const r = scoreSymbol('FOO', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    fr: { rate: 0.6 },
  });
  assert.ok(r.manipulationRisk.reasons.includes('extreme funding'));
});

test('scoreSymbol — extreme bid/ask imbalance (>20x) flags manipulation', () => {
  const r = scoreSymbol('FOO', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    /* 25× bid wall — looks like spoofing. */
    depth: {
      bids: [[100, 1000]],
      asks: [[101, 40]],
    },
  });
  assert.ok(r.manipulationRisk.reasons.includes('book imbalance'));
});

test('scoreSymbol — HIGH manipulation risk applies -15 + tag', () => {
  /* Stack three flags: penny + vol/oi gap + extreme funding → 65 risk. */
  const baseline = scoreSymbol('FOO', { ticker: tk({ volume: 1.5e8, change: 0.5, price: 0.005 }) });
  const flagged = scoreSymbol('FOO', {
    ticker: tk({ volume: 1.5e8, change: 0.5, price: 0.005 }),
    oi: 500_000,
    fr: { rate: 0.6 },
  });
  assert.equal(flagged.manipulationRisk.verdict, 'HIGH');
  assert.ok(flagged.tags.includes('🚨MANIP_HIGH'));
  assert.ok(baseline.score - flagged.score >= 14, 'HIGH should drop ~15 score');
});

test('scoreSymbol — MEDIUM manipulation risk applies -5 + tag', () => {
  /* Penny + extreme funding alone: 35 risk → MEDIUM. */
  const r = scoreSymbol('FOO', {
    ticker: tk({ volume: 5e7, change: 0.5, price: 0.005 }),
    fr: { rate: 0.6 },
  });
  assert.equal(r.manipulationRisk.verdict, 'MEDIUM');
  assert.ok(r.tags.includes('⚠️MANIP_MED'));
});

test('scoreSymbol — output includes SL/TP1/TP2 and R:R fields', () => {
  const r = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5, price: 100 }) });
  assert.ok(r);
  assert.equal(r.sl, 97, 'SL is entry - 3%');
  assert.equal(r.tp1, 105, 'TP1 is entry + 5%');
  /* Floating point: 110 may serialise as 110.00000001 depending on
     the multiplication path; allow a tiny epsilon. */
  assert.ok(Math.abs(r.tp2 - 110) < 0.01, 'TP2 is entry + 10%');
  assert.equal(r.rr, 1.67, 'R:R should be ~1.67');
});

test('scoreSymbol — tier label crosses the ULTRA threshold', () => {
  /* Stack enough positive signals to clear 100. */
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 1.2e9, change: 0.5, high: 100.5, low: 95 }),
    fr: { rate: -0.02 },
    ls: { ratio: 0.5 },
    taker: { ratio: 2, avg: 1 },
    coinalyzeFR: { rate: -0.02 },
    hyperliquid: { funding: -0.001 },
    bitfinex: { longPct: 75 },
  });
  assert.ok(r);
  assert.ok(r.score >= 100, 'expected ULTRA score, got ' + r.score);
  assert.equal(r.tier, 'ULTRA');
});

/* ─── runScannerPass ──────────────────────────────────────────────── */

test('runScannerPass — empty cache yields empty signals', () => {
  const out = runScannerPass({ tickers: {} });
  assert.deepEqual(out.signals, []);
  assert.deepEqual(out.top3, []);
  assert.ok(typeof out.ts === 'number');
});

test('runScannerPass — exposes the pass weight profile (observability)', () => {
  const out = runScannerPass({ tickers: {} });
  /* The field must always be present (consumed by the [REGIME] log and
     /api/all activeProfile). With no env flags set it resolves to null
     (legacy); the adaptive/V2 switches turn it into 'trend'/'v2'. */
  assert.ok('profile' in out);
  assert.ok(out.profile === null || typeof out.profile === 'string');
});

test('runScannerPass — stablecoins are filtered out', () => {
  const cache = {
    tickers: {
      USDT: tk({ volume: 5e7, change: 0.5 }),
      USDC: tk({ volume: 5e7, change: 0.5 }),
      BTC: tk({ volume: 5e7, change: 0.5 }),
    },
  };
  const out = runScannerPass(cache);
  assert.equal(out.signals.length, 1);
  assert.equal(out.signals[0].s, 'BTC');
});

test('runScannerPass — top3 is ranked by score, length capped at 3', () => {
  const cache = {
    tickers: {
      BTC: tk({ volume: 5e7, change: 0.5 }),
      ETH: tk({ volume: 1.2e9, change: 0.5 }) /* mega vol → highest score */,
      SOL: tk({ volume: 1e8, change: 0.5 }),
      BNB: tk({ volume: 5e7, change: 0.5 }),
      XRP: tk({ volume: 5e7, change: 0.5 }),
    },
  };
  const out = runScannerPass(cache);
  assert.equal(out.top3.length, 3);
  /* The mega-volume coin must lead the ranking. */
  assert.equal(out.top3[0].s, 'ETH');
  /* Ranking is descending. */
  for (let i = 1; i < out.top3.length; i++) {
    assert.ok(out.top3[i - 1].score >= out.top3[i].score);
  }
});

test('runScannerPass — drops symbols whose score floor is below the gate', () => {
  /* BTC at 6% gain is past the late-entry penalty cliff and should
     not appear in signals (score < 30 after penalties). */
  const cache = {
    tickers: {
      BTC: tk({ volume: 1e6, change: 6 }),
    },
  };
  const out = runScannerPass(cache);
  assert.equal(out.signals.length, 0);
});

test('runScannerPass — multi-exchange context flows through to scoring', () => {
  const cache = {
    tickers: { BTC: tk({ volume: 5e7, change: 0.5 }) },
    fr: { BTC: { rate: -0.02 } },
    dsMulti: {
      coinalyze: { fr: { BTC: { rate: -0.02 } } },
      hyperliquid: { BTC: { funding: -0.001 } },
      bitfinex: { BTC: { longPct: 75 } },
    },
  };
  const baseline = runScannerPass({ tickers: cache.tickers });
  const enriched = runScannerPass(cache);
  assert.ok(
    enriched.signals[0].score > baseline.signals[0].score,
    'enrichment should raise the score'
  );
});

/* ─── Phase 1.2 — Manipulation HIGH tier hard-cap ─────────────── */

/* Build a scenario where a non-tier1 coin scores high enough to
   reach ULTRA AND triggers a HIGH manipulation verdict. The
   stacked bonuses (whale A, MTF bullish, indicators, bitfinex)
   push the score over 100; the penny price + extreme funding +
   spoofed book imbalance push manipulation risk over 50. */
function ultraButManipHigh() {
  return scoreSymbol('SHADYCOIN', {
    ticker: { price: 0.005, change: 0.5, volume: 2e8, high: 0.005, low: 0.005 },
    fr: { rate: 0.6 } /* extreme funding → +20 manip risk + FR⚠️ -8 */,
    whaleWave: { engine: { rank: 'A' } } /* +20 */,
    mtfAgreement: { strength: 'full', agreement: 'bullish' } /* +15 */,
    indicator: { rsi: 25, macd: { cross: 'bull' } } /* +10 + +12 */,
    bitfinex: { longPct: 70 } /* +6 */,
    depth: {
      bids: [['1000', '1']] /* total 1000 */,
      asks: [['10', '0.01']] /* total 0.1 → ratio 10000:1 */,
    },
  });
}

test('Phase 1.2 — manipulation HIGH caps an ULTRA-scoring signal at STRONG', () => {
  const r = ultraButManipHigh();
  assert.ok(r, 'fixture should produce a signal');
  assert.equal(r.manipulationRisk.verdict, 'HIGH', 'fixture should trigger HIGH manipulation');
  assert.ok(r.score >= 100, 'pre-cap score should reach the ULTRA cutoff (got ' + r.score + ')');
  assert.equal(r.tier, 'STRONG', 'tier must be capped at STRONG, not ULTRA');
  assert.ok(r.tags.includes('🚫MANIP_CAP'), 'cap tag must be present so the UI can explain it');
});

test('Phase 1.2 — non-ULTRA score with HIGH manipulation does NOT add the cap tag', () => {
  /* Same penny / funding / book setup but without the score
     boosters. Manipulation is still HIGH, but the tier was already
     below ULTRA so the cap is irrelevant — and the tag must not
     fire (otherwise users would see it on every shady gray-zone
     symbol regardless of tier). */
  const r = scoreSymbol('SHADYCOIN', {
    ticker: { price: 0.005, change: 0.5, volume: 2e8, high: 0.005, low: 0.005 },
    fr: { rate: 0.6 },
    depth: {
      bids: [['1000', '1']],
      asks: [['10', '0.01']],
    },
  });
  assert.ok(r);
  assert.equal(r.manipulationRisk.verdict, 'HIGH');
  assert.notEqual(r.tier, 'ULTRA');
  assert.ok(
    !r.tags.includes('🚫MANIP_CAP'),
    'cap tag should not appear when tier was not ULTRA in the first place'
  );
});

test('Phase 1.2 — ULTRA-scoring signal with LOW manipulation stays ULTRA', () => {
  /* Tier-1 BTC with the same boosters but no manipulation flags →
     verifies the cap does not over-trigger on clean signals. */
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 2e9, change: 0.5 }),
    whaleWave: { engine: { rank: 'A' } },
    mtfAgreement: { strength: 'full', agreement: 'bullish' },
    indicator: { rsi: 25, macd: { cross: 'bull' } },
    coinalyzeFR: { rate: -0.02 },
    bitfinex: { longPct: 70 },
  });
  assert.ok(r);
  assert.notEqual(r.manipulationRisk.verdict, 'HIGH');
  assert.ok(r.score >= 100, 'BTC fixture should reach ULTRA (got ' + r.score + ')');
  assert.equal(r.tier, 'ULTRA');
  assert.ok(!r.tags.includes('🚫MANIP_CAP'));
});

test('Phase 1.2 — capped tier does NOT modify the raw score field', () => {
  /* Documented intent in scanner-engine.js: tier is downgraded, but
     `score` itself is preserved so /api/all consumers that sort by
     raw score keep the natural ordering. Locks the contract. */
  const r = ultraButManipHigh();
  assert.equal(r.tier, 'STRONG');
  assert.ok(r.score >= 100, 'score must remain at the pre-cap value (got ' + r.score + ')');
});

/* ─── Phase 1.1 — P&D detector wiring inside scoreSymbol ───────── */

/* The detector itself is exhaustively covered in
   tests/scanner-pd-detector.test.js (35 tests). These three tests
   cover the integration path only: does scoreSymbol invoke the
   detector with the right ctx fields, push the right tag, and
   apply the right score adjustment? */

test('Phase 1.1 — P&D 2-flag combo emits P&D_WARN tag and applies -25', () => {
  /* FR_EXTREME (fr.rate > 0.1) + LS_RETAIL_LONG (ls.ratio > 3) →
     2 flags → -25 soft penalty + warn tag. Use a low-score ticker
     so existing FR⚠️ (-8) doesn't drown the assertion. */
  const baseline = scoreSymbol('NEWCOIN', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    oi: 50_000_000,
  });
  const withPD = scoreSymbol('NEWCOIN', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    oi: 50_000_000,
    fr: { rate: 0.15 } /* FR_EXTREME + existing FR⚠️ -8 */,
    ls: { ratio: 3.5 } /* LS_RETAIL_LONG */,
  });
  assert.ok(baseline && withPD);
  assert.ok(withPD.tags.some((t) => t.startsWith('⚠️P&D_WARN')));
  assert.ok(!withPD.tags.some((t) => t.startsWith('🚨P&D_RISK')));
  /* Score delta: -8 (FR⚠️) + -25 (P&D 2-flag) = -33 vs. baseline. */
  assert.ok(
    baseline.score - withPD.score >= 30,
    'P&D 2-flag penalty + FR⚠️ should drop score by >= 30 (got ' +
      (baseline.score - withPD.score) +
      ')'
  );
});

test('Phase 1.1 — P&D detector with only one flag emits no P&D tag', () => {
  const r = scoreSymbol('NEWCOIN', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    oi: 50_000_000,
    fr: { rate: 0.15 } /* FR_EXTREME only — 1 flag */,
  });
  assert.ok(r);
  assert.ok(!r.tags.some((t) => t.startsWith('⚠️P&D_WARN')));
  assert.ok(!r.tags.some((t) => t.startsWith('🚨P&D_RISK')));
});

test('Phase 1.1 — P&D 3+ flags emit P&D_RISK tag and floor score', () => {
  /* Reach 3 flags via FR_EXTREME + LS_RETAIL_LONG + SMART_VS_RETAIL.
     SMART_VS_RETAIL requires both globalLs.ratio > 2 (retail) AND
     topTraders.positions[-1].long < 0.4 (smart short). The wiring at
     scanner-engine.js passes both ctx.globalLs and ctx.topTraders to
     the detector, so populating both here triggers the third flag.
     Result: 3 flags → KILL → score floored at -100 → quality
     gate at runScannerPass drops the symbol. */
  const r = scoreSymbol('NEWCOIN', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    oi: 50_000_000,
    fr: { rate: 0.15 } /* FR_EXTREME */,
    globalLs: { ratio: 3.5 } /* LS_RETAIL_LONG + > 2 for SMART_VS_RETAIL retail */,
    topTraders: { positions: [{ long: 0.3 }] } /* < 0.4 → SMART_VS_RETAIL smart */,
  });
  assert.ok(r);
  assert.ok(r.tags.some((t) => t.startsWith('🚨P&D_RISK')));
  assert.ok(r.score <= -100, 'KILL should floor score at -100 or lower (got ' + r.score + ')');
});

/* ─── Phase 3.2 — Gate-rejection telemetry ────────────────────── */

test('Phase 3.2 — runScannerPass returns a rejections breakdown', () => {
  /* Verify the shape exists with all expected categories. */
  const cache = {
    tickers: {
      BTC: tk({ volume: 5e7, change: 0.5 }),
    },
  };
  const out = runScannerPass(cache);
  assert.ok(out.rejections);
  assert.equal(typeof out.rejections.total, 'number');
  assert.equal(typeof out.rejections.stablecoin, 'number');
  assert.equal(typeof out.rejections.noPrice, 'number');
  assert.equal(typeof out.rejections.overheated, 'number');
  assert.equal(typeof out.rejections.lowVolume, 'number');
  assert.equal(typeof out.rejections.washTrade, 'number');
  assert.equal(typeof out.rejections.lowScore, 'number');
});

test('Phase 3.2 — stablecoin rejection is counted', () => {
  const cache = {
    tickers: {
      USDT: tk({ volume: 1e9 }),
      USDC: tk({ volume: 1e9 }),
      BTC: tk({ volume: 5e7, change: 0.5 }),
    },
  };
  const out = runScannerPass(cache);
  assert.equal(out.rejections.total, 3);
  assert.equal(out.rejections.stablecoin, 2);
});

test('Phase 3.2 — overheated rejection is counted', () => {
  const cache = {
    tickers: {
      BTC: tk({ volume: 5e7, change: 12 }) /* >= 8 → overheated */,
      ETH: tk({ volume: 5e7, change: 0.5 }) /* accepted */,
    },
  };
  const out = runScannerPass(cache);
  assert.equal(out.rejections.overheated, 1);
});

test('Phase 3.2 — lowVolume rejection is counted', () => {
  const cache = {
    tickers: {
      BTC: tk({ volume: 500_000, change: 0.5 }) /* tier1 minVol = 1M */,
      ETH: tk({ volume: 5e7, change: 0.5 }) /* accepted */,
    },
  };
  const out = runScannerPass(cache);
  assert.equal(out.rejections.lowVolume, 1);
});

test('Phase 3.2 — washTrade rejection is counted', () => {
  const cache = {
    tickers: {
      CHIP: tk({ volume: 1.2e9, change: -3, price: 0.06 }) /* wash pattern */,
    },
    oi: { CHIP: 0 },
  };
  const out = runScannerPass(cache);
  assert.equal(out.rejections.washTrade, 1);
});

test('Phase 3.2 — lowScore rejection is counted (below 30 gate)', () => {
  /* Non-tier1 symbol with no boosters: NEW tag is +2, volume is below
     all VOL tiers, change is flat so no momentum bonuses. Score should
     land at +2 — well below the 30 gate — and reliably hit lowScore.
     Assertions are unconditional so any future scoring change that
     bumps OBSCURECOIN over 30 fails the test loudly. */
  const cache = {
    tickers: {
      OBSCURECOIN: tk({ volume: 6e6, change: 0.5 }) /* sparse signal */,
    },
    oi: { OBSCURECOIN: 5_000_000 } /* enough OI to dodge wash reject */,
  };
  const out = runScannerPass(cache);
  assert.equal(out.signals.length, 0, 'fixture must score below the 30 gate');
  assert.equal(out.rejections.lowScore, 1, 'rejection must be categorized as lowScore');
});

test('Phase 3.2 — accepted signals do NOT count as rejections', () => {
  const cache = {
    tickers: {
      BTC: tk({ volume: 5e7, change: 0.5 }),
      ETH: tk({ volume: 5e7, change: 0.5 }),
    },
  };
  const out = runScannerPass(cache);
  const totalRejected =
    out.rejections.stablecoin +
    out.rejections.noPrice +
    out.rejections.overheated +
    out.rejections.lowVolume +
    out.rejections.washTrade +
    out.rejections.lowScore;
  assert.equal(out.signals.length + totalRejected, out.rejections.total);
});

/* ─── Phase 2.A.4 — ATR-aware SL/TP wiring ─────────────────────── */

test('Phase 2.A.4 — ATR present → ATR_ZONES tag + non-fixed sl/tp (tier-1 path)', () => {
  /* BTC is in TIER1_SYMBOLS so Phase 2.A.4.b tier-aware multipliers
     apply (stop=1.2, tp1=1.8, tp2=3.0). At price 50,000 / ATR 750:
       stop = 50000 - 1.2 * 750 = 49,100
       tp1  = 50000 + 1.8 * 750 = 51,350
       tp2  = 50000 + 3.0 * 750 = 52,250
       R:R  = 1.50
     Compare with the legacy fixed ladder (48,500 / 52,500 / 55,000).
     The TP1 is meaningfully tighter than fixed (+2.7% vs +5%) — the
     whole point of the tier-aware change. */
  const r = scoreSymbol('BTC', {
    ticker: { price: 50000, change: 0.5, volume: 5e7, high: 50500, low: 49500 },
    indicator: { atr: 750 },
  });
  assert.ok(r);
  assert.ok(r.tags.includes('📐ATR_ZONES'), 'must tag the override');
  assert.ok(
    r.tags.includes('📐ATR_T1'),
    'tier-1 symbol with tier-aware flag ON must carry the observability tag'
  );
  assert.equal(r.sl, 49100);
  assert.equal(r.tp1, 51350);
  assert.equal(r.tp2, 52250);
  assert.equal(r.rr, 1.5, 'tier-1 1.2/1.8 mults give R:R = 1.5');
});

test('Phase 2.A.4.b — BTC screenshot fixture ($77,160 / ATR $1,680) → tier-1 bounds', () => {
  /* The exact case Ziko flagged on 2026-05-20: entry $77,160 with
     ATR(14) ~$1,680 was showing TP1 +6.5% over a stated 1-4h window.
     Tier-1 multipliers compress this to:
       stop = 77160 - 1.2 * 1680 = 75,144  (-2.61%)
       tp1  = 77160 + 1.8 * 1680 = 80,184  (+3.92%)
       tp2  = 77160 + 3.0 * 1680 = 82,200  (+6.53%)
     Locks the numbers so any future drift gets caught here. */
  const r = scoreSymbol('BTC', {
    ticker: { price: 77160, change: 0.5, volume: 5e7, high: 77800, low: 76500 },
    indicator: { atr: 1680 },
  });
  assert.ok(r);
  assert.ok(r.tags.includes('📐ATR_ZONES'));
  assert.equal(r.sl, 75144);
  assert.equal(r.tp1, 80184);
  assert.equal(r.tp2, 82200);
  assert.equal(r.rr, 1.5);
});

test('Phase 2.A.4 — no ATR → falls back to fixed -3% / +5% / +10%', () => {
  /* Same fixture without indicator.atr — must use the legacy ladder. */
  const r = scoreSymbol('BTC', {
    ticker: { price: 50000, change: 0.5, volume: 5e7, high: 50500, low: 49500 },
    /* no indicator → no atr */
  });
  assert.ok(r);
  assert.ok(!r.tags.includes('📐ATR_ZONES'), 'must NOT tag when fallback fires');
  assert.equal(r.sl, +(50000 * 0.97).toFixed(8));
  assert.equal(r.tp1, +(50000 * 1.05).toFixed(8));
  assert.equal(r.tp2, +(50000 * 1.1).toFixed(8));
});

test('Phase 2.A.4 — ATR <= 0 falls back to fixed ladder', () => {
  /* indicator-engine returns 0 when there are not enough klines.
     scoreSymbol must treat this as "no ATR available". */
  const r = scoreSymbol('BTC', {
    ticker: { price: 50000, change: 0.5, volume: 5e7, high: 50500, low: 49500 },
    indicator: { atr: 0 },
  });
  assert.ok(r);
  assert.ok(!r.tags.includes('📐ATR_ZONES'));
  assert.equal(r.sl, 48500); /* 50000 * 0.97 */
});

test('Phase 2.A.4 — high-volatility altcoin (non-tier-1) gets wider stop than fixed', () => {
  /* SHIB-shaped: price 0.00002, ATR 0.0000008 (4% of price). SHIB
     is NOT in TIER1_SYMBOLS so the non-tier-1 DEFAULT_MULTS apply
     (stop=1.5, tp1=3.0, tp2=5.0).
       stop = 0.00002 - 1.5 * 0.0000008 = 0.0000188 (-6%)
       fixed-3% would be 0.0000194 — knocked out by normal noise.
     The wider non-tier-1 stop is the whole point. */
  const r = scoreSymbol('SHIB', {
    ticker: { price: 0.00002, change: 0.5, volume: 5e7, high: 0.000021, low: 0.0000195 },
    indicator: { atr: 0.0000008 },
  });
  assert.ok(r);
  assert.ok(r.tags.includes('📐ATR_ZONES'));
  assert.ok(Math.abs(r.sl - 0.0000188) < 1e-12);
  /* Wider than the legacy -3% stop — explicitly. */
  assert.ok(
    r.sl < 0.00002 * 0.97,
    'ATR stop must be lower than legacy -3% for high-vol non-tier-1 coins'
  );
});

test('Phase 2.A.4.b — non-tier-1 symbol keeps DEFAULT_MULTS (regression guard)', () => {
  /* If a future change accidentally promotes everything to tier-1
     multipliers, this test fails. SHIB at 0.00002, ATR 0.0000008:
       tp1 (non-tier-1) = 0.00002 + 3.0 * 0.0000008 = 0.0000224 (+12%)
       tp1 (tier-1)     = 0.00002 + 1.8 * 0.0000008 = 0.0000214 (+7.2%)
     Assert the wider non-tier-1 TP1. */
  const r = scoreSymbol('SHIB', {
    ticker: { price: 0.00002, change: 0.5, volume: 5e7, high: 0.000021, low: 0.0000195 },
    indicator: { atr: 0.0000008 },
  });
  assert.ok(r);
  assert.ok(Math.abs(r.tp1 - 0.0000224) < 1e-12, 'non-tier-1 must use 3.0× ATR for TP1');
  assert.equal(r.rr, 2, 'non-tier-1 R:R = 2.0');
  /* Observability invariant: non-tier-1 must NOT carry the ATR_T1
     tag — pairs with the SHIB tier-aware test above to lock that
     the tag only fires for tier-1 symbols. */
  assert.ok(
    !r.tags.includes('📐ATR_T1'),
    'non-tier-1 symbol must NOT carry the ATR_T1 observability tag'
  );
});

/* ─── regimeTierBump — downtrend risk-off (regime policy matrix §4) ──── */

test('regimeTierBump — bear and volatile each tighten (and stack), only when enabled', () => {
  /* Disabled (SCANNER_REGIME_ADAPTIVE off) → never bumps, whatever the regime.
     This is the default, so tiering stays byte-for-byte the legacy behaviour. */
  assert.equal(regimeTierBump('bear', 'high', false), 0);
  assert.equal(regimeTierBump('bull', 'normal', false), 0);
  /* Enabled — a downtrend raises the bar (risk-off). */
  assert.equal(regimeTierBump('bear', 'normal', true), BEAR_TIER_BUMP);
  /* A volatile tape raises it too, in ANY direction (design §4). */
  assert.equal(regimeTierBump('bull', 'high', true), VOLATILE_TIER_BUMP);
  assert.equal(regimeTierBump('ranging', 'high', true), VOLATILE_TIER_BUMP);
  /* The two STACK — a volatile downtrend tightens hardest. */
  assert.equal(regimeTierBump('bear', 'high', true), BEAR_TIER_BUMP + VOLATILE_TIER_BUMP);
  /* A calm, non-bear tape stays at the normal cutoffs. */
  assert.equal(regimeTierBump('bull', 'normal', true), 0);
  assert.equal(regimeTierBump('ranging', 'normal', true), 0);
  assert.equal(regimeTierBump('none', 'normal', true), 0);
  assert.equal(regimeTierBump('unknown', undefined, true), 0);
  /* Both bumps RAISE the bar (positive) — fewer signals, never more. */
  assert.ok(BEAR_TIER_BUMP > 0 && VOLATILE_TIER_BUMP > 0);
});
