/* NEXUS PRO — per-tag win-rate analytics for the scanner.

   Aggregates the rolling scanner-history.json by individual tag —
   so the engineering team can answer questions like "what's the
   win rate of signals that fired the 🐋WHALE_A tag?" or "do
   coins with 🚨MANIP_HIGH actually under-perform after the
   Phase 1.2 cap?".

   The data this module reads exists only because Phase 1.0b
   started persisting `tags` on every recorded signal. Entries
   recorded before P1.0b deploy will have `tags: undefined` and
   are filtered out of every per-tag computation; aggregate stats
   still include them via scanner-history.computeStats.

   Pure module — no I/O. The caller (server.js) hands in the
   history array; this module returns the breakdown. */

'use strict';

/* computeTagStats(history, opts) — returns a per-tag aggregation
   of evaluated signals in the rolling window.

   opts: {
     daysBack?:   number  // default 7
     now?:        number  // default Date.now()
     minSamples?: number  // tags with fewer evaluated samples than
                          //   this are omitted (default 3) so the
                          //   output isn't dominated by single-fire
                          //   noise tags
   }

   Returns:
     {
       windowDays:        number
       totalEvaluated:    number   // signals with both `tags` and an outcome
       totalWithoutTags:  number   // pre-P1.0b entries excluded
       perTag: {
         [tag]: {
           count:      number  // how many evaluated signals carried this tag
           wins:       number  // outcome === 'win'
           losses:     number  // outcome === 'loss'
           winRate:    number  // wins / count, rounded percent
           avgGain:    number  // mean pctChange, 2dp
           bestSignal: { s, pctChange } | null
           worstSignal: { s, pctChange } | null
         }
       }
       generatedAt: ISO string
     } */
function computeTagStats(history, opts) {
  const options = opts || {};
  const daysBack = typeof options.daysBack === 'number' ? options.daysBack : 7;
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const minSamples = typeof options.minSamples === 'number' ? options.minSamples : 3;
  const cutoff = now - daysBack * 24 * 60 * 60 * 1000;

  if (!Array.isArray(history)) {
    return _empty(daysBack, now);
  }

  const evaluatedInWindow = history.filter(
    (h) => h && h.evaluated && typeof h.recordedAt === 'number' && h.recordedAt >= cutoff
  );

  /* Split: entries with the P1.0b tags field vs. pre-extension
     entries (their `tags` is undefined and they cannot contribute
     to per-tag aggregations). */
  const withTags = evaluatedInWindow.filter((h) => Array.isArray(h.tags) && h.tags.length > 0);
  const withoutTags = evaluatedInWindow.length - withTags.length;

  /* Build the per-tag map by iterating once per entry. Each tag on
     an entry contributes to that tag's bucket. */
  const buckets = Object.create(null);
  for (const entry of withTags) {
    for (const tag of entry.tags) {
      if (typeof tag !== 'string' || tag.length === 0) continue;
      if (!buckets[tag]) {
        buckets[tag] = {
          count: 0,
          wins: 0,
          losses: 0,
          gainSum: 0,
          best: null,
          worst: null,
        };
      }
      const b = buckets[tag];
      b.count += 1;
      if (entry.outcome === 'win') b.wins += 1;
      if (entry.outcome === 'loss') b.losses += 1;
      const pct = typeof entry.pctChange === 'number' ? entry.pctChange : 0;
      b.gainSum += pct;
      if (!b.best || pct > b.best.pctChange) {
        b.best = { s: entry.s, pctChange: pct };
      }
      if (!b.worst || pct < b.worst.pctChange) {
        b.worst = { s: entry.s, pctChange: pct };
      }
    }
  }

  /* Materialize: drop tags below minSamples; round numbers; sort
     deterministically by count desc so consumers don't have to. */
  const perTag = {};
  const sortedTags = Object.keys(buckets)
    .filter((t) => buckets[t].count >= minSamples)
    .sort((a, b) => buckets[b].count - buckets[a].count);

  for (const tag of sortedTags) {
    const b = buckets[tag];
    perTag[tag] = {
      count: b.count,
      wins: b.wins,
      losses: b.losses,
      winRate: Math.round((b.wins / b.count) * 100),
      avgGain: Math.round((b.gainSum / b.count) * 100) / 100,
      bestSignal: b.best ? { s: b.best.s, pctChange: b.best.pctChange } : null,
      worstSignal: b.worst ? { s: b.worst.s, pctChange: b.worst.pctChange } : null,
    };
  }

  return {
    windowDays: daysBack,
    totalEvaluated: withTags.length,
    totalWithoutTags: withoutTags,
    perTag,
    generatedAt: new Date(now).toISOString(),
  };
}

function _empty(daysBack, now) {
  return {
    windowDays: daysBack,
    totalEvaluated: 0,
    totalWithoutTags: 0,
    perTag: {},
    generatedAt: new Date(now).toISOString(),
  };
}

module.exports = { computeTagStats };
