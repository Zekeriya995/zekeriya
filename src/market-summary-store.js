/* NEXUS PRO — server-side market-movement monitor + store.

   The always-on half of the movement summary. A server timer samples
   BTC / ETH market state from the existing fetch caches every ~10 min,
   appends to a persisted per-symbol time-series, and regenerates the
   narrative (via the pure engine in src/market-summary.js) on a periodic
   schedule AND the moment direction flips — so the summary keeps updating
   even when no browser is open. This is the "continuous monitoring +
   periodic + on-flip" cadence the design locked in.

   Storage: data/market-summary.json — capped at MAX_SAMPLES per symbol so
   the file stays small. Pure orchestration plus a thin, crash-tolerant
   disk wrapper (a missing / malformed file just resets to empty state),
   mirroring src/scanner-history.js.

   The server only computes price / funding / OI / news that it already
   fetches; direction (`ts`) is a transparent, symmetric 1-hour price
   momentum proxy — NOT the chart's full ts. The data-layer work unifies
   the two later; until then the up / down legs (which come from price)
   are exact and the proxy only drives the flip nuance. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const summary = require('./market-summary');
const accuracy = require('./accuracy');

const STORE_FILE = path.join(__dirname, '..', 'data', 'market-summary.json');
const SYMBOLS = ['BTC', 'ETH'];

/* At most one sample / 10 min per symbol; keep ~33 h of them. */
const SAMPLE_THROTTLE_MS = 10 * 60 * 1000;
const MAX_SAMPLES = 200;
/* Regenerate the narrative at least this often, and always on a flip. */
const REGEN_INTERVAL_MS = 6 * 60 * 60 * 1000;
/* The narrative describes the trailing 24 h. */
const WINDOW_MS = 24 * 60 * 60 * 1000;
/* Direction proxy = price change over the last hour. */
const MOMENTUM_LOOKBACK_MS = 60 * 60 * 1000;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function emptyState() {
  return { v: 1, series: {}, summary: {}, lastRegenAt: 0 };
}

/* ─── disk wrapper (crash-tolerant) ──────────────────────────────── */

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!s || typeof s !== 'object') return emptyState();
    if (!s.series || typeof s.series !== 'object') s.series = {};
    if (!s.summary || typeof s.summary !== 'object') s.summary = {};
    return s;
  } catch (e) {
    return emptyState();
  }
}

function save(state) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(state));
  } catch (e) {
    /* disk full / read-only fs — drop the write, never throw */
  }
}

/* ─── sampling ───────────────────────────────────────────────────── */

/* Symmetric 1-hour price-momentum → ts bucket. Cut points line up with
   classifyDirection so the proxy maps cleanly onto the chart's buckets. */
function momentumTs(series, price, now) {
  if (price === null || price <= 0) return 0;
  let ref = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (now - series[i].t >= MOMENTUM_LOOKBACK_MS) {
      ref = series[i].price;
      break;
    }
  }
  if (ref === null && series.length) ref = series[0].price;
  if (ref === null || ref <= 0) return 0;
  const pct = ((price - ref) / ref) * 100;
  if (pct >= 1) return 4;
  if (pct >= 0.4) return 2;
  if (pct <= -1) return -4;
  if (pct <= -0.4) return -2;
  return 0;
}

/* Build one sample from normalized market data `md`
   ({ price, funding, oi, newsTone, sourcesLive, sourcesTotal }) plus the
   existing series (for OI change and the momentum proxy). Pure. */
function buildSample(series, md, now) {
  const price = num(md.price);
  const oiNow = num(md.oi);
  const prev = series.length ? series[series.length - 1] : null;
  let oiChangePct = null;
  if (prev && num(prev.oi) !== null && num(prev.oi) > 0 && oiNow !== null) {
    oiChangePct = ((oiNow - num(prev.oi)) / num(prev.oi)) * 100;
  }
  const total = num(md.sourcesTotal);
  const live = num(md.sourcesLive);
  const completeness = total && total > 0 && live !== null ? live / total : null;
  return {
    t: now,
    price,
    ts: momentumTs(series, price, now),
    funding: num(md.funding),
    oi: oiNow,
    oiChangePct,
    newsTone: typeof md.newsTone === 'string' ? md.newsTone : null,
    completeness,
  };
}

/* Append a sample for `sym`, throttled and capped. Returns whether one
   was actually recorded. */
function recordSample(state, sym, md, now) {
  if (!state.series[sym]) state.series[sym] = [];
  const series = state.series[sym];
  const last = series.length ? series[series.length - 1] : null;
  if (last && now - last.t < SAMPLE_THROTTLE_MS) return { recorded: false };
  const sample = buildSample(series, md, now);
  if (sample.price === null) return { recorded: false };
  series.push(sample);
  if (series.length > MAX_SAMPLES) state.series[sym] = series.slice(-MAX_SAMPLES);
  return { recorded: true };
}

/* ─── narrative regeneration ─────────────────────────────────────── */

function coinName(sym, lang) {
  if (lang !== 'ar') return sym;
  return sym === 'BTC' ? 'البيتكوين' : sym === 'ETH' ? 'الإيثيريوم' : sym;
}

/* Regenerate the stored AR + EN summary for `sym` over the trailing
   window, and remember the latest direction bucket for flip detection. */
function regenerate(state, sym, now) {
  const series = (state.series[sym] || []).filter((s) => now - s.t <= WINDOW_MS);
  const ar = summary.buildMovementSummary(series, {
    lang: 'ar',
    coinName: coinName(sym, 'ar'),
    sym,
  });
  const en = summary.buildMovementSummary(series, { lang: 'en', coinName: sym, sym });
  const dir = series.length ? summary.sampleBucket(series[series.length - 1]) : 'neutral';
  /* Accuracy loop (audit A) — score the FULL history, not just the 24h
     narrative window, so older calls can be evaluated against their outcome. */
  const acc = accuracy.evaluateAccuracy(state.series[sym] || []);
  state.summary[sym] = {
    ar: { text: ar.text, headline: ar.headline },
    en: { text: en.text, headline: en.headline },
    enough: ar.enough,
    flips: ar.flips,
    dir,
    accuracy: acc,
    at: now,
    samples: series.length,
  };
  state.lastRegenAt = now;
  return state.summary[sym];
}

/* Regenerate when never generated, when the periodic interval has
   elapsed, or when the latest direction bucket differs from the one the
   stored summary was built at (a flip). */
function shouldRegenerate(state, sym, now) {
  const sm = state.summary[sym];
  if (!sm) return true;
  if (now - (sm.at || 0) >= REGEN_INTERVAL_MS) return true;
  const series = state.series[sym] || [];
  if (series.length) {
    const cur = summary.sampleBucket(series[series.length - 1]);
    if (cur !== sm.dir) return true;
  }
  return false;
}

/* One monitor tick: for each symbol with fresh market data, record a
   sample and regenerate if due. Returns whether anything changed (so the
   caller knows to persist). */
function tick(state, mdBySym, now) {
  let changed = false;
  for (let i = 0; i < SYMBOLS.length; i++) {
    const sym = SYMBOLS[i];
    const md = mdBySym ? mdBySym[sym] : null;
    if (!md) continue;
    if (recordSample(state, sym, md, now).recorded) changed = true;
    if (shouldRegenerate(state, sym, now)) {
      regenerate(state, sym, now);
      changed = true;
    }
  }
  if (changed) state.lastTickAt = now;
  return changed;
}

module.exports = {
  STORE_FILE,
  SYMBOLS,
  SAMPLE_THROTTLE_MS,
  MAX_SAMPLES,
  REGEN_INTERVAL_MS,
  WINDOW_MS,
  MOMENTUM_LOOKBACK_MS,
  emptyState,
  load,
  save,
  momentumTs,
  buildSample,
  recordSample,
  regenerate,
  shouldRegenerate,
  tick,
  _num: num,
};
