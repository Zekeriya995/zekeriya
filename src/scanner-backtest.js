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

  /* Phase 4 Part 3: hybrid attribution. For each (rule, entry):
     - If entry.ctx exists AND rule has a condition function,
       replay the condition against the ctx — this is the most
       accurate "did the rule fire?" answer AND it works for
       tagless rules (which tag-based attribution can't see).
     - Else if rule has a tag, use tag-membership in entry.tags
       (the original Part 1 behaviour, kept for backwards compat
       with old entries on disk that don't have ctx).
     - Else (tagless rule with no ctx) → SKIP. We have no way
       to attribute this entry to this rule.

     For TAGGED rules with ctx, both methods produce identical
     answers because the same condition produced the tag at
     signal time. The hybrid only changes behaviour for tagless
     rules + new entries — strictly an additive improvement.

     Side benefit: this also catches a class of bug where a
     rule's tag string drifts between the registry and the
     signal emitter — the ctx-based replay is the source of
     truth. (Today's code emits the tag via applyRules so this
     can't happen, but future refactors could.) */
  const perRule = {};
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string') continue;
    /* Skip ONLY if BOTH the rule has no tag AND we'll have no
       ctx-based fallback for any entry. We can't predict per-
       entry ctx presence at this loop level, so we check per-
       entry below and skip individual non-attributable
       (rule, entry) pairs. The rule itself enters perRule when
       at least one entry could be attributed. */
    if (typeof rule.condition !== 'function' && (rule.tag === null || rule.tag === undefined)) {
      continue;
    }

    const fired = [];
    const absent = [];
    let attributable = 0; /* entries we COULD attribute (had ctx or tag) */
    for (const entry of evaluated) {
      let firedThis;
      const hasCtx = entry.ctx && typeof entry.ctx === 'object';
      if (hasCtx && typeof rule.condition === 'function') {
        try {
          firedThis = rule.condition(entry.ctx) === true;
          attributable++;
        } catch (_e) {
          /* Defensive: a buggy rule condition shouldn't crash the
             backtest. Skip this (rule, entry) pair. */
          continue;
        }
      } else if (rule.tag !== null && rule.tag !== undefined) {
        const tags = Array.isArray(entry.tags) ? entry.tags : [];
        firedThis = tags.indexOf(rule.tag) !== -1;
        attributable++;
      } else {
        /* Tagless rule, no ctx — can't attribute. Skip pair. */
        continue;
      }
      if (firedThis) fired.push(entry);
      else absent.push(entry);
    }

    /* Don't emit a perRule entry for a rule that couldn't be
       attributed against any evaluated entry. This keeps the
       output clean of noise. */
    if (attributable === 0) continue;

    const firedWins = fired.filter((e) => e.outcome === 'win').length;
    const absentWins = absent.filter((e) => e.outcome === 'win').length;
    const firedAvgGain =
      fired.length > 0 ? fired.reduce((s, e) => s + (e.pctChange || 0), 0) / fired.length : 0;
    const absentAvgGain =
      absent.length > 0 ? absent.reduce((s, e) => s + (e.pctChange || 0), 0) / absent.length : 0;
    const delta = firedAvgGain - absentAvgGain;

    perRule[rule.id] = {
      tag: rule.tag /* may be null for tagless rules attributed via ctx */,
      weight: rule.weight,
      fired: fired.length,
      absent: absent.length,
      firedWinRate: fired.length > 0 ? Math.round((firedWins / fired.length) * 100) : 0,
      absentWinRate: absent.length > 0 ? Math.round((absentWins / absent.length) * 100) : 0,
      firedAvgGain: _round2(firedAvgGain),
      absentAvgGain: _round2(absentAvgGain),
      delta: _round2(delta),
      sampleSize: fired.length >= minSamples ? 'sufficient' : 'low',
      attributableEntries: attributable /* Part 3: how many entries could be attributed at all */,
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
      if (typeof rule.condition !== 'function' && (rule.tag === null || rule.tag === undefined)) {
        continue;
      }
      /* Same hybrid attribution as the top-level loop: ctx-based
         when present, tag-based otherwise. */
      const fired = [];
      const absent = [];
      let attributable = 0;
      for (const e of tierEvaluated) {
        let firedThis;
        const hasCtx = e.ctx && typeof e.ctx === 'object';
        if (hasCtx && typeof rule.condition === 'function') {
          try {
            firedThis = rule.condition(e.ctx) === true;
            attributable++;
          } catch (_err) {
            continue;
          }
        } else if (rule.tag !== null && rule.tag !== undefined) {
          firedThis = Array.isArray(e.tags) && e.tags.indexOf(rule.tag) !== -1;
          attributable++;
        } else {
          continue;
        }
        if (firedThis) fired.push(e);
        else absent.push(e);
      }
      if (attributable === 0) continue;
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

function _mean(arr) {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
}

/* _profileStats(label, gains) — net-of-fees summary for one profile's
   surfaced set. A "net win" is a profitable trade AFTER fees (gain > 0),
   which is a far more honest bar than the legacy +5% absolute threshold. */
function _profileStats(label, gains) {
  const n = gains.length;
  const netWins = gains.filter((g) => g > 0).length;
  return {
    label,
    surfaced: n,
    netWinRate: n ? Math.round((netWins / n) * 100) : 0,
    avgNetGain: _round2(_mean(gains)),
    medianNetGain: _round2(_median(gains)),
  };
}

/* compareWeightProfiles(history, applyRules, thresholds, opts) —
   retrospective champion (legacy) vs challenger (V2) A/B on the RECORDED
   signal set, net of round-trip fees.

   The history only contains signals the LIVE profile surfaced (score above
   the STRONG threshold), so this answers the precision question: of those,
   which would the challenger KEEP vs DROP, and how does each subset perform
   net of fees? A healthy challenger keeps winners and drops losers, i.e.
   dropped.avgNetGain < challenger.avgNetGain, and challenger beats champion.

   It cannot see signals the challenger would ADD that the live profile never
   surfaced (never recorded) — that needs forward shadow-recording.

   Pure: scoring fns + thresholds are injected, no I/O, no global state. Each
   entry's profile-independent base score (the inline, non-registry part) is
   recovered as entry.score − registryDelta(live profile), then re-scored
   under both profiles so the comparison is apples-to-apples on identical
   outcomes. entry.weightsProfile records which profile was live ('legacy'
   for entries recorded before the field existed). */
function compareWeightProfiles(history, applyRules, thresholds, opts) {
  const o = opts || {};
  const days = Number.isFinite(o.daysBack) && o.daysBack > 0 ? o.daysBack : DEFAULT_DAYS_BACK;
  const ts = o.now || Date.now();
  const cutoff = ts - days * 24 * 60 * 60 * 1000;
  /* Round-trip taker fee assumption (%) — entry + exit. Default 0.2%
     (~0.1% per side) so avgNetGain reflects what actually lands. */
  const feePct = Number.isFinite(o.feePct) && o.feePct >= 0 ? o.feePct : 0.2;
  const surfaceMin = Number.isFinite(o.surfaceMin)
    ? o.surfaceMin
    : (thresholds && thresholds.STRONG) || 70;

  const evaluated = (history || []).filter(
    (h) =>
      h &&
      h.evaluated &&
      h.outcome &&
      h.recordedAt >= cutoff &&
      typeof h.pctChange === 'number' &&
      typeof h.score === 'number' &&
      h.ctx
  );

  const champion = [];
  const challengerKept = [];
  const challengerDropped = [];
  const trendKept = [];
  const trendDropped = [];

  for (const h of evaluated) {
    let liveDelta, legacyDelta, v2Delta, trendDelta;
    try {
      /* Recover the base score under the profile that was ACTUALLY live when
         the entry was scored ('legacy' | 'v2' | 'trend'), so the base is exact
         even after the regime flips the live profile to trend. Then re-score
         under all three profiles — apples-to-apples on the same outcome. */
      liveDelta = applyRules(h.ctx, { profile: h.weightsProfile || 'legacy' }).scoreDelta;
      legacyDelta = applyRules(h.ctx, { profile: 'legacy' }).scoreDelta;
      v2Delta = applyRules(h.ctx, { profile: 'v2' }).scoreDelta;
      trendDelta = applyRules(h.ctx, { profile: 'trend' }).scoreDelta;
    } catch (_e) {
      continue; /* a malformed ctx must not break the whole comparison */
    }
    const base = h.score - liveDelta;
    const championScore = base + legacyDelta;
    const challengerScore = base + v2Delta;
    const trendScore = base + trendDelta;
    const netGain = h.pctChange - feePct;

    const inChampion = championScore >= surfaceMin;
    if (inChampion) champion.push(netGain);
    if (challengerScore >= surfaceMin) challengerKept.push(netGain);
    else if (inChampion) challengerDropped.push(netGain);
    if (trendScore >= surfaceMin) trendKept.push(netGain);
    else if (inChampion) trendDropped.push(netGain);
  }

  return {
    windowDays: days,
    feePct,
    surfaceMin,
    sampleSize: champion.length >= MIN_DEFAULT_SAMPLES ? 'sufficient' : 'low',
    champion: _profileStats('legacy', champion),
    challenger: _profileStats('v2', challengerKept),
    dropped: {
      count: challengerDropped.length,
      avgNetGain: _round2(_mean(challengerDropped)),
    },
    challengerTrend: _profileStats('trend', trendKept),
    droppedTrend: {
      count: trendDropped.length,
      avgNetGain: _round2(_mean(trendDropped)),
    },
  };
}

module.exports = {
  computeRuleAttribution,
  computeBacktestSummary,
  compareWeightProfiles,
  MIN_DEFAULT_SAMPLES,
  DEFAULT_DAYS_BACK,
};
