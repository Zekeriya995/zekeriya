/* NEXUS PRO — server-side indicator engine.

   Computes RSI / MACD / EMA / ATR plus a "market direction" verdict
   per symbol from Binance klines, on the proxy, every 60 s. The
   client used to do this in the browser via calcRSI / calcMACD /
   calcEMA / calcATR in src/utils.js, which meant the indicator card
   was empty whenever the PWA wasn't open. This module is the
   server-side mirror of those same formulas (Wilder RMA for RSI,
   12/26/9 MACD with strict cross detection, SMA-seeded EMA, Wilder
   ATR) so /api/all can serve precomputed indicators that survive
   tab close and Top-3 / direction push triggers can fire while the
   user is sleeping.

   Pure functions only — pass them an array of close prices (and
   raw klines for ATR) and you get back a compact object. The
   server.js caller is responsible for fetching the klines and
   stashing the result on cache.indicators / cache.directions. */

'use strict';

/* Canonical EMA series — one value per input bar once the seed
   window fills (SMA of first `period` values per TradingView).
   Entries before the seed are null so the index stays aligned with
   the input prices. */
function emaSeries(data, period) {
  if (!data || data.length < period) return [];
  const out = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  out[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let j = period; j < data.length; j++) {
    out[j] = (data[j] - out[j - 1]) * k + out[j - 1];
  }
  return out;
}

function calcEMA(data, period) {
  if (!data || data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += data[i];
  ema /= period;
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * k + ema;
  }
  return ema;
}

/* RSI with Wilder smoothing (RMA, alpha = 1/period). Matches
   TradingView / Binance display. Flat series → 50, no losses → 100. */
function calcRSI(closes, period) {
  period = period || 14;
  if (!closes || closes.length < period + 1) return 50;
  let avgG = 0;
  let avgL = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgG += d;
    else avgL -= d;
  }
  avgG /= period;
  avgL /= period;
  for (let j = period + 1; j < closes.length; j++) {
    const d = closes[j] - closes[j - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgG === 0 && avgL === 0) return 50;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

/* MACD 12/26/9 — { h, signal, cross }. Strict cross detection
   (prev strictly on the wrong side, not equality) so a flat-signal
   touch doesn't fire a phantom bull. */
function calcMACD(closes) {
  if (!closes || closes.length < 26) return { h: 0, signal: 0, cross: 'none' };
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const macd = [];
  for (let i = 0; i < closes.length; i++) {
    macd.push(e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null);
  }
  const dense = macd.filter((x) => x != null);
  const curMacd = dense.length ? dense[dense.length - 1] : 0;
  if (dense.length < 10) return { h: curMacd, signal: curMacd, cross: 'none' };
  const sig = emaSeries(dense, 9);
  const curSig = sig[sig.length - 1];
  const prevSig = sig[sig.length - 2];
  const prevMacd = dense[dense.length - 2];
  let cross = 'none';
  if (curSig != null && prevSig != null) {
    if (curMacd > curSig && prevMacd < prevSig) cross = 'bull';
    else if (curMacd < curSig && prevMacd > prevSig) cross = 'bear';
  }
  return { h: curMacd, signal: curSig, cross };
}

/* Average True Range (Wilder, default 14) over Binance kline bars
   in the canonical [openTime, open, high, low, close, volume, ...]
   shape. Needs at least period + 1 bars (one prior close for the
   first TR). Returns null when starved. */
function calcATR(klines, period) {
  period = period || 14;
  if (!klines || klines.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const h = +klines[i][2];
    const l = +klines[i][3];
    const pc = +klines[i - 1][4];
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  /* Seed with SMA of the first `period` TRs, then Wilder RMA. */
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i];
  atr /= period;
  for (let j = period; j < trs.length; j++) {
    atr = (atr * (period - 1) + trs[j]) / period;
  }
  return atr;
}

/* Direction verdict — bullish / neutral / bearish ladder built from
   the four indicators above. Same logic the PWA's BTC card uses to
   render "شراء قوي" / "شراء خفيف" / "محايد" / "بيع". Score buckets
   are deliberately wide so a single oscillating indicator doesn't
   flip the label every other tick. */
function classifyDirection(ind) {
  if (!ind) return { label: 'NEUTRAL', ar: 'محايد', score: 0 };
  let score = 0;

  /* RSI: above 60 leans bullish, below 40 bearish; 70+ overbought
     and 30- oversold are extreme readings worth an extra point. */
  if (ind.rsi >= 70) score += 2;
  else if (ind.rsi >= 60) score += 1;
  else if (ind.rsi <= 30) score -= 2;
  else if (ind.rsi <= 40) score -= 1;

  /* MACD cross is the strongest single signal — any fresh cross
     swings the verdict by two points. */
  if (ind.macd && ind.macd.cross === 'bull') score += 2;
  else if (ind.macd && ind.macd.cross === 'bear') score -= 2;
  else if (ind.macd && ind.macd.h > ind.macd.signal) score += 1;
  else if (ind.macd && ind.macd.h < ind.macd.signal) score -= 1;

  /* EMA stack: 9 > 21 > 50 is the classic bull stack; reverse is
     the bear stack. */
  if (ind.ema9 != null && ind.ema21 != null) {
    if (ind.ema9 > ind.ema21) score += 1;
    else score -= 1;
  }
  if (ind.ema21 != null && ind.ema50 != null) {
    if (ind.ema21 > ind.ema50) score += 1;
    else score -= 1;
  }

  let label;
  let ar;
  if (score >= 4) {
    label = 'STRONG_BUY';
    ar = 'شراء قوي';
  } else if (score >= 2) {
    label = 'BUY';
    ar = 'شراء خفيف';
  } else if (score >= 1) {
    label = 'WATCH';
    ar = 'مراقبة';
  } else if (score <= -4) {
    label = 'STRONG_SELL';
    ar = 'بيع قوي';
  } else if (score <= -2) {
    label = 'SELL';
    ar = 'بيع خفيف';
  } else {
    label = 'NEUTRAL';
    ar = 'محايد';
  }
  return { label, ar, score };
}

/* runIndicatorPass — feed it Binance klines for one symbol and you
   get { rsi, macd, ema9, ema21, ema50, atr, direction, ts }. The
   caller (server.js) batches calls across the symbols it cares
   about and stashes the map on cache.indicators. */
function runIndicatorPass(klines) {
  if (!Array.isArray(klines) || klines.length < 26) return null;
  const closes = klines.map((k) => parseFloat(k[4])).filter((x) => isFinite(x));
  if (closes.length < 26) return null;
  const ind = {
    rsi: calcRSI(closes, 14),
    macd: calcMACD(closes),
    ema9: calcEMA(closes, 9),
    ema21: calcEMA(closes, 21),
    ema50: closes.length >= 50 ? calcEMA(closes, 50) : null,
    atr: calcATR(klines, 14),
  };
  ind.direction = classifyDirection(ind);
  ind.ts = Date.now();
  return ind;
}

/* Multi-timeframe agreement — collapse the direction labels from
   several timeframes into one verdict so the scanner can reward
   symbols where 15m / 1h / 4h all point the same way. Three-way
   agreement is the strongest setup (intraday momentum lines up with
   the swing trend); two-way agreement is weaker but still tradeable;
   anything else is "mixed" and contributes nothing.

   Input: { '15m': indResult, '1h': indResult, '4h': indResult } —
   any subset is fine. We need at least two timeframes to call
   agreement; one alone is just the existing 15m signal.

   Output: { agreement, strength, count, tfs } — agreement is
   'bullish' / 'bearish' / 'mixed'; strength is 'full' / 'partial' /
   'none'; count is how many timeframes voted the winning way; tfs
   is the list of intervals that supplied a label. */
function multiTfAgreement(tfs) {
  if (!tfs || typeof tfs !== 'object') return null;
  const intervals = ['15m', '1h', '4h'];
  const contributions = [];
  for (const iv of intervals) {
    const r = tfs[iv];
    const lbl = r && r.direction && r.direction.label;
    if (!lbl) continue;
    let dir;
    if (lbl === 'STRONG_BUY' || lbl === 'BUY') dir = 'bullish';
    else if (lbl === 'STRONG_SELL' || lbl === 'SELL') dir = 'bearish';
    else dir = 'neutral';
    contributions.push({ iv, dir });
  }
  if (contributions.length < 2) return null;
  const bull = contributions.filter((c) => c.dir === 'bullish').length;
  const bear = contributions.filter((c) => c.dir === 'bearish').length;
  const total = contributions.length;
  const tfList = contributions.map((c) => c.iv);
  if (bull === total) return { agreement: 'bullish', strength: 'full', count: bull, tfs: tfList };
  if (bear === total) return { agreement: 'bearish', strength: 'full', count: bear, tfs: tfList };
  if (bull >= 2) return { agreement: 'bullish', strength: 'partial', count: bull, tfs: tfList };
  if (bear >= 2) return { agreement: 'bearish', strength: 'partial', count: bear, tfs: tfList };
  return { agreement: 'mixed', strength: 'none', count: 0, tfs: tfList };
}

module.exports = {
  emaSeries,
  calcEMA,
  calcRSI,
  calcMACD,
  calcATR,
  classifyDirection,
  runIndicatorPass,
  multiTfAgreement,
};
