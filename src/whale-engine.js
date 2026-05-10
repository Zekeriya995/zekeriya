/* NEXUS PRO — server-side whale waves engine.

   data_server.py emits a flat stream of whale transactions (one row
   per filled big trade: { sym, side, value, price, time }). The PWA
   used to fold those rows into per-symbol "waves" — clusters of
   same-direction trades on the same coin within a short window —
   inside the browser, which meant the entire whale section vanished
   when the tab closed and the engine's confidence rank only existed
   on the user's device.

   This module mirrors the same aggregation on the proxy. Output is
   a per-symbol map { totalBuy, totalSell, buyRatio, waves: [...],
   engine: { rank, confidence } } that surfaces through /api/all so
   the PWA renders the whale cards from precomputed state, and the
   wave-detected push trigger fires while the user is offline. */

'use strict';

/* 1-hour window. data_server.py.whales is a rolling list that fills
   slowly during quiet markets — a 10-min window left whaleWaves
   empty for hours at a time even when real waves were forming. An
   hour catches everything the engine considers "current
   accumulation" without crossing into stale territory. */
const WAVE_WINDOW_MS = 60 * 60 * 1000;
const SIGNIFICANT_VALUE = 25_000; /* trades < $25K are filtered as noise */
const TIER_A_BUY = 1_000_000;
const TIER_B_BUY = 500_000;
const TIER_C_BUY = 200_000;

/* aggregateWhales(rawWhales, opts) — pure function. Takes the
   data_server.py.whales list and returns a map keyed by symbol with
   the engine state the PWA renders. Rows older than `windowMs` are
   ignored so a stale list doesn't keep a dead wave alive. */
function aggregateWhales(rawWhales, opts) {
  const now = (opts && opts.now) || Date.now();
  const windowMs = (opts && opts.windowMs) || WAVE_WINDOW_MS;
  const out = {};
  if (!Array.isArray(rawWhales)) return out;

  for (const w of rawWhales) {
    if (!w || !w.sym || !w.value || !w.time) continue;
    if (Math.abs(w.value) < SIGNIFICANT_VALUE) continue;
    if (now - w.time > windowMs) continue;
    const sym = String(w.sym).toUpperCase();
    if (!out[sym]) {
      out[sym] = {
        sym,
        totalBuy: 0,
        totalSell: 0,
        buyCount: 0,
        sellCount: 0,
        waves: [],
        firstTs: w.time,
        lastTs: w.time,
      };
    }
    const e = out[sym];
    if (w.side === 'buy') {
      e.totalBuy += w.value;
      e.buyCount++;
    } else if (w.side === 'sell') {
      e.totalSell += w.value;
      e.sellCount++;
    }
    e.waves.push({
      side: w.side,
      value: w.value,
      price: w.price,
      time: w.time,
    });
    if (w.time < e.firstTs) e.firstTs = w.time;
    if (w.time > e.lastTs) e.lastTs = w.time;
  }

  /* Compute the rank/confidence for each symbol. The thresholds
     mirror the PWA's whale card so the two views agree on what
     counts as Tier A / B / C. */
  for (const sym in out) {
    const e = out[sym];
    const total = e.totalBuy + e.totalSell;
    const buyRatio = total > 0 ? e.totalBuy / total : 0;
    let rank = '—';
    let confidence = 0;
    if (e.totalBuy >= TIER_A_BUY && buyRatio >= 0.7) {
      rank = 'A';
      confidence = 90;
    } else if (e.totalBuy >= TIER_B_BUY && buyRatio >= 0.6) {
      rank = 'B';
      confidence = 70;
    } else if (e.totalBuy >= TIER_C_BUY && buyRatio >= 0.55) {
      rank = 'C';
      confidence = 55;
    } else if (e.totalSell >= TIER_B_BUY && buyRatio <= 0.3) {
      rank = 'D';
      confidence = 60; /* heavy distribution */
    }
    e.buyRatio = Math.round(buyRatio * 1000) / 10; /* percent w/ 1 decimal */
    e.engine = {
      rank,
      confidence,
      totalBuy: e.totalBuy,
      totalSell: e.totalSell,
      buyRatio: e.buyRatio,
      windowMs,
      refreshedAt: now,
    };
    /* Sort waves newest-first for the card render path. */
    e.waves.sort((a, b) => b.time - a.time);
    /* Cap waves so the snapshot doesn't blow up on a busy day. */
    if (e.waves.length > 30) e.waves.length = 30;
  }

  return out;
}

/* pickRankedWaves(map, limit) — returns the top N symbols by
   confidence then totalBuy, for the alert / card-list paths. */
function pickRankedWaves(map, limit) {
  const arr = Object.values(map || {});
  arr.sort((a, b) => {
    const conf = (b.engine.confidence || 0) - (a.engine.confidence || 0);
    if (conf !== 0) return conf;
    return (b.totalBuy || 0) - (a.totalBuy || 0);
  });
  return arr.slice(0, limit || 10);
}

module.exports = {
  WAVE_WINDOW_MS,
  SIGNIFICANT_VALUE,
  TIER_A_BUY,
  TIER_B_BUY,
  TIER_C_BUY,
  aggregateWhales,
  pickRankedWaves,
};
