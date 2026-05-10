/* NEXUS PRO — server-side scanner engine.

   Mirrors the client-side quickScan() logic from app.js but runs in
   the proxy's process every 30 s, against the cache.* objects the
   data-refresh loops keep warm. The output (cache.signals + Top 3)
   is exposed via /api/all so the PWA reads precomputed verdicts
   instead of recomputing them on every device, and so push triggers
   can fire on ULTRA signals + Top-3 changes without the user's
   browser needing to be open.

   Scope: this is the lightweight subset of quickScan that depends
   only on data the proxy already has — tickers, fr, oi, ls, taker,
   depth, plus the multi-exchange enrichment (coinalyze, hyperliquid,
   bitfinex). The client still runs its full scan with VPIN,
   iceberg, absorption, and other browser-only signals; the
   server's view is the "always-on" floor that survives an offline
   PWA. */

'use strict';

const STABLE_SET = new Set([
  'USDT',
  'USDC',
  'TUSD',
  'DAI',
  'BUSD',
  'FDUSD',
  'USDP',
  'PYUSD',
  'USD',
  'UST',
]);

/* Tier 1 — the same WL constant the PWA seeds at boot. Keeping it
   in sync with src/constants.js's WL is important: tiering changes
   the volume floor and the score tag. */
const TIER1_SYMBOLS = new Set([
  'BTC',
  'ETH',
  'SOL',
  'BNB',
  'XRP',
  'ADA',
  'DOGE',
  'LINK',
  'AVAX',
  'DOT',
  'MATIC',
  'UNI',
  'ATOM',
  'LTC',
  'NEAR',
  'APT',
  'ARB',
  'OP',
  'INJ',
  'SUI',
  'SEI',
  'TIA',
  'FTM',
  'PEPE',
  'WIF',
  'FIL',
  'HBAR',
  'ICP',
  'IMX',
  'STX',
  'MKR',
  'AAVE',
  'RENDER',
  'GRT',
  'FET',
  'TAO',
  'THETA',
  'LDO',
  'BONK',
  'FLOKI',
  'AR',
  'ALGO',
  'FLOW',
  'MINA',
  'AXS',
  'SAND',
  'MANA',
  'GALA',
  'ENJ',
  'CRV',
  'TRX',
  'TON',
  'VET',
  'RUNE',
  'KAS',
  'EOS',
  'XLM',
]);

/* Score → human-readable tier the PWA renders. The ULTRA cutoff
   is what the push trigger watches — match the client's threshold
   in app.js so the two views agree on what counts as "ULTRA". */
function _tierFromScore(score) {
  if (score >= 100) return 'ULTRA';
  if (score >= 70) return 'STRONG';
  if (score >= 50) return 'MEDIUM';
  return 'WEAK';
}

function _directionLabel(score, change) {
  if (score >= 70) return 'STRONG_BUY';
  if (score >= 50) return 'BUY';
  if (score >= 30) return 'WATCH';
  if (change <= -3) return 'WEAK';
  return 'NEUTRAL';
}

/* Compute a per-symbol scan result. Pure function — feed it the
   slice of cache.* it cares about and you get back { score, tags,
   tier, direction } so the caller decides whether to keep / push /
   surface it. */
function scoreSymbol(sym, ctx) {
  const d = ctx.ticker;
  if (!d || !d.price || d.price <= 0) return null;
  if (d.change >= 8) return null;

  const isTier1 = TIER1_SYMBOLS.has(sym);
  const minVol = isTier1 ? 1_000_000 : 5_000_000;
  if (d.volume < minVol) return null;

  let score = 0;
  const tags = [];

  /* Tier bonus */
  if (isTier1) {
    score += 10;
    tags.push('🏆TOP100');
  } else {
    score += 2;
    tags.push('🔍NEW');
  }

  /* Silent accumulation — high volume, flat price */
  if (d.volume > 5e7 && Math.abs(d.change) < 2) {
    score += 25;
    tags.push('🐋ACC');
  }
  if (d.volume > 3e7 && d.change >= 0.3 && d.change < 2) {
    score += 20;
    tags.push('🔍EARLY');
  }
  if (d.volume > 8e7 && d.change >= 0.5 && d.change < 3) {
    score += 15;
    tags.push('🔍STEALTH');
  }

  /* Already running */
  if (d.change >= 3 && d.change < 5) {
    score += 8;
    tags.push('📈RISING');
  }
  if (d.change >= 5 && d.change < 8) {
    score -= 5;
    tags.push('⚠️LATE');
  }
  if (d.change > 3) score -= 15;
  if (d.change > 5) score -= 30;

  /* Volume tiers */
  if (d.volume > 1e9) {
    score += 25;
    tags.push('🔥MEGA_VOL');
  } else if (d.volume > 1e8) {
    score += 18;
    tags.push('📊HIGH_VOL');
  } else if (d.volume > 3e7) {
    score += 10;
    tags.push('📊VOL');
  }

  /* Near daily high — breakout imminent */
  if (
    d.high > 0 &&
    d.price > 0 &&
    ((d.high - d.price) / d.price) * 100 < 1.5 &&
    d.change > 0 &&
    d.change < 3
  ) {
    score += 12;
    tags.push('🎯AT_HIGH');
  }

  /* Bottom buying */
  if (
    d.high &&
    d.low &&
    d.high !== d.low &&
    ((d.price - d.low) / (d.high - d.low)) * 100 < 25 &&
    d.volume > 5e6
  ) {
    score += 10;
    tags.push('📉BOTTOM');
  }

  /* Funding rate */
  if (ctx.fr) {
    if (ctx.fr.rate < -0.01) {
      score += 12;
      tags.push('FR⬇️');
    } else if (ctx.fr.rate < 0) {
      score += 5;
      tags.push('FR-');
    } else if (ctx.fr.rate > 0.08) {
      score -= 8;
      tags.push('FR⚠️');
    }
  }

  /* Long/Short ratio — heavy shorts mean a squeeze setup */
  if (ctx.ls && ctx.ls.ratio < 0.8) {
    score += 10;
    tags.push('🩳SHORTS');
  }

  /* Taker buy/sell skew */
  if (ctx.taker && ctx.taker.avg > 0 && ctx.taker.ratio > ctx.taker.avg * 1.3) {
    score += 15;
    tags.push('💹TAKER');
  }

  /* Order book depth — bid wall */
  if (ctx.depth && ctx.depth.bids && ctx.depth.asks) {
    let bTotal = 0;
    let aTotal = 0;
    for (let i = 0; i < ctx.depth.bids.length; i++) {
      bTotal += parseFloat(ctx.depth.bids[i][0]) * parseFloat(ctx.depth.bids[i][1]);
    }
    for (let i = 0; i < ctx.depth.asks.length; i++) {
      aTotal += parseFloat(ctx.depth.asks[i][0]) * parseFloat(ctx.depth.asks[i][1]);
    }
    const obi = aTotal > 0 ? bTotal / aTotal : 0;
    if (obi > 1.8) {
      score += 8;
      tags.push('📗BID:' + obi.toFixed(1) + 'x');
    }
  }

  /* OI building (multi-exchange aggregated) */
  if (ctx.coinalyzeOI && ctx.coinalyzeOI.value > 0 && Math.abs(d.change) < 3) {
    score += 6;
    tags.push('🌐OI');
  }

  /* Multi-exchange FR negative */
  if (ctx.coinalyzeFR && ctx.coinalyzeFR.rate < -0.01) {
    score += 8;
    tags.push('🌐FR_NEG');
  }

  /* Hyperliquid funding < 0 (DEX confirmation) */
  if (ctx.hyperliquid && ctx.hyperliquid.funding < 0) {
    score += 6;
    tags.push('🔬HL_NEG');
  }

  /* Bitfinex margin long-heavy (institutional sentiment) */
  if (ctx.bitfinex && ctx.bitfinex.longPct > 65) {
    score += 6;
    tags.push('📊BFX_LONG');
  }

  /* Reversal: deep red on huge volume */
  if (d.change <= -3 && d.change >= -10 && d.volume > 5e7) {
    score += 12;
    tags.push('🔄REVERSAL');
  }

  return {
    s: sym,
    score: Math.round(score * 10) / 10,
    tags: tags,
    tier: _tierFromScore(score),
    direction: _directionLabel(score, d.change),
    price: d.price,
    change: d.change,
    volume: d.volume,
    ts: Date.now(),
  };
}

/* Run a full pass against the cache snapshot supplied by the
   caller. Returns { signals, top3 } — caller decides what to do
   with the results (push triggers, snapshot exposure, …). */
function runScannerPass(cache) {
  const tickers = cache.tickers || {};
  const dsMulti = cache.dsMulti || {};
  const cz = dsMulti.coinalyze || {};
  const czOI = cz.oi || {};
  const czFR = cz.fr || {};
  const hl = dsMulti.hyperliquid || cache.hyperliquid || {};
  const bfx = dsMulti.bitfinex || cache.bitfinex || {};
  const results = [];
  for (const sym in tickers) {
    if (STABLE_SET.has(sym)) continue;
    const r = scoreSymbol(sym, {
      ticker: tickers[sym],
      fr: cache.fr ? cache.fr[sym] : null,
      ls: cache.ls ? cache.ls[sym] : null,
      taker: cache.taker ? cache.taker[sym] : null,
      depth: cache.depth ? cache.depth[sym] : null,
      coinalyzeOI: czOI[sym] || null,
      coinalyzeFR: czFR[sym] || null,
      hyperliquid: hl[sym] || null,
      bitfinex: bfx[sym] || null,
    });
    if (!r || r.score < 30) continue;
    results.push(r);
  }
  results.sort((a, b) => b.score - a.score);
  return {
    signals: results,
    top3: results.slice(0, 3),
    ts: Date.now(),
  };
}

module.exports = {
  STABLE_SET,
  TIER1_SYMBOLS,
  scoreSymbol,
  runScannerPass,
};
