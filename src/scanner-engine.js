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
  /* Established stablecoins */
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
  /* 2024-2026 generation — Ripple USD, World Liberty USD1, Ethena USDe,
     Mountain USDM, Frax, Aave GHO, Curve crvUSD, Tron USDD, MIM, Terra
     Classic USTC, Sky (formerly DAI) USDS. The live audit on 2026-05-13
     found USD1 and RLUSD leaking into Top 10 because they weren't in
     this list — their funding hovers at 0 and volume bleeds into the
     "biggest market" rankings. */
  'USD1',
  'RLUSD',
  'USDE',
  'USDM',
  'FRAX',
  'GHO',
  'CRVUSD',
  'USDD',
  'MIM',
  'USTC',
  'USDS',
]);

/* Wash-trading guard. CHIP appeared on the 2026-05-13 audit with
   $1.18B spot volume but $0 open interest — a textbook fingerprint
   of bots wash-trading the spot book while no professional trades
   the perp. We reject any symbol whose spot volume crosses this
   floor without a matching futures market. */
const WASH_VOLUME_FLOOR = 500_000_000;
const WASH_OI_FLOOR = 100_000;

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

  /* Wash-trading reject. Huge spot volume with no perpetual interest
     is bot wash trading — the May 2026 audit caught CHIP this way
     ($1.18B spot, $0 perp OI). The OI fetcher already covers the
     top 50 symbols by volume every cycle, so for any non-tier-1
     symbol pulling more than $500M in spot the absence of an OI
     entry means Binance refused to list it on futures, which is
     itself a credibility signal we want to act on. We exempt the
     hardcoded TIER1 majors so a transient OI-fetch failure for BTC
     can't ever cost us its signal. */
  const oiUsd = typeof ctx.oi === 'number' ? ctx.oi : 0;
  if (!isTier1 && d.volume > WASH_VOLUME_FLOOR && oiUsd < WASH_OI_FLOOR) {
    return null;
  }

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

  /* Whale wave confirmation — when the whale engine has already
     flagged this symbol as Tier A/B/C accumulation (or D
     distribution), feed that signal into the scanner score so the
     two engines reinforce each other. Tier A = $1M+ buys with 70%+
     buy ratio in the last hour, which is institutional behavior we
     want surfaced loudly. Tier D = heavy distribution, a bearish
     signal worth penalising. */
  if (ctx.whaleWave && ctx.whaleWave.engine) {
    const wRank = ctx.whaleWave.engine.rank;
    if (wRank === 'A') {
      score += 20;
      tags.push('🐋WHALE_A');
    } else if (wRank === 'B') {
      score += 10;
      tags.push('🐋WHALE_B');
    } else if (wRank === 'C') {
      score += 5;
      tags.push('🐋WHALE_C');
    } else if (wRank === 'D') {
      score -= 10;
      tags.push('🐋DUMPED');
    }
  }

  /* Multi-timeframe agreement. When 15m / 1h / 4h indicators all
     point the same way, the trade has both intraday momentum and
     swing-trend backing — the highest-conviction setup. Only the 10
     INDICATOR_SYMBOLS get this in practice (others have no MTF
     fetch budget), which is exactly where we want strongest
     confirmation. Bullish full agreement (+15) is louder than a
     bearish one (-10) because the scanner is biased toward long
     setups — the ULTRA push fires on score ≥ 100, never on a
     short signal. */
  if (ctx.mtfAgreement) {
    const a = ctx.mtfAgreement;
    if (a.strength === 'full' && a.agreement === 'bullish') {
      score += 15;
      tags.push('🎯MTF_BULL');
    } else if (a.strength === 'partial' && a.agreement === 'bullish') {
      score += 8;
      tags.push('🎯MTF_BULL_2');
    } else if (a.strength === 'full' && a.agreement === 'bearish') {
      score -= 10;
      tags.push('🎯MTF_BEAR');
    } else if (a.strength === 'partial' && a.agreement === 'bearish') {
      score -= 5;
      tags.push('🎯MTF_BEAR_2');
    }
  }

  /* Technical indicator confirmation. The indicator engine already
     computes RSI / MACD on 15m klines for the 10 majors every 60s,
     but the scanner had been ignoring them until now. Reading the
     same numbers feeds intraday momentum into the score so a BTC
     setup with RSI 28 and a fresh MACD bull cross outranks a flat
     one. Same nine-stack pattern as the existing tags: a bonus +
     a tag the UI can render. */
  if (ctx.indicator) {
    const ind = ctx.indicator;
    /* RSI oversold = bounce setup. Overbought = late entry trap. */
    if (typeof ind.rsi === 'number') {
      if (ind.rsi < 30) {
        score += 10;
        tags.push('📉RSI_OS');
      } else if (ind.rsi > 70) {
        score -= 8;
        tags.push('📈RSI_OB');
      }
    }
    /* MACD cross is the strongest single momentum signal we have on
       any individual indicator. A fresh bull / bear cross moves the
       histogram across the signal line — bigger weight than just
       "histogram on the bull side", which we also reward but
       lightly. */
    if (ind.macd && ind.macd.cross === 'bull') {
      score += 12;
      tags.push('📊MACD_BULL');
    } else if (ind.macd && ind.macd.cross === 'bear') {
      score -= 8;
      tags.push('📊MACD_BEAR');
    } else if (ind.macd && typeof ind.macd.h === 'number' && typeof ind.macd.signal === 'number') {
      if (ind.macd.h > ind.macd.signal) {
        score += 3;
      } else if (ind.macd.h < ind.macd.signal) {
        score -= 3;
      }
    }
  }

  /* News sentiment. cache.newsSentiment is a market-wide count of
     positive / negative / neutral headlines from CoinTelegraph's
     RSS. It's not per-symbol so it acts as a tide that lifts (or
     drops) every signal a little — bullish news flow biases the
     scanner toward keeping marginal setups; bearish flow trims
     them. The 20-headline floor keeps the bonus from firing on a
     thin news cycle, and the 2x ratio rules out indecisive feeds. */
  if (ctx.newsSentiment) {
    const ns = ctx.newsSentiment;
    const total = ns.total || 0;
    const pos = ns.positive || 0;
    const neg = ns.negative || 0;
    if (total >= 20) {
      if (pos >= neg * 2 && pos >= 5) {
        score += 5;
        tags.push('📰BULL_NEWS');
      } else if (neg >= pos * 2 && neg >= 5) {
        score -= 5;
        tags.push('📰BEAR_NEWS');
      }
    }
  }

  /* Risk/Reward levels. Computing them server-side means the PWA
     can render entry/SL/TP cards without re-deriving the maths on
     every device, and downstream consumers (Paper Trading, push
     payload) get a consistent reference. The percentages are kept
     intentionally conservative so the R:R holds across volatility
     regimes — tighter targets earn more often than wide ones. */
  const sl = +(d.price * 0.97).toFixed(8);
  const tp1 = +(d.price * 1.05).toFixed(8);
  const tp2 = +(d.price * 1.1).toFixed(8);
  /* Reward (TP1 minus entry) / Risk (entry minus SL) ≈ 1.67 — the
     same number for every signal because the percentages are fixed.
     Exposed anyway so the UI can show "R:R 1.67" without
     recomputing. */
  const rr = 5 / 3;

  return {
    s: sym,
    score: Math.round(score * 10) / 10,
    tags: tags,
    tier: _tierFromScore(score),
    direction: _directionLabel(score, d.change),
    price: d.price,
    change: d.change,
    volume: d.volume,
    sl: sl,
    tp1: tp1,
    tp2: tp2,
    rr: Math.round(rr * 100) / 100,
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
  const whaleWaves = cache.whaleWaves || {};
  const indicatorsMtf = cache.indicatorsMtf || {};
  const indicators = cache.indicators || {};
  /* News sentiment is market-wide — same object for every symbol
     this pass, so we resolve it once outside the loop. */
  const newsSentiment = cache.newsSentiment || null;
  const results = [];
  for (const sym in tickers) {
    if (STABLE_SET.has(sym)) continue;
    const mtfEntry = indicatorsMtf[sym];
    const r = scoreSymbol(sym, {
      ticker: tickers[sym],
      fr: cache.fr ? cache.fr[sym] : null,
      ls: cache.ls ? cache.ls[sym] : null,
      taker: cache.taker ? cache.taker[sym] : null,
      depth: cache.depth ? cache.depth[sym] : null,
      oi: cache.oi ? cache.oi[sym] : null,
      coinalyzeOI: czOI[sym] || null,
      coinalyzeFR: czFR[sym] || null,
      hyperliquid: hl[sym] || null,
      bitfinex: bfx[sym] || null,
      whaleWave: whaleWaves[sym] || null,
      mtfAgreement: mtfEntry ? mtfEntry.agreement : null,
      indicator: indicators[sym] || null,
      newsSentiment: newsSentiment,
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
  WASH_VOLUME_FLOOR,
  WASH_OI_FLOOR,
  scoreSymbol,
  runScannerPass,
};
