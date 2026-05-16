/* NEXUS PRO — server-side scanner history + win-rate tracker.

   The scanner publishes ULTRA / STRONG signals every 30 s but
   nobody was tracking how those signals performed. Without that
   feedback loop the user can't trust the Top 3, and we can't tune
   the weights with any rigour. This module records each new
   high-tier signal, waits 24 h, then compares the entry price to
   what the symbol actually did.

   Storage: data/scanner-history.json — capped at 1000 entries
   (newest wins) so the JSON file never grows beyond ~200 KB. The
   evaluation timer in server.js calls evaluateOpenSignals() every
   five minutes against cache.tickers, marking entries as won /
   lost / partial once their 24-hour window closes.

   Pure functions plus a thin disk wrapper. The wrapper is
   crash-tolerant: a missing or malformed file returns an empty
   array so a fresh boot never throws. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'scanner-history.json');
const MAX_HISTORY = 1000;
const EVAL_AFTER_MS = 24 * 60 * 60 * 1000;
/* Per-symbol re-record cooldown: a symbol can only join the
   history once per hour even if it stays ULTRA. Without this a
   sticky signal would push other entries out of MAX_HISTORY. */
const RECORD_COOLDOWN_MS = 60 * 60 * 1000;
/* Per-entry tag cap. Bounds file growth if a future scoring change
   produces a runaway tag bag. At 30 tags × ~20 bytes × 1000 entries
   the worst-case overhead is ~600 KB. */
const MAX_TAGS = 30;

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.warn('[HISTORY] Load failed:', err.message);
  }
  return [];
}

function saveHistory(history) {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(history));
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (err) {
    console.warn('[HISTORY] Save failed:', err.message);
  }
}

/* recordSignal(history, sig, now) — pure function. Returns the
   (possibly mutated) history array. Only ULTRA / STRONG signals are
   recorded; anything weaker would balloon the file with noise.
   Per-symbol cooldown stops a sticky ULTRA from spamming the log.

   `now` is injectable so tests don't have to patch Date.now().

   The persisted entry includes `tags`: a copy of the signal's tag
   bag (capped at MAX_TAGS to bound file growth). Tags enable later
   per-flag analysis — see docs/SCANNER_PD_THRESHOLDS.md §6 and the
   eventual vps/validate-pd-thresholds.js report. The array is
   defensively copied + capped so a runaway producer cannot bloat
   the history file. */
function recordSignal(history, sig, now) {
  if (!Array.isArray(history)) return [];
  if (!sig || !sig.s || !sig.tier) return history;
  if (sig.tier !== 'ULTRA' && sig.tier !== 'STRONG') return history;
  const ts = now || Date.now();

  /* Cooldown: skip if we already have a non-evaluated entry for
     this symbol within the last hour. */
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.s !== sig.s) continue;
    if (h.evaluated) break; /* older than the open window — fine */
    if (ts - h.recordedAt < RECORD_COOLDOWN_MS) return history;
    break;
  }

  history.push({
    s: sig.s,
    score: sig.score,
    tier: sig.tier,
    entryPrice: sig.price,
    sl: sig.sl || null,
    tp1: sig.tp1 || null,
    tp2: sig.tp2 || null,
    tags: Array.isArray(sig.tags) ? sig.tags.slice(0, MAX_TAGS) : [],
    recordedAt: ts,
    evaluated: false,
  });

  /* Cap the array — drop the oldest entries when full. */
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  return history;
}

/* evaluateOpenSignals(history, prices, now) — pure function.
   Walks the unevaluated entries, marks anything past EVAL_AFTER_MS
   as won / partial_win / partial_loss / loss based on the current
   price snapshot. Returns { history, updated }.

   Outcome ladder:
     pctChange >= +5  → 'win'           (TP1 hit)
     pctChange >= 0   → 'partial_win'   (positive PnL but TP1 missed)
     pctChange > -3   → 'partial_loss'  (small drawdown, SL not hit)
     else             → 'loss'          (SL hit) */
function evaluateOpenSignals(history, prices, now) {
  if (!Array.isArray(history)) return { history: [], updated: 0 };
  const ts = now || Date.now();
  const ticks = prices || {};
  let updated = 0;

  for (const entry of history) {
    if (entry.evaluated) continue;
    if (ts - entry.recordedAt < EVAL_AFTER_MS) continue;

    const currentPriceObj = ticks[entry.s];
    const currentPrice =
      typeof currentPriceObj === 'number'
        ? currentPriceObj
        : currentPriceObj && typeof currentPriceObj.price === 'number'
          ? currentPriceObj.price
          : null;
    if (currentPrice == null || !entry.entryPrice) continue;

    const pctChange = ((currentPrice - entry.entryPrice) / entry.entryPrice) * 100;
    let outcome;
    if (pctChange >= 5) outcome = 'win';
    else if (pctChange >= 0) outcome = 'partial_win';
    else if (pctChange > -3) outcome = 'partial_loss';
    else outcome = 'loss';

    entry.evaluated = true;
    entry.evaluatedAt = ts;
    entry.exitPrice = currentPrice;
    entry.pctChange = Math.round(pctChange * 100) / 100;
    entry.outcome = outcome;
    updated++;
  }

  return { history, updated };
}

/* computeStats(history, daysBack) — aggregates the evaluated
   entries within the last `daysBack` days into the headline stats
   the win-rate card shows. Anything still open or older than the
   window is filtered out. */
function computeStats(history, daysBack, now) {
  const days = daysBack || 7;
  const ts = now || Date.now();
  const cutoff = ts - days * 24 * 60 * 60 * 1000;
  const evaluated = (history || []).filter((h) => h.evaluated && h.recordedAt >= cutoff);

  const empty = {
    totalEvaluated: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    avgGain: 0,
    bestSignal: null,
    worstSignal: null,
    byTier: {},
  };
  if (evaluated.length === 0) return empty;

  const wins = evaluated.filter((h) => h.outcome === 'win');
  const losses = evaluated.filter((h) => h.outcome === 'loss');
  const totalGains = evaluated.reduce((sum, h) => sum + (h.pctChange || 0), 0);

  const sorted = evaluated.slice().sort((a, b) => (b.pctChange || 0) - (a.pctChange || 0));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  const byTier = {};
  for (const tier of ['ULTRA', 'STRONG']) {
    const tierSignals = evaluated.filter((h) => h.tier === tier);
    if (tierSignals.length === 0) continue;
    const tierWins = tierSignals.filter((h) => h.outcome === 'win');
    byTier[tier] = {
      count: tierSignals.length,
      winRate: Math.round((tierWins.length / tierSignals.length) * 100),
      avgGain:
        Math.round(
          (tierSignals.reduce((s, h) => s + (h.pctChange || 0), 0) / tierSignals.length) * 100
        ) / 100,
    };
  }

  return {
    totalEvaluated: evaluated.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round((wins.length / evaluated.length) * 100),
    avgGain: Math.round((totalGains / evaluated.length) * 100) / 100,
    bestSignal: best
      ? { s: best.s, pctChange: best.pctChange, tier: best.tier, recordedAt: best.recordedAt }
      : null,
    worstSignal: worst
      ? { s: worst.s, pctChange: worst.pctChange, tier: worst.tier, recordedAt: worst.recordedAt }
      : null,
    byTier,
    daysBack: days,
  };
}

module.exports = {
  HISTORY_FILE,
  MAX_HISTORY,
  MAX_TAGS,
  EVAL_AFTER_MS,
  RECORD_COOLDOWN_MS,
  loadHistory,
  saveHistory,
  recordSignal,
  evaluateOpenSignals,
  computeStats,
};
