/* NEXUS PRO — market-direction scoring (scoreDirection, Phase 2).

   The pure, testable extraction of the trend score (ts) and strength
   score (sc) that analyzeCoinRpt computes inline in app.js. Building it
   here lets the audit's two scoring fixes be PROVEN by tests:

   - Group B (bull bias in ts): direction-NEUTRAL factors (volume, VPIN
     flow-toxicity, whale-confidence) no longer add an unconditional
     bullish point — they live in the strength score only. Every remaining
     directional factor is symmetric (mirrored thresholds), so a bullish
     scenario and its exact mirror produce mirrored ts (proven by the
     symmetry test). Thresholds are tunable constants up top.

   - Group C (sc shown as "/10" but maxing ~14): sc is normalized to a true
     0..10 against the max achievable under the LIVE weights, so it can
     never print "12/10" again. It stays a STRENGTH score, not a direction.

   Pure: no globals, no I/O. The caller passes every input (and optionally
   the live weights); the same input yields the same scores. UMD-lite so
   the browser (analyzeCoinRpt) and Node/tests share one implementation. */

'use strict';

/* All declarations are wrapped in an IIFE so the module's top-level const/let
   names — e.g. DEFAULT_WEIGHTS, which src/monitor-state.js ALSO declares — do
   NOT leak into the browser's SHARED global script scope. Plain <script>s share
   one global lexical environment, so the duplicate top-level `const` threw
   "Identifier 'DEFAULT_WEIGHTS' has already been declared" and aborted THIS
   file's execution in every browser (Node gives each module its own scope, so
   the unit tests never caught it) — leaving window.MarketDirection unset and
   the chart conclusion silently stuck on the legacy block. The IIFE makes the
   module collision-proof now and for any future name overlap. */
(function () {
  /* Direction bucket cut points (unchanged from the chart). */
  const TS_STRONG_BULL = 4;
  const TS_BULL = 2;
  const TS_BEAR = -2;
  const TS_STRONG_BEAR = -4;

  /* sc factor weights — mirror src/monitor-state.js DEFAULT_WEIGHTS so the
   normalization denominator matches what the calibrator tunes. */
  const DEFAULT_WEIGHTS = {
    trend: 2,
    whales: 2,
    rsi: 1,
    fr: 1,
    oi: 1,
    vol: 0.5,
    macd: 0.5,
    confluence: 1,
    structure: 1,
    smart: 1,
    flow: 1,
    mood: 0.5,
  };

  /* Max value each factor can contribute to the raw sc (the addSc caps). */
  const MAX_V = {
    trend: 2,
    whales: 2,
    rsi: 1,
    fr: 1,
    oi: 1,
    vol: 0.5,
    macd: 0.5,
    confluence: 1,
    structure: 1,
    smart: 1.5,
    flow: 1.5,
    mood: 1.0,
  };

  function n(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }
  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  /* De-biasing (audit B) widened the raw ts range: the legacy inline calc
   maxed near ±14, but the symmetric two-sided factors here can reach ±29.
   The chart's direction cut points (±2 / ±4), the strength `trend` factor,
   and the scenario tilt were all tuned for the ±14 scale — so feeding them
   the raw ±29 made "Strong Bull/Bear" trigger on far fewer signals and
   saturated the trend factor. scaleTs maps the raw score back onto the
   legacy ±14 scale (linear, sign-preserving, symmetric) so every existing
   threshold keeps the SAME sensitivity it was designed for. Calibration
   fix, not a behaviour change to the thresholds themselves. */
  const RAW_TS_MAX = 29;
  const LEGACY_TS_MAX = 14;
  function scaleTs(rawTs) {
    const r = n(rawTs);
    const scaled = (r / RAW_TS_MAX) * LEGACY_TS_MAX;
    /* round to nearest integer so bucket edges land cleanly, like the old ts */
    return Math.round(scaled);
  }

  function classifyDirection(ts) {
    if (ts >= TS_STRONG_BULL) return 'strong_bull';
    if (ts >= TS_BULL) return 'bull';
    if (ts <= TS_STRONG_BEAR) return 'strong_bear';
    if (ts <= TS_BEAR) return 'bear';
    return 'neutral';
  }

  /* ─── trend score (de-biased, symmetric) ─────────────────────────────
   `i` is a flat input object; every field is read defensively so a
   missing signal contributes 0 (not a fake bullish point). */
  function trendScore(i) {
    i = i || {};
    let ts = 0;

    /* Base technicals — already symmetric. */
    ts += i.price > i.ema20 ? 2 : -2;
    ts += i.price > i.ema50 ? 2 : -2;
    ts += i.ema20 > i.ema50 ? 1 : -1;
    ts += n(i.macd && i.macd.h) > 0 ? 2 : -2;
    if (i.macd && i.macd.cross === 'bull') ts += 2;
    else if (i.macd && i.macd.cross === 'bear') ts -= 2;
    if (i.rsi > 55) ts += 1;
    else if (i.rsi < 45) ts -= 1;

    /* Funding / positioning — symmetric. */
    if (i.fr) {
      if (i.fr.rate < 0) ts += 1;
      else if (i.fr.rate > 0.05) ts -= 1;
    }
    if (i.ls) {
      if (i.ls.ratio > 1.5) ts -= 1;
      else if (i.ls.ratio < 0.8) ts += 1;
    }

    /* Top-trader long fraction — mirrored around 0.5 (was: only +). */
    if (i.topTraders && typeof i.topTraders.long === 'number') {
      const L = i.topTraders.long;
      if (L > 0.58) ts += 2;
      else if (L > 0.53) ts += 1;
      else if (L < 0.42) ts -= 2;
      else if (L < 0.47) ts -= 1;
    }
    /* Smart (top traders) vs retail (global) divergence — both directions. */
    if (
      i.topTraders &&
      i.gLS &&
      typeof i.topTraders.long === 'number' &&
      typeof i.gLS.long === 'number'
    ) {
      if (i.topTraders.long > 0.55 && i.gLS.long < 0.45) ts += 2;
      else if (i.topTraders.long < 0.45 && i.gLS.long > 0.55) ts -= 2;
    }
    /* Coinbase premium — mirrored. */
    if (i.cbPrem && typeof i.cbPrem.pct === 'number') {
      const p = i.cbPrem.pct;
      if (p > 0.3) ts += 2;
      else if (p > 0.1) ts += 1;
      else if (p < -0.3) ts -= 2;
      else if (p < -0.1) ts -= 1;
    }
    /* Bitfinex margin long/short — mirrored. */
    if (i.bfxMargin) {
      const lp = n(i.bfxMargin.longPct);
      const sp = n(i.bfxMargin.shortPct);
      if (lp > 70) ts += 2;
      else if (lp > 60) ts += 1;
      if (sp > 70) ts -= 2;
      else if (sp > 60) ts -= 1;
    }
    /* Hyperliquid vs Binance funding both-sided. */
    if (i.hlFunding && i.fr) {
      if (i.hlFunding.rate < 0 && i.fr.rate < 0) ts += 1;
      else if (i.hlFunding.rate > 0 && i.fr.rate > 0.05) ts -= 1;
    }
    /* Funding-rate history skew — mirrored (negative vs positive count). */
    if (i.frHist && i.frHist.totalCount > 0) {
      const neg = n(i.frHist.negCount);
      const pos = n(i.frHist.totalCount) - neg;
      if (neg >= 7) ts += 2;
      else if (neg >= 5) ts += 1;
      if (pos >= 7) ts -= 2;
      else if (pos >= 5) ts -= 1;
    }
    /* OI buildup — now DIRECTIONAL by price (was: flat-price = +2 bull). */
    if (i.oiHist && n(i.oiHist.growth) > 15) {
      const chg = n(i.priceChangePct);
      if (chg > 1) ts += 2;
      else if (chg < -1) ts -= 2;
    }
    /* Taker buy/sell — symmetric. */
    if (i.taker) {
      if (i.taker.ratio > 1.5) ts += 1;
      else if (i.taker.ratio < 0.6) ts -= 1;
    }
    /* Iceberg — symmetric. */
    if (i.iceberg) {
      if (i.iceberg.signal === 'ICEBERG_BUY') ts += 2;
      else if (i.iceberg.signal === 'ICEBERG_SELL') ts -= 2;
    }
    /* Whale PnL — mirrored. */
    if (i.whalePnL && typeof i.whalePnL.pct === 'number') {
      const p = i.whalePnL.pct;
      if (p > 3) ts += 2;
      else if (p > 1) ts += 1;
      else if (p < -3) ts -= 2;
      else if (p < -1) ts -= 1;
    }
    /* News tone — symmetric. */
    if (i.newsScore && typeof i.newsScore.score === 'number') {
      if (i.newsScore.score > 70) ts += 1;
      else if (i.newsScore.score < 30) ts -= 1;
    }

    /* NOTE — removed from ts (direction-neutral; counted only in the
     strength score): volume ratio, VPIN flow toxicity, whale confidence. */
    return ts;
  }

  /* ─── strength score (normalized to 0..10) ───────────────────────────── */
  function strengthScore(i, ts) {
    i = i || {};
    const W = i.weights || DEFAULT_WEIGHTS;
    const scB = [];
    let sc = 0;
    function addSc(name, v, k) {
      const wt = W[k] || 1;
      const adj = v * (wt / (DEFAULT_WEIGHTS[k] || 1));
      scB.push({ n: name, v: Math.round(adj * 100) / 100, k, raw: v });
      sc += adj;
    }

    const wConf = n(i.wConf);
    const volT = n(i.volT);
    addSc('trend', ts >= 4 ? 2 : ts >= 2 ? 1.5 : ts >= 0 ? 1 : 0, 'trend');
    addSc('whales', wConf >= 60 ? 2 : wConf >= 40 ? 1 : 0, 'whales');
    addSc('rsi', i.rsi >= 30 && i.rsi <= 55 ? 1 : 0.5, 'rsi');
    addSc('fr', i.fr && i.fr.rate < 0 ? 1 : i.fr && i.fr.rate > 0.05 ? 0 : 0.5, 'fr');
    addSc('oi', i.oiPresent ? (n(i.ch4h) > 0 && ts > 0 ? 1 : 0.5) : 0, 'oi');
    addSc('vol', volT > 1.3 ? 0.5 : 0, 'vol');
    addSc('macd', n(i.macd && i.macd.h) > 0 ? 0.5 : 0, 'macd');
    addSc('confluence', i.bullTFs >= 3 ? 1 : i.bullTFs >= 2 ? 0.5 : 0, 'confluence');
    addSc('structure', i.struct === 'HH/HL' ? 1 : i.struct === 'LH/LL' ? 0 : 0.5, 'structure');

    let smartSc = 0;
    if (i.topTraders && i.topTraders.long > 0.55) smartSc += 0.6;
    if (i.cbPrem && i.cbPrem.pct > 0.2) smartSc += 0.5;
    if (i.bfxMargin && i.bfxMargin.longPct > 60) smartSc += 0.4;
    addSc('smart', Math.min(1.5, smartSc), 'smart');

    let flowSc = 0;
    if (i.iceberg && i.iceberg.signal === 'ICEBERG_BUY') flowSc += 0.6;
    if (i.vpinData && i.vpinData.vpin > 0.6) flowSc += 0.5;
    if (i.taker && i.taker.ratio > 1.3) flowSc += 0.4;
    addSc('flow', Math.min(1.5, flowSc), 'flow');

    let moodSc = 0;
    if (typeof i.fgValue === 'number' && i.fgValue >= 40 && i.fgValue <= 70) moodSc += 0.5;
    if (i.newsScore && i.newsScore.score > 55) moodSc += 0.5;
    addSc('mood', Math.min(1.0, moodSc), 'mood');

    /* Normalization denominator: max achievable under the LIVE weights. */
    let scMax = 0;
    Object.keys(MAX_V).forEach((k) => {
      scMax += MAX_V[k] * ((W[k] || 1) / (DEFAULT_WEIGHTS[k] || 1));
    });
    const score10 = scMax > 0 ? Math.min(10, round1((sc / scMax) * 10)) : 0;
    return { sc: Math.round(sc * 100) / 100, scMax: Math.round(scMax * 100) / 100, score10, scB };
  }

  /* Full direction read: de-biased ts (scaled to the legacy ±14 range so the
   cut points stay calibrated) + bucket + normalized strength. `tsRaw` is the
   unscaled symmetric score, exposed for diagnostics. */
  function scoreDirection(input) {
    const tsRaw = trendScore(input);
    const ts = scaleTs(tsRaw);
    const strength = strengthScore(input, ts);
    return {
      ts,
      tsRaw,
      dir: classifyDirection(ts),
      sc: strength.sc,
      scMax: strength.scMax,
      score10: strength.score10,
      scB: strength.scB,
    };
  }

  /* priceTargets — split key levels into upside / downside ladders relative to the
   current price, each ordered by PROXIMITY (nearest first). Powers the pro
   conclusion's scenario map: levels above price are the upside targets, those
   below are the downside targets. Pure: price + [{price,label}] in,
   { up:[], down:[] } out; non-finite / equal-to-price levels are skipped. */
  function priceTargets(price, levels) {
    const p = Number(price);
    const up = [];
    const down = [];
    if (!Number.isFinite(p)) return { up, down }; // no anchor → no meaningful split
    (Array.isArray(levels) ? levels : []).forEach((lv) => {
      if (!lv) return;
      const lp = Number(lv.price);
      if (!Number.isFinite(lp) || lp === p) return;
      (lp > p ? up : down).push({ price: lp, label: lv.label });
    });
    up.sort((a, b) => a.price - b.price);
    down.sort((a, b) => b.price - a.price);
    return { up, down };
  }

  /* candleLevelEvent — did the last CLOSED candle confirm a break of the key
   range? close above resistance = bullish breakout; below support = bearish
   breakdown; else in-range. Lets the pro conclusion say "closed a 4H below
   support $X" instead of a vague "bearish". Pure; a non-finite close is
   in-range (no false break). */
  function candleLevelEvent(close, supp, resist) {
    const c = Number(close);
    if (!Number.isFinite(c)) return { event: 'in_range', level: null };
    const s = Number(supp);
    const r = Number(resist);
    if (Number.isFinite(r) && c > r) return { event: 'break_up', level: r };
    if (Number.isFinite(s) && c < s) return { event: 'break_down', level: s };
    return { event: 'in_range', level: null };
  }

  /* regimeAwareThesis — align the chart's macro verdict with the LIVE market
   regime the scanner already adapts to (momentum in a trend, contrarian/fade
   in a range, risk-off when volatile — src/scanner-regime.js, surfaced on
   /api/all and read client-side as window.__marketRegime). The same signal
   means different things by regime: a breakdown in a trending-down tape is
   high-conviction continuation; the same breakdown in a chop is a fade
   candidate. This nudges the conviction and flags which scenario the regime
   favors so the chart and the scanner stop contradicting each other.

   ONE-DIRECTIONAL by design: the regime frames the conclusion; the conclusion
   never feeds back into regime detection or scanner weights (separate scopes).

   Pure: (thesis + regime signals) in, (adjusted conviction + a state KEY the
   UI localizes) out. A missing/!shaped regime degrades to state 'unknown' with
   the conviction untouched, so the caller renders exactly as before. */
  function regimeAwareThesis(input) {
    const i = input || {};
    const thesisDir = i.thesisDir === 'bull' || i.thesisDir === 'bear' ? i.thesisDir : 'neutral';
    let conv = Number(i.conviction);
    if (!Number.isFinite(conv)) conv = 0;
    const conv0 = conv;
    const regime = i.regime === 'trending' || i.regime === 'ranging' ? i.regime : null;
    const dir = i.direction === 'bull' || i.direction === 'bear' ? i.direction : 'none';
    const riskOff = i.volatility === 'high';

    /* State (the framing the UI explains):
       aligned       — trending, regime direction == thesis (supportive).
       conflict      — trending, regime direction opposes the thesis.
       range_fade    — ranging tape + a directional thesis (false-break risk).
       range_neutral — ranging (or trend w/o a clean direction) + neutral thesis.
       unknown       — no usable regime → no change. */
    let state = 'unknown';
    if (regime === 'trending' && dir !== 'none' && thesisDir !== 'neutral') {
      state = dir === thesisDir ? 'aligned' : 'conflict';
    } else if (regime === 'ranging') {
      state = thesisDir === 'neutral' ? 'range_neutral' : 'range_fade';
    } else if (regime === 'trending') {
      state = 'range_neutral';
    }

    /* Conviction nudges mirror the scanner's momentum-vs-contrarian switch:
     back an aligned trend, trim a counter-trend or a faded-breakout thesis,
     and shave a touch more when the tape is volatile (risk-off). */
    if (state === 'aligned') conv += 1;
    else if (state === 'conflict') conv -= 2;
    else if (state === 'range_fade') conv -= 2;
    if (riskOff) conv -= 1;
    conv = Math.max(0, Math.min(10, Math.round(conv * 10) / 10));

    /* In a range or a conflict the "alternate" (mean-revert / with-the-market)
     leg is no longer secondary — tell the UI to give it equal billing. */
    const basePromote = state === 'range_fade' || state === 'conflict';
    return {
      conviction: conv,
      state,
      basePromote,
      riskOff,
      delta: Math.round((conv - conv0) * 10) / 10,
    };
  }

  /* swingLevels — TESTED support/resistance from real pivots (fractals) instead
     of the raw N-bar high/low. A pivot high tops the `left` bars before and
     `right` bars after it; a pivot low mirrors that. Nearby pivots are clustered
     (within `tol`) into a level whose `touches` count is how many times price
     reversed there — the chart-trader's notion of a real level, and it captures
     S/R polarity flips (a broken resistance becomes support). Returns support
     (clusters below `price`, nearest first) and resistance (above, nearest
     first). Pure: klines [t,o,h,l,c,…] + opts in, levels out. */
  function swingLevels(klines, opts) {
    const o = opts || {};
    const left = Number.isFinite(o.left) ? o.left : 2;
    const right = Number.isFinite(o.right) ? o.right : 2;
    const tol = Number.isFinite(o.tol) ? o.tol : 0.006;
    const price = Number(o.price);
    const kl = Array.isArray(klines) ? klines : [];
    const pivots = [];
    for (let i = left; i < kl.length - right; i++) {
      const row = kl[i];
      if (!row) continue;
      const h = Number(row[2]);
      const l = Number(row[3]);
      if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
      let isHigh = true;
      let isLow = true;
      for (let j = i - left; j <= i + right; j++) {
        if (j === i || !kl[j]) continue;
        const hj = Number(kl[j][2]);
        const lj = Number(kl[j][3]);
        if (Number.isFinite(hj) && hj >= h) isHigh = false;
        if (Number.isFinite(lj) && lj <= l) isLow = false;
      }
      if (isHigh) pivots.push(h);
      if (isLow) pivots.push(l);
    }
    /* cluster sorted pivot prices into { price (avg), touches } within tol */
    const sorted = pivots.slice().sort((a, b) => a - b);
    const clusters = [];
    sorted.forEach((p) => {
      const last = clusters[clusters.length - 1];
      const lastAvg = last ? last.sum / last.touches : 0;
      if (last && Math.abs(p - lastAvg) <= lastAvg * tol) {
        last.sum += p;
        last.touches += 1;
      } else {
        clusters.push({ sum: p, touches: 1 });
      }
    });
    const support = [];
    const resistance = [];
    if (Number.isFinite(price)) {
      clusters.forEach((c) => {
        const lvl = { price: round1(c.sum / c.touches), touches: c.touches };
        if (lvl.price < price) support.push(lvl);
        else if (lvl.price > price) resistance.push(lvl);
      });
    }
    support.sort((a, b) => b.price - a.price); // nearest below first
    resistance.sort((a, b) => a.price - b.price); // nearest above first
    return { support, resistance };
  }

  const MARKET_DIRECTION_API = {
    TS_STRONG_BULL,
    TS_BULL,
    TS_BEAR,
    TS_STRONG_BEAR,
    RAW_TS_MAX,
    LEGACY_TS_MAX,
    DEFAULT_WEIGHTS,
    MAX_V,
    classifyDirection,
    trendScore,
    scaleTs,
    strengthScore,
    scoreDirection,
    priceTargets,
    candleLevelEvent,
    regimeAwareThesis,
    swingLevels,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MARKET_DIRECTION_API;
  }
  /* Set the browser global UNCONDITIONALLY (not in an `else`): if some other
   script has defined a global `module` (a CommonJS shim, a stray top-level
   `var module`, an injected library), the old `else if` branch never ran and
   window.MarketDirection stayed undefined — so the chart's pro-conclusion gate
   (`typeof MarketDirection !== 'undefined'`) failed on EVERY device, fresh ones
   included, and silently rendered the legacy block. Assigning here too is
   harmless in Node (window is undefined) and bulletproof in the browser. */
  if (typeof window !== 'undefined') {
    window.MarketDirection = MARKET_DIRECTION_API;
  }
})();
