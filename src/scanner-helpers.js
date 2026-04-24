/* NEXUS PRO — pure scanner helpers.
   Extracted from app.js so they can be unit-tested without having to
   boot the whole application. None of these touch app-level globals:
   callers pass in klines / arrays / numbers and receive a plain
   object or scalar back.

   Depends on src/utils.js for calcEMA (Multi-TF alignment uses it).
   Loaded via <script> in index.html *after* src/utils.js. */

/* Confirmed Breakout Gate.
   A real breakout needs (a) the most recent closed 15m candle's close
   above the highest high of the previous `lookback` (default 20) bars,
   and (b) the breakout bar's volume at least `volMult` × the average
   of the prior bars. Without both, a candle that merely tags the
   prior high is a wick — not a breakout. */
function isConfirmedBreakout(kl15, lookback, volMult) {
  lookback = lookback || 20;
  volMult = volMult || 1.5;
  if (!kl15 || kl15.length < lookback + 1) return { confirmed: false };
  var last = kl15[kl15.length - 1];
  var lastClose = +last[4];
  var lastVol = +last[5];
  var priorHigh = 0;
  var volSum = 0;
  for (var i = kl15.length - 1 - lookback; i < kl15.length - 1; i++) {
    var h = +kl15[i][2];
    if (h > priorHigh) priorHigh = h;
    volSum += +kl15[i][5];
  }
  var avgVol = volSum / lookback;
  var vRatio = avgVol > 0 ? lastVol / avgVol : 0;
  return {
    confirmed: lastClose > priorHigh && vRatio >= volMult,
    priorHigh: priorHigh,
    volRatio: vRatio,
  };
}

/* Multi-Timeframe EMA Alignment.
   Bullish alignment on 15m AND 1h is meaningful confluence; a bearish
   4h backdrop is a strong headwind regardless of LTF momentum. Returns
     - aligned15m1h: both LTFs bullish (EMA20 > EMA50)
     - bearish4h:    HTF bearish (EMA20 <= EMA50 on 4h)
     - bull4h:       HTF bullish (positive confirmation, not just absent negative)
     - score:        additive score contribution (+15 / -25 / 0) */
function tfAlignment(kl15, kl1h, kl4h) {
  function bullish(kl) {
    if (!kl || kl.length < 50) return null;
    var closes = kl.map(function (k) { return +k[4]; });
    var e20 = calcEMA(closes, 20);
    var e50 = calcEMA(closes, 50);
    if (e20 == null || e50 == null) return null;
    return e20 > e50;
  }
  var b15 = bullish(kl15);
  var b1h = bullish(kl1h);
  var b4h = bullish(kl4h);
  var aligned = b15 === true && b1h === true;
  var bear4h = b4h === false;
  var score = 0;
  if (aligned) score += 15;
  if (bear4h) score -= 25;
  return { aligned15m1h: aligned, bearish4h: bear4h, bull4h: b4h === true, score: score };
}

/* ATR-based entry / stop / target zones.
   Replaces fixed-percent multipliers with volatility-aware bounds.
   price - stopMult × ATR is the minimum risk; price + targetMult × ATR
   is the minimum reward. When classic support/resistance is tighter we
   use those — ATR is the floor, not a ceiling. Returns null if price
   or ATR is missing. */
function atrZones(price, atr, support, resistance) {
  if (!atr || atr <= 0 || !price) return null;
  var stopMult = 1.5;
  var t1Mult = 3.0;
  var t2Mult = 5.0;
  var stop = price - stopMult * atr;
  if (support && support > 0 && support < price) {
    stop = Math.max(stop, support * 0.985);
  }
  var target1 = price + t1Mult * atr;
  if (resistance && resistance > price) {
    target1 = Math.min(target1, resistance);
  }
  var target2 = price + t2Mult * atr;
  var risk = price - stop;
  var rr = risk > 0 ? +((target1 - price) / risk).toFixed(2) : 0;
  return {
    entry: price,
    stop: stop,
    target1: target1,
    target2: target2,
    rr: rr,
    atr: atr,
  };
}

/* Count how many entries in `waves` have a timestamp within the last
   `windowMs`. Pure version of whaleWaveConsensus — takes the waves
   array directly so tests don't need the app's global whaleWaves. */
function countWavesInWindow(waves, windowMs) {
  if (!waves || !waves.length) return 0;
  var cutoff = Date.now() - windowMs;
  var n = 0;
  for (var i = 0; i < waves.length; i++) {
    if (waves[i] && waves[i].time >= cutoff) n++;
  }
  return n;
}

/* Average rolling Order Flow Imbalance over the samples in `arr` that
   fall within `windowMs` of now. Needs at least 5 samples in the
   window to return a number — otherwise returns null so callers can
   fall back to a snapshot. */
function rollingOBIFromArr(arr, windowMs) {
  if (!arr || arr.length < 5) return null;
  var now = Date.now();
  var cutoff = now - windowMs;
  var sum = 0, n = 0, spanMs = 0, first = null;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].t < cutoff) continue;
    if (first == null) first = arr[i].t;
    sum += arr[i].r;
    n++;
    spanMs = arr[i].t - first;
  }
  if (n < 5) return null;
  return { avg: sum / n, samples: n, spanMs: spanMs };
}
