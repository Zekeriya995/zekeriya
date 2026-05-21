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

const pdDetector = require('./scanner-pd-detector');
const atrZonesModule = require('./scanner-atr-zones');
const scoringRules = require('./scoring-rules');

/* Server-side P&D detector kill-switch. Default ON; set
   SCANNER_SERVER_PD_ENABLED=false in the env for instant rollback
   without removing the wiring. Read once at module load — pm2
   restart required to flip. See SCANNER_AUDIT_2026_05_15.md §8.1
   decision D and docs/SCANNER_PD_THRESHOLDS.md. */
const PD_DETECTOR_ENABLED = process.env.SCANNER_SERVER_PD_ENABLED !== 'false';

/* Phase 2.A.4 — ATR-aware SL/TP kill switch. When ON, scoreSymbol
   uses ctx.indicator.atr (when present) to compute volatility-
   aware stop/target bounds via scanner-atr-zones. When OFF (or
   no ATR for the symbol), falls back to the fixed -3% / +5% / +10%
   ladder. Default ON. */
const ATR_ZONES_ENABLED = process.env.SCANNER_SERVER_ATR_ZONES !== 'false';

/* Phase 2.A.4.b — Tier-aware ATR multipliers kill switch. When ON,
   passes isTier1 through to atrZones so tier-1 majors (BTC/ETH/etc.)
   get the tighter TIER1_MULTS (stop=1.2, tp1=1.8, tp2=3.0) and the
   rest keep the existing DEFAULT_MULTS (stop=1.5, tp1=3.0, tp2=5.0).
   When OFF, atrZones falls back to its non-tier-1 defaults for every
   symbol — bit-for-bit identical to the pre-2.A.4.b behaviour, so
   flipping the flag is a clean rollback. Default ON.

   Motivation: a 2026-05-20 BTC signal showed TP1 at +6.5% over a
   stated 1-4h window, which is unrealistic for BTC's typical hourly
   range (BTC ATR(14) ~$1,680 means 3 × ATR is roughly a half-day
   move). Tier-1 multipliers tighten this to ~+3.9% — actually
   reachable in the displayed window. Non-tier-1 alts can still run
   +5% in an hour so they keep the original multipliers. */
const TIER_AWARE_ATR_ENABLED = process.env.SCANNER_TIER_AWARE_ATR_ZONES !== 'false';

/* Manipulation HIGH → tier hard-cap kill-switch (Phase 1.2).
   When ON, any signal whose manipulation verdict is HIGH cannot
   tier above STRONG, even if its raw score would otherwise reach
   ULTRA (>= 100). Without this cap, the existing -15 score
   penalty on HIGH was sometimes recoverable for a strong setup
   and the symbol would still publish as ULTRA — which is exactly
   the failure mode the audit (§2.4) flagged. Default ON; set
   SCANNER_MANIP_HARD_CAP=false to roll back. */
const MANIP_HARD_CAP_ENABLED = process.env.SCANNER_MANIP_HARD_CAP !== 'false';

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
   floor without a matching futures market.

   Constants sourced from the unified registry (Phase 2.A.3 wiring).
   Re-exported as module-local consts so existing references don't
   need to change. */
const WASH_VOLUME_FLOOR = scoringRules.THRESHOLDS.WASH_VOLUME_FLOOR;
const WASH_OI_FLOOR = scoringRules.THRESHOLDS.WASH_OI_FLOOR;

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
   in app.js so the two views agree on what counts as "ULTRA".
   Thresholds sourced from the unified registry (Phase 2.A.3
   wiring); a future PR migrates app.js's _tierFromScore to import
   the same constants. */
function _tierFromScore(score) {
  if (score >= scoringRules.THRESHOLDS.ULTRA) return 'ULTRA';
  if (score >= scoringRules.THRESHOLDS.STRONG) return 'STRONG';
  if (score >= scoringRules.THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'WEAK';
}

/* Manipulation risk — soft warning layer on top of the hard
   wash-trade reject. The reject in scoreSymbol kills the obvious
   $0-OI cases; this scores everything else along a 0-100 risk axis
   built from four orthogonal red flags any one of which is
   suspicious but not damning. The verdict / risk number gets
   surfaced on the signal so the UI can show "⚠️ medium manipulation
   risk" without us having to drop the symbol entirely. */
function _computeManipulationRisk(sym, d, ctx, isTier1) {
  let risk = 0;
  const reasons = [];

  /* Volume vs Open Interest mismatch — same fingerprint as the
     hard reject but at a more lenient threshold. $100M spot with
     under $1M perp OI is unusual; the wash reject catches the
     extreme version ($500M / $100K). */
  const oiUsd = typeof ctx.oi === 'number' ? ctx.oi : null;
  if (!isTier1 && oiUsd !== null && d.volume > 100_000_000 && oiUsd < 1_000_000) {
    risk += 30;
    reasons.push('vol/oi gap');
  }

  /* Penny-priced non-major. A $0.01 wick is 1% of the price — easy
     for a single market maker to engineer. Tier-1 majors are
     exempt because their price level is set by spot demand, not by
     a few orderbook trades. */
  if (!isTier1 && d.price > 0 && d.price < 0.01) {
    risk += 15;
    reasons.push('penny price');
  }

  /* Funding rate beyond ±50% (likely an annualised snapshot of an
     extreme cross-market spread, but either way: nobody trading a
     healthy perp pays / receives that). The 8% threshold the
     scanner already uses for FR⚠️ is intraday; this catches the
     truly absurd cases the existing logic ignores. */
  if (ctx.fr && typeof ctx.fr.rate === 'number' && Math.abs(ctx.fr.rate) > 0.5) {
    risk += 20;
    reasons.push('extreme funding');
  }

  /* Extreme order-book imbalance. A normal book sits within 2-3×;
     20× either side is a wall, often a spoof. The existing
     bid-wall +8 fires at 1.8× because that's a real signal up to
     a point — past 20× we should distrust the book, not reward
     it. */
  if (ctx.depth && ctx.depth.bids && ctx.depth.asks) {
    let bTotal = 0;
    let aTotal = 0;
    for (let i = 0; i < ctx.depth.bids.length; i++) {
      bTotal += parseFloat(ctx.depth.bids[i][0]) * parseFloat(ctx.depth.bids[i][1]);
    }
    for (let i = 0; i < ctx.depth.asks.length; i++) {
      aTotal += parseFloat(ctx.depth.asks[i][0]) * parseFloat(ctx.depth.asks[i][1]);
    }
    if (aTotal > 0 && bTotal > 0) {
      const ratio = bTotal / aTotal;
      if (ratio > 20 || ratio < 0.05) {
        risk += 20;
        reasons.push('book imbalance');
      }
    }
  }

  let verdict;
  if (risk >= 50) verdict = 'HIGH';
  else if (risk >= 25) verdict = 'MEDIUM';
  else verdict = 'LOW';

  return { risk: Math.min(100, risk), reasons, verdict };
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
  /* Optional ctx._rejectionSink — when present, scoreSymbol increments
     a category counter on each rejection path. Backward compatible:
     callers that don't pass a sink get the original behavior, and the
     score/tags output is unchanged either way. Used by Phase 3.2's
     gate-rejection telemetry (/api/scanner/insights). */
  const sink = ctx._rejectionSink || null;

  const d = ctx.ticker;
  if (!d || !d.price || d.price <= 0) {
    if (sink) sink.noPrice++;
    return null;
  }
  if (d.change >= 8) {
    if (sink) sink.overheated++;
    return null;
  }

  const isTier1 = TIER1_SYMBOLS.has(sym);
  const minVol = isTier1 ? 1_000_000 : 5_000_000;
  if (d.volume < minVol) {
    if (sink) sink.lowVolume++;
    return null;
  }

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
    if (sink) sink.washTrade++;
    return null;
  }

  let score = 0;
  const tags = [];

  /* Phase 2.A.1 PR A — five rules migrated to the unified registry.
     TIER1_BONUS, NEW_BONUS, SILENT_ACCUMULATION, EARLY_ENTRY, STEALTH
     all live in src/scoring-rules.js now. The inline replacements that
     were here previously have been deleted; the contract test in
     tests/scoring-rules.test.js pins the exact weights / conditions /
     tags so any drift fails CI. Future PRs migrate the rest of the
     rule bag here in small batches (per docs/SCANNER_UNIFIED_RULES_REGISTRY_DESIGN.md
     §4 "parity ratchet"). */
  /* PR D additions: frRate, lsRatio, coinalyzeFRRate let the
     registry run FR_VERY_NEG / FR_MILDLY_NEG / FR_OVEREXTENDED /
     LS_SHORTS / COINALYZE_FR_NEG.

     PR E additions: mtfStrength, mtfBias, rsi, macdCross let
     the registry run MTF_*_FULL / MTF_*_PARTIAL / RSI_OS /
     RSI_OB / MACD_BULL_CROSS / MACD_BEAR_CROSS.

     Each strict-checks its ctx field so missing data (e.g.
     ctx.fr === null when futures data hasn't loaded, or
     ctx.indicator === null when no kline fetch covers this
     symbol) cleanly no-ops the corresponding rules. All inline
     replacements have been deleted from this file now that the
     registry owns them. */
  const _ind = ctx.indicator || null;
  const _mtf = ctx.mtfAgreement || null;
  const _macd = _ind && _ind.macd ? _ind.macd : null;
  /* PR G additions: high, low, price, takerAvg, takerRatio,
     coinalyzeOIValue let the registry run AT_HIGH / BOTTOM /
     TAKER_SKEW / COINALYZE_OI. */
  const registryResult = scoringRules.applyRules({
    isTier1: isTier1,
    volume: d.volume,
    change: d.change,
    high: typeof d.high === 'number' ? d.high : undefined,
    low: typeof d.low === 'number' ? d.low : undefined,
    price: typeof d.price === 'number' ? d.price : undefined,
    frRate: ctx.fr && typeof ctx.fr.rate === 'number' ? ctx.fr.rate : undefined,
    lsRatio: ctx.ls && typeof ctx.ls.ratio === 'number' ? ctx.ls.ratio : undefined,
    coinalyzeFRRate:
      ctx.coinalyzeFR && typeof ctx.coinalyzeFR.rate === 'number'
        ? ctx.coinalyzeFR.rate
        : undefined,
    coinalyzeOIValue:
      ctx.coinalyzeOI && typeof ctx.coinalyzeOI.value === 'number'
        ? ctx.coinalyzeOI.value
        : undefined,
    takerAvg: ctx.taker && typeof ctx.taker.avg === 'number' ? ctx.taker.avg : undefined,
    takerRatio: ctx.taker && typeof ctx.taker.ratio === 'number' ? ctx.taker.ratio : undefined,
    mtfStrength: _mtf ? _mtf.strength : undefined,
    mtfBias: _mtf ? _mtf.agreement : undefined,
    rsi: _ind && typeof _ind.rsi === 'number' ? _ind.rsi : undefined,
    macdCross: _macd && typeof _macd.cross === 'string' ? _macd.cross : undefined,
  });
  score += registryResult.scoreDelta;
  for (const t of registryResult.tagsDelta) tags.push(t);

  /* Change bands + late-entry penalties + Volume tiers — all
     migrated to the unified registry in PR F (CHANGE_RISING /
     CHANGE_LATE / CHANGE_PENALTY_GT3 / CHANGE_PENALTY_GT5 /
     VOL_MEGA / VOL_HIGH / VOL_NORMAL). See src/scoring-rules.js. */

  /* AT_HIGH (near-daily-high breakout), BOTTOM (bottom-of-range
     buying), FR/LS chain, TAKER_SKEW — all migrated to the
     unified registry in PR D + PR G. See src/scoring-rules.js. */

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

  /* OI building (multi-exchange aggregated) — migrated to the
     unified registry in PR G as COINALYZE_OI. See
     src/scoring-rules.js. */

  /* Multi-exchange FR negative — migrated to the unified registry
     in PR D (COINALYZE_FR_NEG). See src/scoring-rules.js. */

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

  /* Multi-timeframe agreement, RSI bands, MACD cross — migrated
     to the unified registry in PR E (MTF_BULL_FULL / MTF_BULL_PARTIAL
     / MTF_BEAR_FULL / MTF_BEAR_PARTIAL / RSI_OS / RSI_OB /
     MACD_BULL_CROSS / MACD_BEAR_CROSS). See src/scoring-rules.js.

     The MACD-histogram-vs-signal-line tie-breaker (+3 / -3 with
     NO tag) remains inline below — it's a tagless score-only
     adjustment that doesn't fit the current registry rule shape
     (would need a `tag: null` rule with the existing weight
     model, which is supported but felt out of scope for this
     batch). Future PR may migrate it. */
  if (ctx.indicator && ctx.indicator.macd) {
    const _m = ctx.indicator.macd;
    if (
      typeof _m.h === 'number' &&
      typeof _m.signal === 'number' &&
      _m.cross !== 'bull' &&
      _m.cross !== 'bear'
    ) {
      if (_m.h > _m.signal) {
        score += 3;
      } else if (_m.h < _m.signal) {
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

  /* Manipulation risk. Soft layer on top of the wash-trade reject
     — surfaces a score + verdict + reasons on every signal so the
     UI can warn the user about gray-zone symbols without us having
     to drop them entirely. HIGH risk earns a -15 score adjustment
     and a 🚨 tag; MEDIUM gets -5 and a ⚠️ tag; LOW is silent. */
  const manip = _computeManipulationRisk(sym, d, ctx, isTier1);
  if (manip.verdict === 'HIGH') {
    score -= 15;
    tags.push('🚨MANIP_HIGH');
  } else if (manip.verdict === 'MEDIUM') {
    score -= 5;
    tags.push('⚠️MANIP_MED');
  }

  /* Pump & Dump risk detector (Phase 1.1). Mirrors the client-side
     detector at app.js:2459-2476 so the server never publishes an
     ULTRA push on a coin that the client would have suppressed.
     Today only FR_EXTREME and LS_RETAIL_LONG are reachable on the
     server — see src/scanner-pd-detector.js header for why
     VERTICAL / SMART_VS_RETAIL / THIN_PUMP are dormant in this PR.
     Behind PD_DETECTOR_ENABLED so we can roll back instantly via
     SCANNER_SERVER_PD_ENABLED=false. */
  if (PD_DETECTOR_ENABLED) {
    const pd = pdDetector.detectPumpAndDump({
      change: d.change,
      volume: d.volume,
      fr: ctx.fr,
      ls: ctx.ls,
      globalLs: ctx.globalLs,
      topTraders: ctx.topTraders,
    });
    if (pd.flags.length >= 3) {
      score = pdDetector.applyToScore(score, pd);
      tags.push('🚨P&D_RISK:' + pd.count + '/5');
    } else if (pd.flags.length === 2) {
      score = pdDetector.applyToScore(score, pd);
      tags.push('⚠️P&D_WARN:' + pd.count + '/5');
    }
  }

  /* Risk/Reward levels. Computing them server-side means the PWA
     can render entry/SL/TP cards without re-deriving the maths on
     every device, and downstream consumers (Paper Trading, push
     payload) get a consistent reference.

     Phase 2.A.4 — when an ATR(14) reading is available on this
     symbol (computed every 60s by indicator-engine on 15m klines
     for the INDICATOR_SYMBOLS short-list), use it for volatility-
     aware bounds. Otherwise fall back to the legacy fixed-percent
     ladder so coins outside the indicator coverage keep working.

     The ATR path is gated by SCANNER_SERVER_ATR_ZONES so it can be
     flipped off without redeploy if the new bounds cause issues. */
  const atrInput =
    ATR_ZONES_ENABLED && ctx.indicator && typeof ctx.indicator.atr === 'number'
      ? ctx.indicator.atr
      : null;
  /* Phase 2.A.4.b: pass isTier1 through when the tier-aware flag is
     ON. Otherwise force the option off so atrZones uses its non-tier-1
     defaults regardless of the symbol — keeps rollback bit-exact. */
  const zones = atrInput
    ? atrZonesModule.atrZones(d.price, atrInput, {
        isTier1: TIER_AWARE_ATR_ENABLED && isTier1,
      })
    : null;
  let sl;
  let tp1;
  let tp2;
  let rr;
  if (zones) {
    sl = zones.stop;
    tp1 = zones.tp1;
    tp2 = zones.tp2;
    rr = zones.rr;
    tags.push('📐ATR_ZONES');
    /* Phase 2.A.4.b observability: stamp an extra tag when the
       tier-1 multipliers were actually applied. Lets the Phase 3.1
       tag-stats pipeline answer the post-hoc question "did the
       tighter tier-1 multipliers actually improve win rate?"
       Without this tag the two regimes are indistinguishable in
       historical data. Cheap to add now; impossible to retrofit. */
    if (TIER_AWARE_ATR_ENABLED && isTier1) {
      tags.push('📐ATR_T1');
    }
  } else {
    /* Legacy fixed-percent fallback. -3% / +5% / +10% gives R:R = 1.67. */
    sl = +(d.price * 0.97).toFixed(8);
    tp1 = +(d.price * 1.05).toFixed(8);
    tp2 = +(d.price * 1.1).toFixed(8);
    rr = Math.round((5 / 3) * 100) / 100;
  }

  /* Tier resolution. The score → tier mapping is straightforward
     except for the Phase 1.2 hard-cap: a HIGH manipulation verdict
     downgrades any would-be ULTRA to STRONG so the push trigger
     (which only fires on ULTRA) never alerts users to a sketchy
     coin, no matter how strong the rest of the signal looks.
     Tag the override so the UI can explain the downgrade.

     Intentional: `score` itself is NOT capped, only the published
     tier. A 102-score MANIP_HIGH coin still serves score=102 in
     /api/all so any UI that sorts by raw score keeps the natural
     ordering and the MANIP_CAP tag makes the override explainable.
     Consumers that gate on tier (push trigger, badge color) get
     the demotion; consumers that gate on score do not. */
  let tier = _tierFromScore(score);
  if (MANIP_HARD_CAP_ENABLED && manip.verdict === 'HIGH' && tier === 'ULTRA') {
    tier = 'STRONG';
    tags.push('🚫MANIP_CAP');
  }

  return {
    s: sym,
    score: Math.round(score * 10) / 10,
    tags: tags,
    tier: tier,
    direction: _directionLabel(score, d.change),
    price: d.price,
    change: d.change,
    volume: d.volume,
    manipulationRisk: manip,
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
  /* Phase 3.2 — per-pass rejection telemetry. scoreSymbol increments
     these counters via ctx._rejectionSink; runScannerPass also tracks
     stablecoin and lowScore rejections it owns directly. The shape is
     returned alongside signals so the server can serve it from
     /api/scanner/insights. */
  const rejections = {
    total: 0,
    stablecoin: 0,
    noPrice: 0,
    overheated: 0,
    lowVolume: 0,
    washTrade: 0,
    lowScore: 0,
  };
  for (const sym in tickers) {
    rejections.total++;
    if (STABLE_SET.has(sym)) {
      rejections.stablecoin++;
      continue;
    }
    const mtfEntry = indicatorsMtf[sym];
    const r = scoreSymbol(sym, {
      _rejectionSink: rejections,
      ticker: tickers[sym],
      fr: cache.fr ? cache.fr[sym] : null,
      ls: cache.ls ? cache.ls[sym] : null,
      /* globalLs (Phase 1.x.b) — TRUE retail signal from
         globalLongShortAccountRatio. The P&D detector's
         SMART_VS_RETAIL flag uses this to compare smart-money
         (top traders) against retail-heavy (global accounts). */
      globalLs: cache.globalLs ? cache.globalLs[sym] : null,
      taker: cache.taker ? cache.taker[sym] : null,
      depth: cache.depth ? cache.depth[sym] : null,
      oi: cache.oi ? cache.oi[sym] : null,
      /* topTraders — top-trader POSITION fractions (0..1). Same
         underlying Binance data as cache.ls but in raw unit form
         the P&D detector expects (positions[].long compared against
         the < 0.4 threshold). Populated alongside cache.ls in
         fetchLongShort(). */
      topTraders: cache.topTraders ? cache.topTraders[sym] : null,
      coinalyzeOI: czOI[sym] || null,
      coinalyzeFR: czFR[sym] || null,
      hyperliquid: hl[sym] || null,
      bitfinex: bfx[sym] || null,
      whaleWave: whaleWaves[sym] || null,
      mtfAgreement: mtfEntry ? mtfEntry.agreement : null,
      indicator: indicators[sym] || null,
      newsSentiment: newsSentiment,
    });
    if (!r) continue; /* already counted in rejections by scoreSymbol */
    if (r.score < scoringRules.THRESHOLDS.WEAK_MIN) {
      rejections.lowScore++;
      continue;
    }
    results.push(r);
  }
  results.sort((a, b) => b.score - a.score);
  return {
    signals: results,
    top3: results.slice(0, 3),
    rejections: rejections,
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
