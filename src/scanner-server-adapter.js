/* NEXUS PRO — Phase 2.A.2 server-signal adapter.

   Adapts a server-side scanner signal (the shape returned by
   scoreSymbol() in src/scanner-engine.js, exposed via /api/all.signals)
   to the client-side signal shape that loadTrading + qualityFilter +
   renderTop3 in app.js expect (the shape returned by deepAnalyze).

   Audit reference: SCANNER_AUDIT_2026_05_15.md §6 P2.A.2 (Option A,
   PWA reads all.signals). Design notes: docs/SCANNER_PWA_SERVER_SIGNALS_DESIGN.md.

   The two shapes diverge because the client used to run deep-analysis
   enrichment (kline-based VPIN / iceberg / MTF) on top of quickScan
   while the server does not. The adapter is the bridge:

     - Server is canonical for: score, tags, tier, direction, change,
       price, volume, manipulationRisk, sl/tp1/tp2/rr (Phase 2.A.4
       ATR-aware), ULTRA-tier gating.
     - Local cache fills in: whaleConf, waveCount, fr, by, cb,
       priceAtDetection / freshness (sigHist), proven / coinWinRate
       (monitorState.coinStats). These are reads from per-browser state
       the server has no visibility into.
     - Fields the server can't compute today (multi-TF alignment,
       confirmed 15m breakout, VPIN, iceberg, absorption) are returned
       as null / false / 0. Consumers must already tolerate missing
       enrichment because deepAnalyze itself can return signals with
       kl15Available=false (kline fetch failed) — the renderer's
       defensive null-checks already cover this case.

   Loaded via <script> in index.html alongside src/scanner-helpers.js.
   Pure: takes everything through `ctx` so it can be unit-tested
   without booting the PWA. */

/* Tag the adapted signal so renderers / tests can tell whether a
   signal came from the server pass or from a local deepAnalyze. The
   companion local-only tag (🖥️SRC_LOCAL) is appended in app.js's
   deepAnalyze. Keeping the two source labels symmetrical means a
   tag-renderer audit can find every signal whose origin is in
   question with a single grep. */
var SRC_SERVER_TAG = '📡SRC_SERVER';

/* Extracts the integer N from a server P&D tag like '🚨P&D_RISK:3/5'
   or '⚠️P&D_WARN:2/5'. Used by qualityFilterRejectReason to enforce
   the >=3 hard-drop gate without re-running the detector. The regex
   tolerates any prefix glyph(s) and any /total — only the leading
   integer matters. Returns 0 when no PD tag is present. */
function _adapterPdFlagsFromTags(tags) {
  if (!Array.isArray(tags)) return 0;
  for (var i = 0; i < tags.length; i++) {
    var s = String(tags[i] || '');
    var m = s.match(/P&D[^:]*:(\d+)\//);
    if (m) return +m[1] || 0;
  }
  return 0;
}

/* Synthesises the four boolean checks (ob / vol / rsi / oi) that
   loadTrading reads off the result object when it builds reason
   badges. The server doesn't publish these as flags — it publishes
   tags — so we infer presence from the established tag vocabulary:

     ob  — '📗BID:Nx'                              (scanner-engine.js:397)
     vol — '🔥MEGA_VOL' | '📊HIGH_VOL' | '📊VOL'  (scanner-engine.js:325-331)
     rsi — '📉RSI_OS' | '📈RSI_OB'                (scanner-engine.js:494-497)
     oi  — '🌐OI'                                  (scanner-engine.js:404)

   Pattern matching is substring-based on the parts that don't
   collide with other tags. If the tag vocabulary changes server-side
   without updating these patterns, the badges will silently
   disappear from the UI — caught by tests below. */
function _adapterChecksFromTags(tags) {
  var c = { ob: false, vol: false, rsi: false, oi: false };
  if (!Array.isArray(tags)) return c;
  for (var i = 0; i < tags.length; i++) {
    var s = String(tags[i] || '');
    if (!c.ob && s.indexOf('BID') !== -1) c.ob = true;
    if (!c.vol && s.indexOf('VOL') !== -1) c.vol = true;
    if (!c.rsi && s.indexOf('RSI') !== -1) c.rsi = true;
    if (!c.oi && s.indexOf('🌐OI') !== -1) c.oi = true;
  }
  return c;
}

function _adapterPassedFromChecks(checks) {
  var n = 0;
  if (checks.ob) n++;
  if (checks.vol) n++;
  if (checks.rsi) n++;
  if (checks.oi) n++;
  return n;
}

/* Compute freshness ("fresh" / "warm" / "old") from the local sigHist
   record for this symbol. Mirrors the policy in deepAnalyze
   (app.js:2738-2740) so the two code paths render the same colour.
   - "old"   when ageMinutes > 60 OR |changeFromDetection| > 5
   - "warm"  when ageMinutes > 15 OR |changeFromDetection| > 2
   - "fresh" otherwise (including the no-record-yet case) */
function _adapterFreshness(ageMinutes, changeFromDetection) {
  var absChange = Math.abs(changeFromDetection || 0);
  if (ageMinutes > 60 || absChange > 5) return 'old';
  if (ageMinutes > 15 || absChange > 2) return 'warm';
  return 'fresh';
}

/* Build the client-shape signal from a single server signal.
   Returns null when the input is missing the symbol field — callers
   should filter null entries with .filter(Boolean).

   ctx shape (all optional; missing fields fall back to safe defaults):
     ticker         — T[s]               (local price/change/volume fallback)
     fr             — FR[s]              (raw funding-rate object)
     cb             — CBP[s]             (Coinbase premium)
     whaleWave      — whaleWaves[s]      (engine.confidence + waves array)
     sigInfo        — sigHist[s+'_trade']
     provenStatus   — { proven, rate }   from evaluateProvenStatus(monitorState.coinStats[s])
     now            — Date.now() override for deterministic tests */
function adaptServerSignalToClient(serverSig, ctx) {
  if (!serverSig || typeof serverSig !== 'object') return null;
  if (!serverSig.s) return null;
  ctx = ctx || {};
  var ticker = ctx.ticker || {};
  var now = typeof ctx.now === 'number' ? ctx.now : Date.now();

  /* Defensive copy + de-duplicated source tag. Never push duplicates
     so re-adapting a previously-adapted signal (rare but possible
     after a /api/all loop) doesn't bloat the tag-bag. */
  var tags = Array.isArray(serverSig.tags) ? serverSig.tags.slice() : [];
  if (tags.indexOf(SRC_SERVER_TAG) === -1) tags.push(SRC_SERVER_TAG);

  var checks = _adapterChecksFromTags(tags);
  var passed = _adapterPassedFromChecks(checks);

  var price =
    typeof serverSig.price === 'number' && serverSig.price > 0
      ? serverSig.price
      : typeof ticker.p === 'number'
        ? ticker.p
        : 0;
  var change =
    typeof serverSig.change === 'number'
      ? serverSig.change
      : typeof ticker.c === 'number'
        ? ticker.c
        : 0;
  var volume =
    typeof serverSig.volume === 'number'
      ? serverSig.volume
      : typeof ticker.v === 'number'
        ? ticker.v
        : 0;

  /* smartEntry mirrors deepAnalyze's shape so loadTrading can read
     entry/stop/target1/target2/rr the same way. When the server
     emitted ATR zones (Phase 2.A.4) the levels are volatility-aware;
     otherwise they're the legacy fixed-percent fallback. Either way
     the shape is identical. */
  var smartEntry = null;
  if (typeof serverSig.sl === 'number' && serverSig.sl > 0 && price > 0) {
    smartEntry = {
      entry: price,
      stop: serverSig.sl,
      target1: serverSig.tp1,
      target2: serverSig.tp2,
      rr: serverSig.rr != null ? String(serverSig.rr) : '0',
    };
  }

  var whaleConf = 0;
  var waveCount = 0;
  var ww = ctx.whaleWave;
  if (ww && ww.engine && typeof ww.engine.confidence === 'number') {
    whaleConf = ww.engine.confidence;
  }
  if (ww && Array.isArray(ww.waves)) waveCount = ww.waves.length;

  var sigInfo = ctx.sigInfo || null;
  var priceAtDetection = sigInfo && sigInfo.priceAtDetection > 0 ? sigInfo.priceAtDetection : price;
  var ageMinutes = sigInfo && sigInfo.firstSeen ? Math.floor((now - sigInfo.firstSeen) / 60000) : 0;
  var changeFromDetection =
    priceAtDetection > 0 ? ((price - priceAtDetection) / priceAtDetection) * 100 : 0;
  var freshness = _adapterFreshness(ageMinutes, changeFromDetection);

  var proven = !!(ctx.provenStatus && ctx.provenStatus.proven);
  var coinWinRate = ctx.provenStatus ? +ctx.provenStatus.rate || 0 : 0;

  var tier = serverSig.tier || '';
  var ultra = tier === 'ULTRA';
  var confirmed = ultra || tier === 'STRONG';

  return {
    s: serverSig.s,
    p: price,
    c: change,
    v: volume,
    score: serverSig.score,
    tags: tags,
    checks: checks,
    passed: passed,
    total: 6,
    ultra: ultra,
    confirmed: confirmed,
    fr: ctx.fr || null,
    by: ticker.by || null,
    cb: ctx.cb != null ? ctx.cb : null,
    whaleConf: whaleConf,
    waveCount: waveCount,
    smartEntry: smartEntry,
    /* tfAlign/confirmedBreakout/kl15Available/atr15m are deep-analyze
       enrichments the server doesn't compute. Renderers gate on these
       with `if(x.checks && ...)` and `if(x.tfAlign && ...)` so null /
       false / 0 cleanly short-circuit those code paths. */
    tfAlign: null,
    confirmedBreakout: false,
    kl15Available: false,
    atr15m: 0,
    pdFlags: _adapterPdFlagsFromTags(tags),
    proven: proven,
    coinWinRate: coinWinRate,
    detectedAt: sigInfo && sigInfo.firstSeen ? sigInfo.firstSeen : now,
    priceAtDetection: priceAtDetection,
    ageMinutes: ageMinutes,
    changeFromDetection: changeFromDetection,
    freshness: freshness,
    tier: tier,
    direction: serverSig.direction || '',
    manipulationRisk: serverSig.manipulationRisk || null,
    _src: 'server',
  };
}
