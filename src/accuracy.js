/* NEXUS PRO — direction accuracy loop (audit Group A + decision D2).

   Revives the dead getAccuracy / reportHistory: given the persisted
   per-symbol time-series (each sample carries a timestamp, a price, and the
   trend score `ts` that drove the direction call), it measures how often
   those calls were RIGHT.

   The "correct" criterion (D2), made explicit and tunable:
     - a sample is a CALL whose direction group is bull / bear / neutral
       (from ts: ≥2 bull, ≤-2 bear, else neutral);
     - evaluated at a horizon H later (default 4h AND 24h) against the first
       sample at or after t+H;
     - with move = (priceH − price0) / price0 × 100 and a dead-band θ
       (default 0.5%):
         bull    → correct iff move >  +θ
         bear    → correct iff move <  −θ
         neutral → correct iff |move| ≤ θ
     - a call without a future sample yet (too recent) is simply not
       evaluated — never counted as right or wrong.

   Pure: series in, stats out. Needs ≥ minSamples evaluated calls before a
   horizon reports a percentage (else null = "still accumulating"), so a
   thin history doesn't print a misleading number. */

'use strict';

const DEFAULT_HORIZONS = { '4h': 4 * 3600000, '24h': 24 * 3600000 };
const DEFAULT_DEADBAND_PCT = 0.5;
const DEFAULT_MIN_SAMPLES = 5;

function directionGroup(ts) {
  const n = Number(ts) || 0;
  if (n >= 2) return 'bull';
  if (n <= -2) return 'bear';
  return 'neutral';
}

/* Was a call of `group` correct given the realized % move and dead-band? */
function isCorrect(group, movePct, deadbandPct) {
  const m = Number(movePct);
  const d = Number(deadbandPct);
  if (!Number.isFinite(m)) return false;
  if (group === 'bull') return m > d;
  if (group === 'bear') return m < -d;
  return Math.abs(m) <= d; // neutral
}

/* Evaluate the series against itself over each horizon. */
function evaluateAccuracy(series, opts) {
  const o = opts || {};
  const horizons = o.horizonsMs || DEFAULT_HORIZONS;
  const deadband = o.deadbandPct != null ? o.deadbandPct : DEFAULT_DEADBAND_PCT;
  const minSamples = o.minSamples != null ? o.minSamples : DEFAULT_MIN_SAMPLES;

  const arr = (Array.isArray(series) ? series : []).filter(
    (s) =>
      s && Number.isFinite(Number(s.t)) && Number.isFinite(Number(s.price)) && Number(s.price) > 0
  );

  const byHorizon = {};
  Object.keys(horizons).forEach((hKey) => {
    const H = horizons[hKey];
    let evaluated = 0;
    let correct = 0;
    for (let i = 0; i < arr.length; i++) {
      const target = Number(arr[i].t) + H;
      let fut = null;
      for (let j = i + 1; j < arr.length; j++) {
        if (Number(arr[j].t) >= target) {
          fut = arr[j];
          break;
        }
      }
      if (!fut) continue; // not enough time has elapsed for this call yet
      const grp = directionGroup(arr[i].ts);
      const move = ((Number(fut.price) - Number(arr[i].price)) / Number(arr[i].price)) * 100;
      evaluated++;
      if (isCorrect(grp, move, deadband)) correct++;
    }
    byHorizon[hKey] = {
      evaluated,
      correct,
      pct: evaluated >= minSamples ? Math.round((correct / evaluated) * 100) : null,
    };
  });

  /* Headline number = the primary horizon (24h by default). */
  const primary =
    o.primary && byHorizon[o.primary]
      ? o.primary
      : byHorizon['24h']
        ? '24h'
        : Object.keys(byHorizon)[0];
  const p = byHorizon[primary] || { evaluated: 0, correct: 0, pct: null };
  return {
    byHorizon,
    primary,
    evaluated: p.evaluated,
    correct: p.correct,
    pct: p.pct,
    deadbandPct: deadband,
  };
}

module.exports = {
  DEFAULT_HORIZONS,
  DEFAULT_DEADBAND_PCT,
  DEFAULT_MIN_SAMPLES,
  directionGroup,
  isCorrect,
  evaluateAccuracy,
};
