/* NEXUS PRO — market movement auto-summary (narrative engine).

   Turns a trailing time-series of market-direction samples into a
   deterministic, Arabic-first narrative of how BTC / ETH actually moved:
   the up-leg, the down-leg, and the moment the trend flipped. This is the
   revival of the long-dead buildStory() / getChanges() / MKT_TPL code the
   Market Direction audit found unwired — rebuilt server-side as a pure,
   testable module. See docs/MARKET_MOVEMENT_AUTOSUMMARY_DESIGN.md.

   Design constraints, all enforced by tests:
   - PURE: no Date.now(), no globals, no I/O. The caller passes the series
     and the language; the same input always yields the same string, so a
     test can pin every word.
   - INFORMATIONAL ONLY: it describes movement (rose / fell / flipped) and
     never emits an action verb (buy / sell). Mirrors the audit's good
     practice for this section.
   - DEGRADES CLEANLY: a missing optional signal (funding / OI / news /
     completeness) drops its clause instead of printing "undefined".

   The server job (Phase 2) samples snapshots into the series and persists
   the produced text; the PWA (Phase 3) only renders it. */

'use strict';

/* Direction buckets — thresholds mirror analyzeCoinRpt in app.js so a flip
   detected here is the same flip the chart shows the user. */
const TS_STRONG_BULL = 4;
const TS_BULL = 2;
const TS_BEAR = -2;
const TS_STRONG_BEAR = -4;

const DIR_RANK = { strong_bear: -2, bear: -1, neutral: 0, bull: 1, strong_bull: 2 };

const DIR_LABEL = {
  ar: {
    strong_bull: 'صعودي قوي',
    bull: 'صعودي',
    neutral: 'محايد',
    bear: 'هبوطي',
    strong_bear: 'هبوطي قوي',
  },
  en: {
    strong_bull: 'Strong Bull',
    bull: 'Bullish',
    neutral: 'Neutral',
    bear: 'Bearish',
    strong_bear: 'Strong Bear',
  },
};

/* Only mention a swing leg in prose if it moved at least this much, so a
   flat tape doesn't get a spurious "rose 0.1%" clause. */
const LEG_MIN_PCT = 0.3;
/* A net move below this reads as "ranged sideways" rather than up / down. */
const FLAT_NET_PCT = 0.3;
/* Funding-trend hysteresis: last vs first |rate| over the window. */
const FUNDING_COOL_RATIO = 0.8;
const FUNDING_HEAT_RATIO = 1.2;
/* OI interpretation band (percent change over the window's last sample). */
const OI_MOVE_PCT = 1;

/* ─── small pure helpers ─────────────────────────────────────────── */

/* Coerce to a finite number or null. Unlike Number(), treats null /
   undefined / '' as "absent" (null) rather than 0, so optional signals
   can be distinguished from a genuine zero. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 100) return '$' + Math.round(n).toLocaleString('en-US');
  if (Math.abs(n) >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(4);
}

function formatPct(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

/* Deterministic UTC HH:MM. The display layer (Phase 3) localizes to the
   user's timezone; here we stay in UTC so tests are timezone-independent. */
function clock(t) {
  const d = new Date(Number(t));
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function formatDuration(ms, lang) {
  const n = Number(ms) || 0;
  const h = Math.round(n / 3600000);
  if (h >= 1) return lang === 'en' ? h + 'h' : h + ' ساعة';
  const m = Math.max(1, Math.round(n / 60000));
  return lang === 'en' ? m + 'm' : m + ' دقيقة';
}

function joinList(arr, lang) {
  return arr.join(lang === 'en' ? ', ' : '، ');
}

/* ─── direction & flips ──────────────────────────────────────────── */

/* Map a trend score to a direction bucket (same cut points as the chart). */
function classifyDirection(ts) {
  const n = Number(ts) || 0;
  if (n >= TS_STRONG_BULL) return 'strong_bull';
  if (n >= TS_BULL) return 'bull';
  if (n <= TS_STRONG_BEAR) return 'strong_bear';
  if (n <= TS_BEAR) return 'bear';
  return 'neutral';
}

/* Prefer an explicit bucket on the sample; otherwise derive it from ts. */
function sampleBucket(s) {
  if (s && typeof s.bucket === 'string' && DIR_RANK[s.bucket] !== undefined) return s.bucket;
  return classifyDirection(s ? s.ts : 0);
}

/* Every point where the direction bucket changes between consecutive
   samples, with when it happened and whether it improved or worsened. */
function detectFlips(series) {
  const arr = Array.isArray(series) ? series : [];
  const flips = [];
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    const b = sampleBucket(arr[i]);
    if (prev !== null && b !== prev) {
      flips.push({
        at: arr[i].t,
        from: prev,
        to: b,
        direction: DIR_RANK[b] > DIR_RANK[prev] ? 'up' : 'down',
      });
    }
    prev = b;
  }
  return flips;
}

/* ─── movement analysis ──────────────────────────────────────────── */

/* Reduce the series to the deltas the narrative needs: net move, the
   biggest rise (max price gain from any earlier low) and the biggest drop
   (max loss from any earlier high), direction flips, and the latest
   funding / OI / news / completeness context. O(n), single pass. */
function analyzeMovement(series) {
  const arr = (Array.isArray(series) ? series : []).filter(
    (s) => s && Number.isFinite(Number(s.price)) && Number.isFinite(Number(s.t))
  );
  if (arr.length < 2) return { enough: false, count: arr.length };

  const first = arr[0];
  const last = arr[arr.length - 1];
  const firstPrice = Number(first.price);
  const lastPrice = Number(last.price);
  const netPct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  let high = arr[0];
  let low = arr[0];
  let minSoFar = arr[0];
  let maxSoFar = arr[0];
  let upLeg = null;
  let downLeg = null;

  for (let j = 1; j < arr.length; j++) {
    const pj = Number(arr[j].price);
    const rise = pj - Number(minSoFar.price);
    if (!upLeg || rise > upLeg.abs) {
      upLeg = {
        fromPrice: Number(minSoFar.price),
        fromT: minSoFar.t,
        toPrice: pj,
        toT: arr[j].t,
        abs: rise,
      };
    }
    const drop = Number(maxSoFar.price) - pj;
    if (!downLeg || drop > downLeg.abs) {
      downLeg = {
        fromPrice: Number(maxSoFar.price),
        fromT: maxSoFar.t,
        toPrice: pj,
        toT: arr[j].t,
        abs: drop,
      };
    }
    if (pj > Number(high.price)) high = arr[j];
    if (pj < Number(low.price)) low = arr[j];
    if (pj < Number(minSoFar.price)) minSoFar = arr[j];
    if (pj > Number(maxSoFar.price)) maxSoFar = arr[j];
  }
  if (upLeg) upLeg.pct = upLeg.fromPrice > 0 ? (upLeg.abs / upLeg.fromPrice) * 100 : 0;
  if (downLeg) downLeg.pct = downLeg.fromPrice > 0 ? (downLeg.abs / downLeg.fromPrice) * 100 : 0;

  const lastOi = num(last.oiChangePct);
  const oi =
    lastOi === null
      ? null
      : {
          changePct: lastOi,
          interpretation:
            lastOi <= -OI_MOVE_PCT ? 'deleveraging' : lastOi >= OI_MOVE_PCT ? 'building' : 'flat',
        };

  return {
    enough: true,
    count: arr.length,
    fromT: first.t,
    toT: last.t,
    windowMs: Number(last.t) - Number(first.t),
    firstPrice,
    lastPrice,
    netPct,
    high: { price: Number(high.price), t: high.t },
    low: { price: Number(low.price), t: low.t },
    upLeg,
    downLeg,
    flips: detectFlips(arr),
    finalDir: sampleBucket(last),
    funding: computeFundingTrend(arr),
    oi,
    news: typeof last.newsTone === 'string' ? last.newsTone : null,
    completeness: num(last.completeness),
  };
}

/* Cooling / heating / flipped sign of funding across the window, using the
   first and last samples that actually carry a funding rate. */
function computeFundingTrend(arr) {
  const withF = arr.filter((s) => num(s.funding) !== null);
  if (withF.length < 2) return null;
  const f0 = Number(withF[0].funding);
  const f1 = Number(withF[withF.length - 1].funding);
  let trend = 'flat';
  if ((f0 >= 0 && f1 < 0) || (f0 < 0 && f1 >= 0)) {
    trend = 'flipped';
  } else {
    const a0 = Math.abs(f0);
    const a1 = Math.abs(f1);
    if (a1 <= a0 * FUNDING_COOL_RATIO) trend = 'cooling';
    else if (a1 >= a0 * FUNDING_HEAT_RATIO) trend = 'heating';
  }
  return { first: f0, last: f1, trend };
}

/* ─── narrative ──────────────────────────────────────────────────── */

const FUNDING_PHRASE = {
  cooling: { ar: 'تبريد التمويل', en: 'cooling funding' },
  heating: { ar: 'ارتفاع التمويل', en: 'rising funding' },
  flipped: { ar: 'انقلاب إشارة التمويل', en: 'funding flipping sign' },
};

/* Build the Arabic-first (or English) movement summary. Returns the text
   plus the structured deltas so callers can render either. */
function buildMovementSummary(series, opts) {
  const o = opts || {};
  const lang = o.lang === 'en' ? 'en' : 'ar';
  const coin = o.coinName || o.sym || (lang === 'en' ? 'the market' : 'السوق');
  const m = analyzeMovement(series);
  const L = DIR_LABEL[lang];

  if (!m.enough) {
    const text =
      lang === 'en'
        ? 'Not enough data yet to summarize movement.'
        : 'لا تتوفّر بيانات كافية بعد لتلخيص الحركة.';
    return { enough: false, text, headline: text, deltas: m, flips: [] };
  }

  const parts = [];
  const win = formatDuration(m.windowMs, lang);
  const net = m.netPct;
  const fromTo =
    lang === 'en'
      ? `(from ${formatPrice(m.firstPrice)} to ${formatPrice(m.lastPrice)})`
      : `(من ${formatPrice(m.firstPrice)} إلى ${formatPrice(m.lastPrice)})`;

  /* 1) net move */
  if (Math.abs(net) < FLAT_NET_PCT) {
    parts.push(
      lang === 'en'
        ? `Over the last ${win}, ${coin} ranged sideways near ${formatPrice(m.lastPrice)}`
        : `خلال آخر ${win}، تحرّك ${coin} جانبياً قرب ${formatPrice(m.lastPrice)}`
    );
  } else if (net > 0) {
    parts.push(
      lang === 'en'
        ? `Over the last ${win}, ${coin} rose ${formatPct(net)} ${fromTo}`
        : `خلال آخر ${win}، صعد ${coin} ${formatPct(net)} ${fromTo}`
    );
  } else {
    parts.push(
      lang === 'en'
        ? `Over the last ${win}, ${coin} fell ${formatPct(net)} ${fromTo}`
        : `خلال آخر ${win}، تراجع ${coin} ${formatPct(net)} ${fromTo}`
    );
  }

  /* 2) the rise and the fall, in the order they happened */
  const legs = [];
  if (m.upLeg && m.upLeg.pct >= LEG_MIN_PCT) {
    legs.push({
      t: Number(m.upLeg.toT),
      text:
        lang === 'en'
          ? `a high of ${formatPrice(m.upLeg.toPrice)} at ${clock(m.upLeg.toT)} (+${m.upLeg.pct.toFixed(1)}%)`
          : `أعلى ارتفاع إلى ${formatPrice(m.upLeg.toPrice)} عند ${clock(m.upLeg.toT)} (+${m.upLeg.pct.toFixed(1)}%)`,
    });
  }
  if (m.downLeg && m.downLeg.pct >= LEG_MIN_PCT) {
    legs.push({
      t: Number(m.downLeg.toT),
      text:
        lang === 'en'
          ? `a drop to ${formatPrice(m.downLeg.toPrice)} at ${clock(m.downLeg.toT)} (-${m.downLeg.pct.toFixed(1)}%)`
          : `أكبر تراجع إلى ${formatPrice(m.downLeg.toPrice)} عند ${clock(m.downLeg.toT)} (-${m.downLeg.pct.toFixed(1)}%)`,
    });
  }
  if (legs.length) {
    legs.sort((a, b) => a.t - b.t);
    const body = legs.map((x) => x.text).join(lang === 'en' ? ', then ' : ' ثم ');
    parts.push((lang === 'en' ? 'with ' : 'مع ') + body);
  }

  /* 3) direction flips */
  if (m.flips.length === 0) {
    parts.push(
      lang === 'en'
        ? `and direction held ${L[m.finalDir]} throughout`
        : `وبقي الاتجاه ${L[m.finalDir]} طوال الفترة`
    );
  } else {
    const lastFlip = m.flips[m.flips.length - 1];
    const when = clock(lastFlip.at);
    if (m.flips.length > 1) {
      parts.push(
        lang === 'en'
          ? `and direction flipped ${m.flips.length} times, last from ${L[lastFlip.from]} to ${L[lastFlip.to]} at ${when}`
          : `وانقلب الاتجاه ${m.flips.length} مرات، آخرها من ${L[lastFlip.from]} إلى ${L[lastFlip.to]} عند ${when}`
      );
    } else {
      parts.push(
        lang === 'en'
          ? `and direction flipped from ${L[lastFlip.from]} to ${L[lastFlip.to]} at ${when}`
          : `وانقلب الاتجاه من ${L[lastFlip.from]} إلى ${L[lastFlip.to]} عند ${when}`
      );
    }
  }

  /* 4) market context (each clause appears only if its signal is present) */
  const ctx = [];
  if (m.funding && FUNDING_PHRASE[m.funding.trend]) {
    ctx.push(FUNDING_PHRASE[m.funding.trend][lang]);
  }
  if (m.oi && m.oi.interpretation !== 'flat') {
    const oiPhrase =
      lang === 'en'
        ? `OI ${m.oi.interpretation} (${formatPct(m.oi.changePct)})`
        : `${m.oi.interpretation === 'deleveraging' ? 'تقلّص المراكز المفتوحة' : 'بناء مراكز'} (${formatPct(m.oi.changePct)})`;
    ctx.push(oiPhrase);
  }
  if (m.news === 'negative' || m.news === 'positive') {
    ctx.push(
      lang === 'en'
        ? `${m.news} news tone`
        : m.news === 'negative'
          ? 'نبرة أخبار سلبية'
          : 'نبرة أخبار إيجابية'
    );
  }
  if (ctx.length) {
    parts.push((lang === 'en' ? 'amid ' : 'وسط ') + joinList(ctx, lang));
  }

  let text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (m.completeness !== null && m.completeness < 1) {
    const pc = Math.round(m.completeness * 100);
    text += lang === 'en' ? ` (source completeness ${pc}%)` : ` (اكتمال المصادر ${pc}%)`;
  }
  text += lang === 'en' ? ' — informational only.' : ' — للاطلاع فقط.';

  const headline = `${L[m.finalDir]} · ${formatPct(net)} (${win})`;
  return { enough: true, text, headline, deltas: m, flips: m.flips };
}

module.exports = {
  classifyDirection,
  sampleBucket,
  detectFlips,
  analyzeMovement,
  buildMovementSummary,
  formatPrice,
  formatPct,
  LEG_MIN_PCT,
  FLAT_NET_PCT,
  _clock: clock, // exported for deterministic time-format tests
};
