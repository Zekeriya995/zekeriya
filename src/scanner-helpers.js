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
    var closes = kl.map(function (k) {
      return +k[4];
    });
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
  /* AUDIT-atrZones: caller-supplied negative `mults`, an `atr` that
     somehow slipped past the > 0 guard, or a `resistance` clamp that
     pulls target1 onto entry would yield risk <= 0 or no upside.
     The risk = price - stop calculation then went negative, rr
     silently became 0, and downstream consumers had no way to tell a
     degenerate setup from a low-quality one. Reject explicitly so the
     caller short-circuits. (target1 <= target2 is intentionally NOT
     required here — a `mults` override that bumps t1 above t2 is a
     legitimate configuration choice; the order is enforced upstream
     where it matters.) */
  if (!(stop < price && price < target1)) return null;
  var risk = price - stop;
  var rr = +((target1 - price) / risk).toFixed(2);
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
  var checked = (preds || []).filter(function (p) {
    return p && p.checked;
  });
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
    var pf = b.losses_abs > 0 ? +(b.gains / b.losses_abs).toFixed(2) : b.gains > 0 ? Infinity : 0;
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
  var closed = (trades || []).filter(function (t) {
    return t && t.status === 'CLOSED';
  });
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

/* Decide whether a coin's user-history qualifies as PROVEN. Pure:
   takes the coinStats entry from monitorState.coinStats[sym] plus
   optional thresholds, returns { proven, rate }.

   Thresholds (defaults match the live scoring engine):
     minTrades = 5    — fewer samples are too noisy to trust
     minRate   = 60   — comfortably above coin-flip; matches the
                        platform's pre-pump alpha threshold

   This is a CONTRACT test, not a backtest. It verifies that the
   thresholds we ship match the documented values — it does NOT
   prove that 5/60 are the *optimal* values. Determining optimum
   requires historical replay over real predictions data, which is
   the unbuilt backtest harness mentioned in earlier reviews.

   Behavior:
     - missing coinStat              → { proven: false, rate: 0 }
     - missing total or rate field   → { proven: false, rate: 0 }
     - total < minTrades             → { proven: false, rate: <as-is> }
     - rate  < minRate               → { proven: false, rate: <as-is> }
     - both meet threshold           → { proven: true,  rate: <as-is> } */
function evaluateProvenStatus(coinStat, minTrades, minRate) {
  if (minTrades == null) minTrades = 5;
  if (minRate == null) minRate = 60;
  if (!coinStat || coinStat.total == null || coinStat.rate == null) {
    return { proven: false, rate: 0 };
  }
  if (coinStat.total < minTrades) return { proven: false, rate: coinStat.rate };
  if (coinStat.rate < minRate) return { proven: false, rate: coinStat.rate };
  return { proven: true, rate: coinStat.rate };
}

/* Pick the visual tier for a scanner signal card. Pure: takes the
   signal object (the rendered shape, with .tags, .proven, .ultra,
   .confirmed, .type) and returns the bar gradient + symbol marker
   + outer card style + whether to render the DOUBLE CONFIRMED
   banner above the card body.

   Tier ladder (highest priority first):
     'double'    — WHALE_TARGET tag AND proven === true
                   purple-gold gradient, 🌟 marker, banner above body
     'whale'     — WHALE_TARGET tag (whaleConf >= 60 from PR #14)
                   gold gradient, 🐋✨ marker, gold border + glow
     'ultra'     — signal.ultra === true (legacy ULTRA flag)
                   ultra color, ⭐ marker
     'confirmed' — signal.confirmed === true
                   up color, 🟢 marker
     'default'   — none of the above
                   blue if type 'fast' else up; no marker

   Extracted from renderTrading() so the visual logic can be unit
   tested without spinning up a DOM. All CSS strings preserved
   verbatim; the renderer composes them into HTML. */
function pickCardVisualTier(signal) {
  if (!signal) {
    return {
      tier: 'default',
      barColor: 'var(--up)',
      marker: '',
      cardStyle: '',
      hasBanner: false,
    };
  }
  var tags = signal.tags || [];
  var isWhaleTarget = false;
  for (var i = 0; i < tags.length; i++) {
    if (tags[i] && tags[i].indexOf('WHALE_TARGET') >= 0) {
      isWhaleTarget = true;
      break;
    }
  }
  var isDouble = isWhaleTarget && signal.proven === true;
  if (isDouble) {
    return {
      tier: 'double',
      barColor: 'linear-gradient(90deg,#ffd700,#b07cff)',
      marker: '🌟 ',
      cardStyle:
        ' style="border:2px solid #b07cff;box-shadow:0 0 14px rgba(176,124,255,.4),0 0 6px rgba(255,215,0,.3)"',
      hasBanner: true,
    };
  }
  if (isWhaleTarget) {
    return {
      tier: 'whale',
      barColor: 'linear-gradient(90deg,#ffd700,#ff8c00)',
      marker: '🐋✨ ',
      cardStyle: ' style="border:2px solid #ffd700;box-shadow:0 0 12px rgba(255,215,0,.3)"',
      hasBanner: false,
    };
  }
  if (signal.ultra) {
    return {
      tier: 'ultra',
      barColor: 'var(--ultra)',
      marker: '⭐ ',
      cardStyle: '',
      hasBanner: false,
    };
  }
  if (signal.confirmed) {
    return {
      tier: 'confirmed',
      barColor: 'var(--up)',
      marker: '🟢 ',
      cardStyle: '',
      hasBanner: false,
    };
  }
  return {
    tier: 'default',
    barColor: signal.type === 'fast' ? 'var(--blue)' : 'var(--up)',
    marker: '',
    cardStyle: '',
    hasBanner: false,
  };
}

/* ─── Gem Hunter — central tuning knobs ────────────────────────────
   All tunable thresholds for the Gem Hunter live here so the live
   scanner, the unit tests, and any future tuning UI read from one
   place. Changing a number here changes the behavior everywhere.

   Frozen so accidental mutation surfaces as a TypeError at the
   call site instead of silently drifting the scoring contract. */
const GEM_CONFIG = Object.freeze({
  /* Pre-filter (cheap, ticker-only) */
  STABLES: [
    'USDT',
    'USDC',
    'TUSD',
    'DAI',
    'BUSD',
    'FDUSD',
    'USDP',
    'PYUSD',
    'USDE',
    'USDD',
    'GUSD',
    'USTC',
    'USDS',
    'CRVUSD',
    'LUSD',
    'FRAX',
  ],
  PRICE_MAX: 20 /* USDT — upper bound for "small cap" candidate */,
  VOL_MIN: 100000 /* 24h quote-volume floor (Binance USD) */,
  MC_MIN: 1000000 /* CoinGecko MC floor when MC is known */,
  MC_MAX: 50000000 /* CoinGecko MC ceiling when MC is known */,

  /* Risk / scoring gates */
  RUG_MAX: 70 /* getRugPullRisk gate — reject above this */,
  SCORE_MIN: 35 /* loadSmallCaps2 gate — raised from 25 to
                               require timing+vol or score-stack, not
                               timing alone */,

  /* Spike walkback */
  WALKBACK_VOL_MULT: 1.5 /* a candle's vol > avgV*1.5 counts as part
                               of the active spike */,

  /* Timing thresholds (gain% from spike start) */
  EARLY_MAX: 3 /* gain < 3% = early */,
  STILL_MAX: 8 /* gain < 8% = still time */,
  /* gain >= 8% = late */

  /* Slice caps */
  PREFILTER_LIMIT: 50 /* survivors of pre-filter sorted by 24h vol */,
  SCORE_LIMIT: 25 /* of those, top N actually fetched + scored */,
  RENDER_LIMIT: 20 /* top N rendered as cards */,

  /* Caching (orchestrator side) */
  KLINE_TTL_MS: 90000 /* per-symbol 1h klines TTL */,
  RES_TTL_MS: 90000 /* full result set TTL — drives filter switching */,

  /* Target/stop hints (display only — not used in scoring) */
  TARGET_EARLY: 1.3,
  TARGET_STILL: 1.25,
  STOP_EARLY: 0.9,
  STOP_STILL: 0.88,
});

/* Validate a ticker symbol before it enters URL builders or
   string-concatenated onclick handlers. Defense-in-depth: even though
   T's keys come from a trusted proxy, a hostile or buggy upstream
   feed could push a key like `X');alert(1);//` and we'd happily
   string-concat it into both the Binance URL and inline JS. The
   regex caps it at uppercase alphanumerics, 1-15 chars — wider than
   any real ticker but tight enough to be unforgeable.

   Returns true for safe symbols, false for anything else (including
   non-string, empty, lowercase, or symbols containing punctuation). */
function isValidGemSymbol(s) {
  if (typeof s !== 'string') return false;
  return /^[A-Z0-9]{1,15}$/.test(s);
}

/* Find the index in `vols` where the active volume spike *began*.
   Walks back from the most recent candle while each prior candle
   was also "spiking" (vol > avgV * multiplier). Returns the index
   of the *earliest* such candle in the trailing run.

   The previous in-line implementation in app.js wrote
     `for (i = N-1; i >= 1; i--) { if (vols[i] > T) sI = i; else break }`
   which only ever assigned `sI` for candles inside the trailing
   spike, but EVERY iteration overwrote sI — so the value left in
   sI when the loop hit a calm bar was the last spike index visited,
   i.e. the EARLIEST spike of the trailing run. That accidental
   correctness DEPENDED on the loop terminating at the first calm
   bar. If the input had alternating spike / calm / spike candles,
   the loop would break at the first calm (correct), but if the
   most recent candle was calm and the prior spike was further back,
   the loop would break before finding any spike and sI would stay
   at N-1 (the most recent calm candle) — masking the spike entirely.

   This pure version makes the contract explicit:
     - Start at the most recent candle.
     - If it's NOT spiking, the spike is over (or never started) —
       return N-1 so callers measure gain from the most recent close.
     - Otherwise, walk back one candle at a time until either we hit
       a non-spiking bar (return the spike's first index) or run out
       of candles (return 0).

   Returns an integer index in [0, vols.length-1]. Always defined as
   long as vols has at least one entry. */
function walkbackSpikeStart(vols, avgV, multiplier) {
  if (!vols || vols.length === 0) return 0;
  multiplier = multiplier == null ? 1.5 : multiplier;
  if (!(avgV > 0)) return vols.length - 1;
  var threshold = avgV * multiplier;
  var n = vols.length;
  /* If the most recent candle isn't part of a spike, return it. */
  if (!(vols[n - 1] > threshold)) return n - 1;
  /* Walk back through the contiguous trailing spike. */
  var sI = n - 1;
  for (var i = n - 2; i >= 0; i--) {
    if (vols[i] > threshold) sI = i;
    else break;
  }
  return sI;
}

/* Classify a gem candidate's "timing" — how early in the move are we?
   Pure: numeric input, string output. Bucketing is intentional so
   the orchestrator can tag each result and the renderer can pick a
   color. Cutoffs read from GEM_CONFIG so tuning happens in one place.

   Returns one of:
     'early' — gain < EARLY_MAX (default 3%)   — best entry window
     'still' — gain < STILL_MAX (default 8%)   — caution
     'late'  — gain >= STILL_MAX               — watch only

   NaN / non-numeric input collapses to 'early' (the most permissive
   bucket) so a missing-data candidate still gets considered rather
   than silently dropped. The score gate downstream still requires
   real momentum signals, so 'early' alone won't surface noise. */
function classifyGemTiming(gainPct) {
  var g = +gainPct;
  if (!isFinite(g)) return 'early';
  if (g < GEM_CONFIG.EARLY_MAX) return 'early';
  if (g < GEM_CONFIG.STILL_MAX) return 'still';
  return 'late';
}

/* Score a Gem-Hunter candidate from already-computed inputs.
   Pure: takes the ticker snapshot, kline-derived stats, and V3
   technique results — no globals, no fetches, deterministic.
   Returns { score, tags }.

   Inputs:
     ticker      { p, c, v, h, l }     — current ticker snapshot
     klineStats  { vx, timing }        — vx = vol multiplier vs avg,
                                         timing in {'early','still','late'}
     v3          { iceberg, vpin,
                   whalePnL, cvd }     — outputs of the V3 functions
                                         (any field may be null/undefined)

   Scoring contract (must match the live Gem Hunter):
     vx in [4, ∞)      +45  '🔥VOL <vx>x'
     vx in [3, 4)      +40  '📊VOL <vx>x'
     vx in [2, 3)      +30  '📊VOL <vx>x'
     vx in [1.5, 2)    +15  'vol <vx>x'
     timing 'early'    +30
     timing 'still'    +15
     bottom-of-range   +10  '📉LOW'   (price in lower 30% of h-l band)
     iceberg BUY       +20  '🧊ICE'
     vpin > 0.6        +15  '🧪VPIN'
     vpin in (0.4, 0.6] +8  '🧪vp'
     whalePnL > +1%    +10  '🐋PRO'
     cvd BULLISH       +15  '📈CVD'
     c in (0, 3)       +20
     c in [3, 8)       +10 */
function scoreGemCandidate(ticker, klineStats, v3) {
  if (!ticker) return { score: 0, tags: [] };
  var sc = 0;
  var tags = [];
  if (klineStats && klineStats.vx != null) {
    var vx = klineStats.vx;
    if (vx >= 4) {
      sc += 45;
      tags.push('🔥VOL ' + vx.toFixed(1) + 'x');
    } else if (vx >= 3) {
      sc += 40;
      tags.push('📊VOL ' + vx.toFixed(1) + 'x');
    } else if (vx >= 2) {
      sc += 30;
      tags.push('📊VOL ' + vx.toFixed(1) + 'x');
    } else if (vx >= 1.5) {
      sc += 15;
      tags.push('vol ' + vx.toFixed(1) + 'x');
    }
  }
  if (klineStats && klineStats.timing === 'early') sc += 30;
  else if (klineStats && klineStats.timing === 'still') sc += 15;
  if (ticker.h != null && ticker.l != null && ticker.h !== ticker.l) {
    var posInRange = (ticker.p - ticker.l) / (ticker.h - ticker.l);
    if (posInRange < 0.3) {
      sc += 10;
      tags.push('📉LOW');
    }
  }
  if (v3) {
    if (v3.iceberg && v3.iceberg.signal === 'ICEBERG_BUY') {
      sc += 20;
      tags.push('🧊ICE');
    }
    if (v3.vpin && v3.vpin.vpin != null) {
      if (v3.vpin.vpin > 0.6) {
        sc += 15;
        tags.push('🧪VPIN');
      } else if (v3.vpin.vpin > 0.4) {
        sc += 8;
        tags.push('🧪vp');
      }
    }
    if (v3.whalePnL && v3.whalePnL.pct != null && v3.whalePnL.pct > 1) {
      sc += 10;
      tags.push('🐋PRO');
    }
    if (v3.cvd && v3.cvd.divergence === 'BULLISH') {
      sc += 15;
      tags.push('📈CVD');
    }
  }
  if (ticker.c != null) {
    if (ticker.c > 0 && ticker.c < 3) sc += 20;
    else if (ticker.c >= 3 && ticker.c < 8) sc += 10;
  }
  return { score: sc, tags: tags };
}

/* Rugpull risk score (0-100) for the Gem Hunter — coins with high
   risk are filtered out before the user ever sees them. Pure: takes
   a ticker snapshot, optional funding-rate object, optional book
   ticker (best bid/ask + qty + spread). Returns a number; the
   Gem Hunter rejects anything above GEM_CONFIG.RUG_MAX.

   Risk factors (additive, capped at 100):
     +30  bid/ask spread > 1%        (illiquid market)
     +20  bid OR ask qty < 100        (thin order book)
     +25  24h volume < $500K          (very low turnover)
     +15  abs(24h change) > 30%       (manipulation suspicion)
     +10  no futures market exists    (no institutional interest)

   Missing inputs are treated as "data unavailable" and contribute 0
   to risk — we don't penalize a coin for our own data gaps. The
   exception is `d` itself: if no ticker snapshot, return 100 (max
   risk) because we can't make any safety claim.

   `fr` semantics — explicit-null vs undefined:
     - `null`       → caller asserts: this coin has NO futures market.
                      Adds +10 (the documented "no futures" risk).
     - `undefined`  → caller signals: futures data not loaded yet.
                      Adds 0. This prevents a global cold-start
                      penalty where every gem candidate inherits +10
                      while the FR feed is still hydrating.
     - any object   → futures exist. Adds 0.
   The previous `!fr` test conflated null and undefined, which made
   the cold-start window rejecting otherwise-valid gems for ~minutes
   on every page load. */
function getRugPullRisk(d, fr, bookTicker) {
  if (!d) return 100;
  var risk = 0;
  if (bookTicker) {
    if (bookTicker.spread != null && bookTicker.spread > 1) risk += 30;
    if (bookTicker.bidQty != null && bookTicker.bidQty < 100) risk += 20;
    else if (bookTicker.askQty != null && bookTicker.askQty < 100) risk += 20;
  }
  if (d.v != null && d.v < 500000) risk += 25;
  if (d.c != null && Math.abs(d.c) > 30) risk += 15;
  if (fr === null) risk += 10;
  if (risk > 100) risk = 100;
  return risk;
}

/* Evaluate a signal's outcome by comparing entry price to current
   price. Used by the per-tag performance tracker so we can answer
   "which tags actually predict winners?" Pure: takes prices and
   thresholds, returns the outcome string.

   Returns 'win'  if gain >= winThreshold (default +5%)
   Returns 'loss' if gain <= -lossThreshold (default -3%)
   Returns 'neutral' otherwise (sideways or missing data).

   Asymmetric thresholds (5% win vs 3% loss) reflect the platform's
   pre-pump bias — we want signals that pump meaningfully, but a 3%
   drawdown is enough to call it a miss. */
function evaluateSignalOutcome(entryPrice, currentPrice, winThreshold, lossThreshold) {
  if (!entryPrice || !currentPrice || entryPrice <= 0) return 'neutral';
  var gain = ((currentPrice - entryPrice) / entryPrice) * 100;
  var winT = winThreshold == null ? 5 : winThreshold;
  var lossT = lossThreshold == null ? 3 : lossThreshold;
  if (gain >= winT) return 'win';
  if (gain <= -lossT) return 'loss';
  return 'neutral';
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
    if (tags[i] && tags[i].indexOf('ACC') >= 0) {
      hasAccTag = true;
      break;
    }
  }
  if (hasAccTag) return 'accumulation';
  if (d.v > 5e7 && Math.abs(d.c) < 1.5) return 'accumulation';
  /* Reversal — bottom of range with bullish CVD divergence. */
  var hasBottomTag = false;
  for (var j = 0; j < tags.length; j++) {
    if (tags[j] && tags[j].indexOf('BOTTOM') >= 0) {
      hasBottomTag = true;
      break;
    }
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
  var sum = 0,
    n = 0,
    spanMs = 0,
    first = null;
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

/* ─── blacklist threshold contract ─────────────────────────────────
   The blacklist used to be populated with a looser "3 trades / <30%"
   rule while signalQualityGate Gate 4 enforced the stricter
   "5 trades / <25%" — so the user-visible blacklist UI mismatched
   what was actually blocked. The audit (PR #25) aligned both to
   5/25 add, 5/55 remove. These helpers codify the contract so all
   three call-sites (processTradeOutcome, runAutoImprove, Gate 4)
   share the exact same rule and the test suite can pin its
   boundaries down. */

/* True iff this coin should be added to the blacklist on the latest
   trade-outcome update. Requires 5+ closed trades AND a sub-25%
   win rate. Null/missing stats → false. */
function evaluateBlacklistAdd(coinStat) {
  if (!coinStat) return false;
  if (typeof coinStat.total !== 'number' || typeof coinStat.rate !== 'number') return false;
  return coinStat.total >= 5 && coinStat.rate < 25;
}

/* True iff this coin should be removed from the blacklist now. The
   recovery threshold (>=55% win rate AND 5+ trades) is intentionally
   wider than the add threshold to provide hysteresis: a coin needs a
   meaningful turnaround before earning its way back in, so it doesn't
   flap in and out on a single lucky trade.

   Note on the 5+ trades guard: runtime call-sites only ever pass a
   coinStat for a coin that has already been on the blacklist, and a
   coin can only be added once total reaches 5 (see evaluateBlacklistAdd).
   Because cs.total is a monotonic counter (only ever incremented in
   processTradeOutcome), every blacklisted coin's total is >= 5 by
   construction — so the guard is redundant for runtime code but
   tightens the helper's contract to match runAutoImprove's explicit
   guard. The PR #25 migration also drops any pre-PR-25 entry whose
   total < 5, so persisted state can't violate the invariant either. */
function evaluateBlacklistRemove(coinStat) {
  if (!coinStat) return false;
  if (typeof coinStat.total !== 'number' || typeof coinStat.rate !== 'number') return false;
  return coinStat.total >= 5 && coinStat.rate >= 55;
}

/* ─── quality-filter gate contract ─────────────────────────────────
   qualityFilter() in app.js applies seven hard gates to a deep-analyze
   result before it reaches the renderer. The gates read FR/T/sigHist
   globals inline, which makes them untestable without booting the app.
   This helper takes those reads as a `ctx` parameter so the same gate
   logic is callable from a unit test.

   Returns null if the signal passes; a short reason string if it's
   rejected — useful both for test assertions and for surfacing why a
   coin disappeared mid-pipeline.

   ctx shape:
     fr:                FR[r.s]                 — { rate } or null
     btc:               T.BTC                   — { c } or null
     priceAtDetection:  sigHist[r.s+'_trade'].priceAtDetection */
function qualityFilterRejectReason(r, ctx) {
  ctx = ctx || {};
  if (!r) return 'no-data';
  if (r.c >= 5) return 'late';
  if (r.passed < 4) return 'low-passed';
  if (r.smartEntry && +r.smartEntry.rr < 2.0) return 'low-rr';
  if (ctx.fr && ctx.fr.rate > 0.05) return 'high-fr';
  if (ctx.btc && ctx.btc.c < -3) return 'btc-crash';
  /* HTF headwind only fires when price is already moving (c >= 2);
     during silent accumulation 4h often looks weakly bearish while
     whales build, so we don't reject pre-pump candidates. */
  if (r.tfAlign && r.tfAlign.bearish4h && r.c >= 2) return 'htf-bear';
  if (r.pdFlags >= 3) return 'pd';
  if (ctx.priceAtDetection && ctx.priceAtDetection > 0) {
    var drift = ((r.p - ctx.priceAtDetection) / ctx.priceAtDetection) * 100;
    if (drift > 8) return 'drift';
  }
  return null;
}

/* ─── shared scoring sub-formulas ──────────────────────────────────
   The audit flagged that loadTrading (Smart Trading tab confidence)
   and renderTop3 (home-screen VIP priority) had two completely
   independent scoring models with no shared logic. After tracing
   them carefully, most of the divergence is intentional — the two
   tabs answer different questions (~"is this signal entry-worthy
   right now?" vs "is this in the top 3 VIP picks?") and weight the
   same signals differently on purpose.

   What IS genuinely shared is the *fact extraction* underneath:
   computing the Coinbase premium percentage, picking the latest
   top-trader long ratio. Both call-sites used to inline the same
   safe-access pattern in slightly different ways. These helpers
   pull the facts out so each scoring formula composes them into
   its own policy. */

/* Coinbase-vs-Binance price premium expressed as a percentage of
   the Binance price. A positive number means Coinbase trades at a
   premium — typically a smart-money inflow signal because U.S.
   institutions transact through Coinbase. Returns null when either
   price is missing, zero, or negative. */
function coinbasePremiumPct(cbpPrice, lastPrice) {
  if (!cbpPrice || !lastPrice || lastPrice <= 0) return null;
  return ((cbpPrice - lastPrice) / lastPrice) * 100;
}

/* Latest "long ratio" (0–1) for top traders on Binance Futures.
   Binance exposes two related streams that we store on the same
   object: top-by-account-count (`.accounts`) and top-by-position-
   size (`.positions`). renderTop3 reads `.accounts` (count-weighted
   smart-money sentiment); loadTrading reads `.positions` (size-
   weighted smart-money commitment). Both pick the freshest entry
   and compare its `.long` field to a threshold. The helper
   defaults to `.accounts` to match renderTop3 — pass 'positions'
   to mimic loadTrading's read.

   Returns the long ratio (0–1) or null when data is missing. */
function topTraderLatestLong(topTradersEntry, field) {
  if (!topTradersEntry) return null;
  var arr = topTradersEntry[field || 'accounts'];
  if (!arr || !arr.length) return null;
  var latest = arr[arr.length - 1];
  if (!latest || typeof latest.long !== 'number') return null;
  return latest.long;
}
