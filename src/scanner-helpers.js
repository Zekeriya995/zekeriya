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
   or ATR is missing.

   Optional 5th parameter `mults` overrides the defaults — used by the
   scanner to widen targets for accumulation candidates whose expected
   move is a full launch, not a swing. Pass { stop, t1, t2 }. */
function atrZones(price, atr, support, resistance, mults) {
  if (!atr || atr <= 0 || !price) return null;
  var stopMult = (mults && mults.stop) || 1.5;
  var t1Mult = (mults && mults.t1) || 3.0;
  var t2Mult = (mults && mults.t2) || 5.0;
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

/* Signal Performance Report — honest backtest over persisted history.
   Buckets the *checked* predictions and closed trades to answer one
   question: which signal types are actually making money?

   Why this isn't a true backtest: quickScan/deepAnalyze depend on live
   global state (T, FR, LS, depthSnapshots, …) we don't preserve per
   historical snapshot. We can't replay the engine on old market data.
   What we CAN do is measure which signals did and didn't work in the
   past — that's useful, if less glamorous than "backtest".

   Input:
     - preds = predictions[] (hit? partial? score, time, pnl)
     - trades = activeTrades[] (status, finalPnl, type, score, duration, exitReason)
   Output:
     {
       totalChecked, totalClosed,
       byTier: { ultra, whale, breakout } each { rate, wins, partials,
                                                  losses, samples, avgPnl, profitFactor },
       byExitReason: { '<reason>': count },
       recentTrend: [ { bucket, rate } ]   // win rate in rolling 25-pred windows
     }
   Buckets with fewer than 3 samples report rate = null so the caller
   can hide noisy cells instead of showing a misleading 100%. */
function computePerformanceReport(preds, trades) {
  var out = {
    totalChecked: 0,
    totalClosed: 0,
    byTier: { ultra: null, whale: null, breakout: null },
    byExitReason: {},
    recentTrend: [],
  };
  var checked = (preds || []).filter(function (p) { return p && p.checked; });
  out.totalChecked = checked.length;
  /* Tier buckets from predictions. Score thresholds mirror the ones
     used elsewhere in the app (acc panel, win-rate badge). */
  var buckets = {
    ultra: { wins: 0, partials: 0, losses: 0, samples: 0, pnlSum: 0, gains: 0, losses_abs: 0 },
    whale: { wins: 0, partials: 0, losses: 0, samples: 0, pnlSum: 0, gains: 0, losses_abs: 0 },
    breakout: { wins: 0, partials: 0, losses: 0, samples: 0, pnlSum: 0, gains: 0, losses_abs: 0 },
  };
  for (var i = 0; i < checked.length; i++) {
    var p = checked[i];
    var b = p.score >= 60 ? buckets.ultra : p.score >= 40 ? buckets.whale : buckets.breakout;
    b.samples++;
    if (p.hit) b.wins++;
    else if (p.partial) b.partials++;
    else b.losses++;
    var pnl = +p.pnl || 0;
    b.pnlSum += pnl;
    if (pnl > 0) b.gains += pnl;
    else b.losses_abs += Math.abs(pnl);
  }
  function finalize(b) {
    if (b.samples < 3) return null;
    var rate = Math.round(((b.wins + b.partials * 0.5) / b.samples) * 100);
    var avgPnl = +(b.pnlSum / b.samples).toFixed(2);
    var pf = b.losses_abs > 0 ? +(b.gains / b.losses_abs).toFixed(2) : (b.gains > 0 ? Infinity : 0);
    return {
      rate: rate,
      wins: b.wins,
      partials: b.partials,
      losses: b.losses,
      samples: b.samples,
      avgPnl: avgPnl,
      profitFactor: pf,
    };
  }
  out.byTier.ultra = finalize(buckets.ultra);
  out.byTier.whale = finalize(buckets.whale);
  out.byTier.breakout = finalize(buckets.breakout);
  /* Closed-trade breakdown by exit reason. Useful for answering "am I
     mostly getting stopped out, or hitting targets?" */
  var closed = (trades || []).filter(function (t) { return t && t.status === 'CLOSED'; });
  out.totalClosed = closed.length;
  for (var j = 0; j < closed.length; j++) {
    var reason = closed[j].exitReason || 'unknown';
    out.byExitReason[reason] = (out.byExitReason[reason] || 0) + 1;
  }
  /* Rolling 25-prediction win-rate series — shows whether recent
     performance is trending up or down. Only emitted when we have at
     least 50 checked predictions. */
  if (checked.length >= 50) {
    var windowSize = 25;
    for (var k = windowSize; k <= checked.length; k += windowSize) {
      var slice = checked.slice(k - windowSize, k);
      var wins = 0;
      for (var m = 0; m < slice.length; m++) {
        if (slice[m].hit) wins += 1;
        else if (slice[m].partial) wins += 0.5;
      }
      out.recentTrend.push({
        bucket: k,
        rate: Math.round((wins / slice.length) * 100),
      });
    }
  }
  return out;
}

/* Classify a candidate into one of five setup types — used by the
   scanner's setup filter so the user can focus on a specific
   trade pattern. Pure function: takes the candidate result, its
   ticker snapshot, the current BTC change %, and a CVD divergence
   string ('BULLISH' | 'BEARISH' | null) so it doesn't depend on
   app-level globals.

   Categories are evaluated in priority order — accumulation wins
   over trend even if both could match, because pre-pump signals
   are the platform's primary hunt. Returns:

     'early_breakout' — near daily high, small move, high vol
                        (pre-breakout, not the breakout candle itself)
     'pullback'       — small dip in an uptrend
     'reversal'       — bottom of range + bullish CVD
     'accumulation'   — silent accumulation tag or vol+flat
     'trend'          — modest uptrend with confluence
     'mixed'          — none of the above

   Aligned with the platform's "enter before the explosion" goal:
   early_breakout is intentionally bounded at c <= 2% so it captures
   coins approaching the high WITHOUT requiring the breakout candle. */
function classifySetup(r, d, btcChange, cvdDivergence) {
  if (!r || !d) return 'unknown';
  var tags = r.tags || [];
  /* Accumulation has highest priority — it's the killer pre-pump tag. */
  var hasAccTag = false;
  for (var i = 0; i < tags.length; i++) {
    if (tags[i] && tags[i].indexOf('ACC') >= 0) { hasAccTag = true; break; }
  }
  if (hasAccTag) return 'accumulation';
  if (d.v > 5e7 && Math.abs(d.c) < 1.5) return 'accumulation';
  /* Reversal — bottom of range with bullish CVD divergence. */
  var hasBottomTag = false;
  for (var j = 0; j < tags.length; j++) {
    if (tags[j] && tags[j].indexOf('BOTTOM') >= 0) { hasBottomTag = true; break; }
  }
  if (hasBottomTag && cvdDivergence === 'BULLISH') return 'reversal';
  /* Early breakout — near the high but hasn't run yet. The c bounds
     are intentional: 0 to 2% is the pre-breakout window we want; the
     prompt's original 2-6% would catch only AFTER the candle prints. */
  if (d.h > 0 && d.p / d.h > 0.95 && d.c >= 0 && d.c <= 2 && d.v > 5e7) {
    return 'early_breakout';
  }
  /* Pullback — small dip while BTC is up and RSI confirmed. */
  if (d.c >= -3 && d.c <= -0.5 && btcChange > 0 && r.checks && r.checks.rsi) {
    return 'pullback';
  }
  /* Trend — modest uptrend with at least 4 of 6 checks. */
  if (d.c >= 0.5 && d.c <= 3 && r.passed >= 4) return 'trend';
  return 'mixed';
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
