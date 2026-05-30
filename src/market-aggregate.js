/* NEXUS PRO — market-direction data aggregation (the hybrid data layer).

   Pure core of the Market Direction data layer: takes per-venue funding /
   OI (Binance + Bybit + OKX) plus a per-source health map and produces a
   normalized MarketDirectionSnapshot where every signal carries provenance
   and a soft confidence. No I/O, no globals, no time-of-day — the caller
   passes `now` — so the same input yields the same snapshot.

   Locked decisions this implements:
   - D1  venues: binance + bybit + okex for funding / OI.
   - D3  TTLs drive the staleness term of confidence (funding 5m, OI 1m,
         news 3m).
   - D4  options deferred in v1 (depth endpoint was gated, error 97).
   - D5  confidence is SOFT: a 0..1 multiplier (liveness × staleness ×
         agreement), never a hard gate. A 1-of-3-venue read is weaker, not
         silently dropped — the direct fix for the audit's silent
         degradation.

   See docs/MARKET_DIRECTION_DATA_LAYER_DESIGN.md (§5 schema, §7 rules). */

'use strict';

/* D3 — per-signal freshness budgets. Confidence halves at one TTL and
   reaches zero at two, so a stale venue fades instead of lying. */
const TTL = {
  funding: 5 * 60 * 1000,
  oi: 60 * 1000,
  news: 3 * 60 * 1000,
};

/* Binance-style funding prints per 8h; annualize across 3 windows/day. */
const FUNDING_WINDOWS_PER_YEAR = 3 * 365;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function sign(x) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function round2(x) {
  return Math.round(x * 100) / 100;
}

/* Cross-venue agreement in [0,1]: half sign-concordance (do venues agree
   on direction?) and half magnitude tightness (how close are the values?).
   One venue → 1 (nothing to disagree with); none → 0. */
function computeAgreement(values) {
  const v = (values || []).map(num).filter((x) => x !== null);
  if (v.length < 2) return v.length ? 1 : 0;
  const m = mean(v);
  const mn = Math.min.apply(null, v);
  const mx = Math.max.apply(null, v);
  const concordant = v.filter((x) => sign(x) === sign(m)).length / v.length;
  const magnitude = m !== 0 ? clamp01(1 - (mx - mn) / (2 * Math.abs(m))) : mx === mn ? 1 : 0;
  return round2(0.5 * concordant + 0.5 * magnitude);
}

/* Read a per-venue map whose values are either a scalar or an object with
   `field` (e.g. { binance: 0.00005 } or { binance: { rate: 0.00005 } }). */
function readVenues(perVenue, field) {
  const out = {};
  const obj = perVenue || {};
  Object.keys(obj).forEach((k) => {
    const raw = obj[k];
    const val = num(raw && typeof raw === 'object' ? raw[field] : raw);
    if (val !== null) out[k] = val;
  });
  return out;
}

/* Funding aggregate — volume-weighted mean when every venue carries a
   positive `weight`, else an equal-weight mean. */
function aggregateFunding(perVenue) {
  const venues = readVenues(perVenue, 'rate');
  const names = Object.keys(venues);
  if (!names.length) return null;
  const vals = names.map((k) => venues[k]);
  const weights = names.map((k) => {
    const raw = perVenue[k];
    return num(raw && typeof raw === 'object' ? raw.weight : null);
  });
  let value;
  if (weights.every((w) => w !== null && w > 0)) {
    let wsum = 0;
    let acc = 0;
    names.forEach((k, i) => {
      wsum += weights[i];
      acc += venues[k] * weights[i];
    });
    value = acc / wsum;
  } else {
    value = mean(vals);
  }
  return {
    value,
    annualizedPct: round2(value * FUNDING_WINDOWS_PER_YEAR * 100),
    perVenue: venues,
    agreement: computeAgreement(vals),
    venues: names.length,
  };
}

/* OI aggregate — SUM of notional across venues (total open positioning),
   not a mean. */
function aggregateOI(perVenue) {
  const venues = readVenues(perVenue, 'valueUsd');
  const names = Object.keys(venues);
  if (!names.length) return null;
  let sum = 0;
  names.forEach((k) => {
    sum += venues[k];
  });
  return { valueUsd: sum, perVenue: venues, venues: names.length };
}

/* D5 — soft confidence in [0,1]: liveness × staleness × agreementFactor.
   - liveness: liveVenues / totalVenues (or 1 when `live` is set for
     single-source signals like news).
   - staleness: 1 at age 0, 0.5 at one TTL, 0 at two TTLs.
   - agreementFactor: maps agreement∈[0,1] onto [0.5,1] so disagreement
     dampens but never zeroes a signal. */
function confidenceFor(opts) {
  const o = opts || {};
  let liveness;
  if (o.totalVenues > 0) liveness = clamp01((o.liveVenues || 0) / o.totalVenues);
  else liveness = o.live ? 1 : 0;
  let staleness = 1;
  if (num(o.ageMs) !== null && num(o.ttlMs) && o.ttlMs > 0) {
    staleness = clamp01(1 - o.ageMs / (2 * o.ttlMs));
  }
  const agreement = num(o.agreement) !== null ? clamp01(o.agreement) : 1;
  return round2(liveness * staleness * (0.5 + 0.5 * agreement));
}

/* Per-source health → completeness. `perSource` is { name: { ok, ... } };
   any source without ok:true is reported as degraded. */
function sourceCompleteness(perSource) {
  const ps = perSource || {};
  const names = Object.keys(ps);
  const degraded = [];
  let live = 0;
  names.forEach((n) => {
    if (ps[n] && ps[n].ok) live++;
    else degraded.push(n);
  });
  return {
    sourcesTotal: names.length,
    sourcesLive: live,
    completeness: names.length ? round2(live / names.length) : 0,
    degraded,
    perSource: ps,
  };
}

/* Assemble the MarketDirectionSnapshot (v1). Each present signal gets its
   aggregate + a soft confidence; absent signals are simply omitted (never
   faked). Options are deferred (D4). */
function buildSnapshot(input) {
  const o = input || {};
  const now = num(o.now) || 0;
  const snap = {
    schemaVersion: 1,
    sym: o.sym || null,
    asOf: now,
    price:
      num(o.price) !== null
        ? { value: num(o.price), source: o.priceSource || null, ts: num(o.priceTs), confidence: 1 }
        : null,
    signals: {},
    health: o.perSource ? sourceCompleteness(o.perSource) : o.health || sourceCompleteness({}),
  };

  if (o.funding) {
    const f = aggregateFunding(o.funding);
    if (f) {
      snap.signals.funding = {
        value: f.value,
        annualizedPct: f.annualizedPct,
        perVenue: f.perVenue,
        agreement: f.agreement,
        source: 'venues',
        ts: num(o.fundingTs),
        confidence: confidenceFor({
          liveVenues: f.venues,
          totalVenues: o.fundingTotalVenues || f.venues,
          agreement: f.agreement,
          ageMs: now - (num(o.fundingTs) || now),
          ttlMs: TTL.funding,
        }),
      };
    }
  }

  if (o.oi) {
    const oi = aggregateOI(o.oi);
    if (oi) {
      snap.signals.openInterest = {
        valueUsd: oi.valueUsd,
        perVenue: oi.perVenue,
        source: 'venues',
        ts: num(o.oiTs),
        confidence: confidenceFor({
          liveVenues: oi.venues,
          totalVenues: o.oiTotalVenues || oi.venues,
          ageMs: now - (num(o.oiTs) || now),
          ttlMs: TTL.oi,
        }),
      };
    }
  }

  if (o.news && typeof o.news === 'object') {
    snap.signals.news = Object.assign({ source: 'news' }, o.news, {
      ts: num(o.newsTs),
      confidence: confidenceFor({ live: 1, ageMs: now - (num(o.newsTs) || now), ttlMs: TTL.news }),
    });
  }

  /* D4 — options deferred in v1 (depth/options endpoints gated). */
  snap.signals.options = { available: false, reason: 'deferred_v1' };

  return snap;
}

module.exports = {
  TTL,
  FUNDING_WINDOWS_PER_YEAR,
  computeAgreement,
  aggregateFunding,
  aggregateOI,
  confidenceFor,
  sourceCompleteness,
  buildSnapshot,
  _num: num,
};
