/* NEXUS PRO — Phase 4 backtest harness: per-rule effectiveness
   attribution.

   The motivation, in one sentence: we have a registry of 35
   scoring rules and a 24h-evaluated history of every ULTRA/STRONG
   signal those rules produced — but until this module no one
   could ask "which rules actually predict wins, and which ones
   hurt?". This is the foundation for evidence-based weight tuning
   and for retiring rules that don't earn their place.

   Approach: for each rule in the registry, partition the
   evaluated history into "the rule's tag was present" vs "the
   rule's tag was absent" and compare outcomes. The DELTA between
   the two groups' average gain is the rule's marginal contribution
   to signal quality. A positive delta means "signals where this
   rule fired did better"; a negative delta means the rule is
   actively misleading the scorer.

   This is intentionally a SIMPLE correlation analysis. Causality
   needs a proper A/B test (replay scoreSymbol with the rule
   disabled and compare which signals would still have fired) —
   that's a future PR that requires capturing the input ctx with
   each history entry. For today, correlation is enough to surface
   the obvious wins and losses.

   The function is pure (no I/O, no Date.now in the body —
   injectable via opts.now) so it's trivial to unit-test against
   synthetic histories. Mirrors src/scanner-tag-stats.js but keyed
   by rule.id instead of tag and includes the rule.weight context
   that tag-stats can't surface (it doesn't know about the
   registry). */

'use strict';

const MIN_DEFAULT_SAMPLES = 5;
const DEFAULT_DAYS_BACK = 30;

/* _median: same robust-central-tendency helper scanner-history
   uses for the alpha block. Local copy to keep this module
   require-free. */
function _median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function _round2(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/* computeRuleAttribution(history, rules, opts) — for each rule
   in the registry, splits the evaluated history (within the
   look-back window) into signals where the rule's tag was
   present vs absent, and reports the marginal-gain delta plus
   per-group stats.

   Inputs:
     history  — the scanner-history array. Entries that have not
                been evaluated (no `outcome` field, or older than
                the cutoff) are filtered out.
     rules    — the unified registry's RULES array. Each rule
                with a non-null tag contributes one entry to the
                output's `perRule` map. Rules with `tag: null`
                (the tagless score-only rules introduced in PR F)
                are SKIPPED here because we can't tell from
                scanner-history whether they fired (no tag in the
                tag bag) — they need ctx capture to attribute.
                Filed as a known limitation.
     opts     — { daysBack, minSamples, now }
                daysBack: window in days (default 30)
                minSamples: rules with fewer than this many
                  fired-signals are excluded from the "actionable"
                  rankings but still appear in `perRule` so callers
                  can see the underrepresented entries
                now: injectable timestamp for tests

   Output shape:
     {
       windowDays: N,
       totalEvaluated: M,
       perRule: {
         [ruleId]: {
           tag, weight,                 # from the rule
           fired: count when rule's tag present
           absent: count when rule's tag absent
           firedWinRate, absentWinRate,
           firedAvgGain, absentAvgGain,
           delta: firedAvgGain - absentAvgGain,
           sampleSize: 'sufficient' | 'low' (vs opts.minSamples)
         }
       },
       byTier: { ULTRA: {...same shape...}, STRONG: {...} },
       topPositiveDelta: [ruleId, ...]   # sorted by delta desc
       topNegativeDelta: [ruleId, ...]   # sorted by delta asc
       suspiciousRules: [ruleId, ...]    # POSITIVE-weight rules
                                          # with NEGATIVE delta
                                          # (these are actively
                                          # hurting the scorer)
     }

   Why "suspicious rules" matters: a rule with weight +20 that
   correlates with WORSE outcomes is the worst kind of bug — the
   scoring formula is being pulled in the wrong direction by its
   own weights. Surfacing these is the fastest path to weight-
   tuning ROI. */
function computeRuleAttribution(history, rules, opts) {
  const o = opts || {};
  const days = Number.isFinite(o.daysBack) && o.daysBack > 0 ? o.daysBack : DEFAULT_DAYS_BACK;
  const ts = o.now || Date.now();
  const minSamples =
    Number.isFinite(o.minSamples) && o.minSamples >= 1 ? o.minSamples : MIN_DEFAULT_SAMPLES;
  const cutoff = ts - days * 24 * 60 * 60 * 1000;

  const evaluated = (history || []).filter(
    (h) =>
      h && h.evaluated && h.outcome && h.recordedAt >= cutoff && typeof h.pctChange === 'number'
  );

  const empty = {
    windowDays: days,
    totalEvaluated: 0,
    perRule: {},
    byTier: {},
    topPositiveDelta: [],
    topNegativeDelta: [],
    suspiciousRules: [],
  };

  if (evaluated.length === 0 || !Array.isArray(rules)) return empty;

  /* Walk every rule in the registry. Skip rules with a null tag
     (tagless score-only rules — we can't tell from the persisted
     scanner-history whether they fired). */
  const perRule = {};
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string') continue;
    if (rule.tag === null || rule.tag === undefined) continue;

    const fired = [];
    const absent = [];
    for (const entry of evaluated) {
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      if (tags.indexOf(rule.tag) !== -1) {
        fired.push(entry);
      } else {
        absent.push(entry);
      }
    }

    const firedWins = fired.filter((e) => e.outcome === 'win').length;
    const absentWins = absent.filter((e) => e.outcome === 'win').length;
    const firedAvgGain =
      fired.length > 0 ? fired.reduce((s, e) => s + (e.pctChange || 0), 0) / fired.length : 0;
    const absentAvgGain =
      absent.length > 0 ? absent.reduce((s, e) => s + (e.pctChange || 0), 0) / absent.length : 0;
    const delta = firedAvgGain - absentAvgGain;

    perRule[rule.id] = {
      tag: rule.tag,
      weight: rule.weight,
      fired: fired.length,
      absent: absent.length,
      firedWinRate: fired.length > 0 ? Math.round((firedWins / fired.length) * 100) : 0,
      absentWinRate: absent.length > 0 ? Math.round((absentWins / absent.length) * 100) : 0,
      firedAvgGain: _round2(firedAvgGain),
      absentAvgGain: _round2(absentAvgGain),
      delta: _round2(delta),
      sampleSize: fired.length >= minSamples ? 'sufficient' : 'low',
    };
  }

  /* Ranked views — only include rules with sufficient samples so
     a single-fire fluke doesn't dominate the top-N. The "low"
     entries are still in perRule for transparency. */
  const sufficientEntries = Object.entries(perRule).filter(
    ([, v]) => v.sampleSize === 'sufficient'
  );
  const byDeltaDesc = sufficientEntries.slice().sort((a, b) => b[1].delta - a[1].delta);
  const byDeltaAsc = sufficientEntries.slice().sort((a, b) => a[1].delta - b[1].delta);

  const topPositiveDelta = byDeltaDesc.filter(([, v]) => v.delta > 0).map(([id]) => id);
  const topNegativeDelta = byDeltaAsc.filter(([, v]) => v.delta < 0).map(([id]) => id);

  /* Suspicious rules: positive-weight rules that correlate with
     worse outcomes. These are the highest-priority candidates
     for weight retuning or removal. Threshold: weight > 0 AND
     delta < 0 AND sampleSize sufficient. Sorted by absolute
     magnitude of the divergence (worst first). */
  const suspicious = sufficientEntries
    .filter(([, v]) => v.weight > 0 && v.delta < 0)
    .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta))
    .map(([id]) => id);

  /* Per-tier breakdown — exactly the same analysis, scoped to
     ULTRA or STRONG signals only. Useful because the user trusts
     ULTRA more, so a rule that helps STRONG but hurts ULTRA is
     a different bug than one that hurts both. */
  const byTier = {};
  for (const tier of ['ULTRA', 'STRONG']) {
    const tierEvaluated = evaluated.filter((e) => e.tier === tier);
    if (tierEvaluated.length === 0) continue;
    byTier[tier] = {
      totalEvaluated: tierEvaluated.length,
      perRule: {},
    };
    for (const rule of rules) {
      if (!rule || typeof rule.id !== 'string') continue;
      if (rule.tag === null || rule.tag === undefined) continue;
      const fired = tierEvaluated.filter(
        (e) => Array.isArray(e.tags) && e.tags.indexOf(rule.tag) !== -1
      );
      const absent = tierEvaluated.filter(
        (e) => !(Array.isArray(e.tags) && e.tags.indexOf(rule.tag) !== -1)
      );
      if (fired.length === 0 && absent.length === 0) continue;
      const firedAvg =
        fired.length > 0 ? fired.reduce((s, e) => s + (e.pctChange || 0), 0) / fired.length : 0;
      const absentAvg =
        absent.length > 0 ? absent.reduce((s, e) => s + (e.pctChange || 0), 0) / absent.length : 0;
      byTier[tier].perRule[rule.id] = {
        fired: fired.length,
        absent: absent.length,
        firedAvgGain: _round2(firedAvg),
        absentAvgGain: _round2(absentAvg),
        delta: _round2(firedAvg - absentAvg),
      };
    }
  }

  return {
    windowDays: days,
    totalEvaluated: evaluated.length,
    perRule,
    byTier,
    topPositiveDelta,
    topNegativeDelta,
    suspiciousRules: suspicious,
  };
}

/* computeBacktestSummary(history, rules, opts) — a higher-level
   wrapper that bundles rule attribution + basket-wide alpha
   stats into a single response. This is the shape the
   /api/scanner/backtest endpoint returns. Pure function — no
   I/O. */
function computeBacktestSummary(history, rules, opts) {
  const attribution = computeRuleAttribution(history, rules, opts);

  /* Basket-wide aggregate so the user can compare individual
     rule deltas against the population baseline. */
  const o = opts || {};
  const days = Number.isFinite(o.daysBack) && o.daysBack > 0 ? o.daysBack : DEFAULT_DAYS_BACK;
  const ts = o.now || Date.now();
  const cutoff = ts - days * 24 * 60 * 60 * 1000;
  const evaluated = (history || []).filter(
    (h) =>
      h && h.evaluated && h.outcome && h.recordedAt >= cutoff && typeof h.pctChange === 'number'
  );

  const wins = evaluated.filter((h) => h.outcome === 'win').length;
  const losses = evaluated.filter((h) => h.outcome === 'loss').length;
  const partials = evaluated.length - wins - losses;
  const avgGain =
    evaluated.length > 0
      ? evaluated.reduce((s, h) => s + (h.pctChange || 0), 0) / evaluated.length
      : 0;
  const medianGain = evaluated.length > 0 ? _median(evaluated.map((h) => h.pctChange || 0)) : 0;

  return {
    ...attribution,
    basket: {
      total: evaluated.length,
      wins,
      losses,
      partials,
      winRate: evaluated.length > 0 ? Math.round((wins / evaluated.length) * 100) : 0,
      avgGain: _round2(avgGain),
      medianGain: _round2(medianGain),
    },
  };
}

module.exports = {
  computeRuleAttribution,
  computeBacktestSummary,
  MIN_DEFAULT_SAMPLES,
  DEFAULT_DAYS_BACK,
};
