#!/usr/bin/env node
/* NEXUS PRO — L2 weight calibrator (offline, read-only).

   The data-gated step from the self-calibration design
   (docs/SCANNER_SELF_CALIBRATION_DESIGN.md §2). For a given weight profile
   (e.g. 'trend'), this tool:
     1. Filters the persisted history to entries with sanitized ctx + an
        evaluated outcome. For 'trend' / 'v2' it further restricts to entries
        actually surfaced LIVE under that profile (forward signal).
     2. Splits walk-forward: older entries → train, newer → validation.
     3. On TRAIN ONLY, runs a bounded coordinate-descent search over the
        incumbent weight overrides to maximize forward, net-of-fees expectancy
        of the surfaced set.
     4. Evaluates the resulting candidate on the held-out VALIDATION set
        (never touched during optimization).
     5. Emits a human-readable report: incumbent vs candidate on val, diff.

   What it does NOT do (per the L2 design contract):
     - Does NOT modify any live config or weights — only proposes a diff.
     - Does NOT auto-ship. A human reviews + ships the diff via a normal PR.
     - Does NOT use validation data during the search (strict walk-forward).

   Usage (on the VPS or anywhere with the repo):
     node vps/calibrate-weights.js                            # default: trend
     node vps/calibrate-weights.js --profile v2
     node vps/calibrate-weights.js --profile legacy           # sanity test
     node vps/calibrate-weights.js --history /path.json --split 0.6 --cap 15

   buildCandidate / buildReport / _scoreUnderWeights / _evalProfile are pure
   and unit-tested in tests/calibrate-weights.test.js. main() does the I/O. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RULES, THRESHOLDS, WEIGHTS_V2, WEIGHTS_TREND } = require('../src/scoring-rules');

const DEFAULT_MIN_SAMPLE = 30;
const DEFAULT_MIN_VAL = 10;
const DEFAULT_MIN_SURFACED = 5;
const DEFAULT_FEE_PCT = 0.2;
const DEFAULT_SPLIT = 0.7;
const DEFAULT_CAP = 25;
const DEFAULT_DELTAS = [-10, -5, -2, 2, 5, 10];
const DEFAULT_MAX_PASSES = 6;
const STRONG_DEFAULT = (THRESHOLDS && THRESHOLDS.STRONG) || 70;

function _mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
function _round2(x) {
  return Math.round(x * 100) / 100;
}
function _clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/* _scoreUnderWeights(ctx, customWeights) — pure. Mirrors the fold in
   scoring-rules.applyRules() but lets the caller supply an arbitrary per-rule
   weight override map. Missing keys fall back to each rule's native weight,
   matching effectiveWeight() semantics. */
function _scoreUnderWeights(ctx, customWeights) {
  if (!ctx) return 0;
  const w = customWeights || {};
  let s = 0;
  for (const rule of RULES) {
    if (rule.condition(ctx)) {
      s += Object.prototype.hasOwnProperty.call(w, rule.id) ? w[rule.id] : rule.weight;
    }
  }
  return s;
}

/* _evalProfile(entries, weights, opts) — pure. The objective: net-of-fees
   expectancy of the surfaced set. Returns unqualified when fewer than
   `minSurface` entries cleared the score `threshold` — this lets the
   optimizer reject candidates that surface nothing or too little. */
function _evalProfile(entries, weights, opts) {
  const feePct = opts && Number.isFinite(opts.feePct) ? opts.feePct : DEFAULT_FEE_PCT;
  const minSurface = opts && Number.isFinite(opts.minSurface) ? opts.minSurface : 0;
  const threshold = opts && Number.isFinite(opts.threshold) ? opts.threshold : STRONG_DEFAULT;
  const surfaced = entries.filter((h) => _scoreUnderWeights(h.ctx, weights) >= threshold);
  if (surfaced.length < minSurface) {
    return { surfaced: surfaced.length, net: -Infinity, winRate: 0, qualified: false };
  }
  if (surfaced.length === 0) {
    return { surfaced: 0, net: 0, winRate: 0, qualified: false };
  }
  const nets = surfaced.map((h) => h.pctChange - feePct);
  const wins = nets.filter((n) => n > 0).length;
  return {
    surfaced: surfaced.length,
    net: _round2(_mean(nets)),
    winRate: Math.round((wins / nets.length) * 100),
    qualified: true,
  };
}

/* _incumbentFor(profile) — the starting weight map. For 'v2' / 'trend' it's
   the explicit override map (only the rules that profile overrides). For
   'legacy' / unknown we start from every rule's native weight so a sanity
   calibration can search the full space. */
function _incumbentFor(profile) {
  if (profile === 'v2') return Object.assign({}, WEIGHTS_V2);
  if (profile === 'trend') return Object.assign({}, WEIGHTS_TREND);
  const out = {};
  for (const r of RULES) out[r.id] = r.weight;
  return out;
}

/* buildCandidate(history, opts) — PURE. Either { skipped:true, reason } or a
   full result with incumbent + candidate weights and out-of-sample numbers.
   Strict walk-forward: validation is never read during the search. */
function buildCandidate(history, opts) {
  const o = opts || {};
  const profile = o.profile || 'trend';
  const incumbent = o.incumbent || _incumbentFor(profile);
  const feePct = Number.isFinite(o.feePct) && o.feePct >= 0 ? o.feePct : DEFAULT_FEE_PCT;
  const minSample = Number.isFinite(o.minSample) ? o.minSample : DEFAULT_MIN_SAMPLE;
  const minVal = Number.isFinite(o.minVal) ? o.minVal : DEFAULT_MIN_VAL;
  const minSurface = Number.isFinite(o.minSurface) ? o.minSurface : DEFAULT_MIN_SURFACED;
  const splitRatio =
    Number.isFinite(o.split) && o.split > 0 && o.split < 1 ? o.split : DEFAULT_SPLIT;
  const cap = Number.isFinite(o.cap) && o.cap >= 0 ? o.cap : DEFAULT_CAP;
  const deltas = Array.isArray(o.deltas) ? o.deltas : DEFAULT_DELTAS;
  const maxPasses = Number.isFinite(o.maxPasses) ? o.maxPasses : DEFAULT_MAX_PASSES;
  const threshold = Number.isFinite(o.threshold) ? o.threshold : STRONG_DEFAULT;
  const evalOpts = { feePct, minSurface, threshold };

  /* 1) Filter. We require ctx (sanitized snapshot) + an evaluated outcome.
        For 'trend' / 'v2' we restrict to entries surfaced LIVE under that
        profile so we're calibrating on the real forward sample for that
        profile; for 'legacy' / other we use the whole sample. */
  let eligible = (history || []).filter(
    (h) => h && h.evaluated && h.outcome && typeof h.pctChange === 'number' && h.ctx
  );
  if (profile === 'trend' || profile === 'v2') {
    eligible = eligible.filter((h) => h.weightsProfile === profile);
  }

  if (eligible.length < minSample) {
    return {
      skipped: true,
      profile,
      reason: 'insufficient eligible — keep accumulating',
      sample: eligible.length,
      threshold: minSample,
    };
  }

  /* 2) Walk-forward split by recordedAt: oldest → train, newest → val. */
  eligible.sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0));
  const cut = Math.floor(eligible.length * splitRatio);
  const train = eligible.slice(0, cut);
  const val = eligible.slice(cut);
  if (val.length < minVal) {
    return {
      skipped: true,
      profile,
      reason: 'insufficient validation slice after split',
      sample: eligible.length,
      trainSize: train.length,
      valSize: val.length,
    };
  }

  /* 3) Coordinate-descent on TRAIN only. Bounded by ±cap from the incumbent's
        per-rule weight (so a runaway optimizer can never produce a wholesale
        rewrite). The deltas grid is small + interpretable on purpose. */
  let bestW = Object.assign({}, incumbent);
  let bestNet = _evalProfile(train, bestW, evalOpts).net;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (const id of Object.keys(incumbent)) {
      for (const d of deltas) {
        const proposed = _clamp(bestW[id] + d, incumbent[id] - cap, incumbent[id] + cap);
        if (proposed === bestW[id]) continue;
        const candW = Object.assign({}, bestW, { [id]: proposed });
        const candNet = _evalProfile(train, candW, evalOpts).net;
        if (candNet > bestNet + 0.001) {
          bestW = candW;
          bestNet = candNet;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  /* 4) Out-of-sample evaluation. Validation is touched ONLY here. */
  const baselineVal = _evalProfile(val, incumbent, evalOpts);
  const candidateVal = _evalProfile(val, bestW, evalOpts);

  /* 5) Diff: only rules whose weight actually moved. */
  const diff = {};
  for (const id of Object.keys(incumbent)) {
    if (bestW[id] !== incumbent[id]) diff[id] = { from: incumbent[id], to: bestW[id] };
  }

  return {
    skipped: false,
    profile,
    eligible: eligible.length,
    trainSize: train.length,
    valSize: val.length,
    incumbent,
    candidateWeights: bestW,
    baselineVal,
    candidateVal,
    diff,
  };
}

/* buildReport(result) — PURE. Human-readable text mirroring the
   scanner-report style so the same eyes can read both. */
function buildReport(result) {
  const L = ['═══ NEXUS PRO — Calibrator (L2) ═══'];
  L.push('Profile: ' + result.profile);
  if (result.skipped) {
    L.push('[SKIPPED] ' + result.reason);
    if (result.sample != null) {
      L.push('  sample=' + result.sample + (result.threshold ? ' < min=' + result.threshold : ''));
    }
    if (result.trainSize != null) {
      L.push('  train=' + result.trainSize + ' val=' + result.valSize);
    }
    L.push('(Data-gated behaviour — keep accumulating forward signals.)');
    return L.join('\n');
  }
  L.push(
    'Eligible: ' +
      result.eligible +
      ' (train ' +
      result.trainSize +
      ', validation ' +
      result.valSize +
      ')'
  );
  L.push('');
  L.push('Out-of-sample (validation, net of fees):');
  const fmt = (p) =>
    p && p.qualified
      ? 'surfaced=' +
        p.surfaced +
        ', net=' +
        (p.net >= 0 ? '+' : '') +
        p.net +
        '%, winRate=' +
        p.winRate +
        '%'
      : '(unqualified: surfaced=' + (p && p.surfaced) + ')';
  L.push('  incumbent : ' + fmt(result.baselineVal));
  L.push('  candidate : ' + fmt(result.candidateVal));

  const ids = Object.keys(result.diff);
  L.push('');
  if (ids.length === 0) {
    L.push('Proposed diff: (none — incumbent already locally optimal on train)');
  } else {
    L.push('Proposed weight diff (capped per-rule):');
    for (const id of ids) {
      L.push('  ' + id + ' : ' + result.diff[id].from + ' → ' + result.diff[id].to);
    }
  }
  L.push('');
  L.push('⚠️  Candidate only — review out-of-sample numbers before shipping via a normal PR.');
  return L.join('\n');
}

function _parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') o.profile = argv[++i];
    else if (a === '--history') o.history = argv[++i];
    else if (a === '--fee') o.feePct = +argv[++i];
    else if (a === '--min-sample') o.minSample = +argv[++i];
    else if (a === '--split') o.split = +argv[++i];
    else if (a === '--cap') o.cap = +argv[++i];
  }
  return o;
}

function main() {
  const args = _parseArgs(process.argv.slice(2));
  const historyPath = args.history || path.join(__dirname, '..', 'data', 'scanner-history.json');
  let history = [];
  try {
    const raw = fs.readFileSync(historyPath, 'utf8');
    history = JSON.parse(raw);
    if (!Array.isArray(history)) throw new Error('not an array');
  } catch (e) {
    console.error('[calibrate] could not read history at ' + historyPath + ' — ' + e.message);
    process.exit(1);
    return;
  }
  const result = buildCandidate(history, args);
  console.log(buildReport(result));
}

if (require.main === module) main();

module.exports = {
  buildCandidate,
  buildReport,
  _scoreUnderWeights,
  _evalProfile,
  _incumbentFor,
  DEFAULT_MIN_SAMPLE,
  DEFAULT_MIN_VAL,
  DEFAULT_MIN_SURFACED,
  DEFAULT_FEE_PCT,
  DEFAULT_SPLIT,
  DEFAULT_CAP,
};
