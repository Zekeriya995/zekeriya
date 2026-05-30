/* Unit tests for src/market-summary.js — the deterministic market-movement
   narrative engine. Everything is pinned to fixed timestamps and prices so
   the produced Arabic / English text is fully reproducible. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyDirection,
  sampleBucket,
  detectFlips,
  analyzeMovement,
  buildMovementSummary,
  formatPrice,
  formatPct,
  _clock,
} = require('../src/market-summary');

/* 2026-05-30T08:00:00Z — clean UTC base so clocks read 08:00, 08:20, … */
const BASE = Date.UTC(2026, 4, 30, 8, 0, 0);
function at(min) {
  return BASE + min * 60000;
}
function s(min, price, extra) {
  return Object.assign({ t: at(min), price }, extra || {});
}
function approx(a, b, eps) {
  assert.ok(Math.abs(a - b) <= (eps || 1e-6), `expected ${a} ≈ ${b}`);
}

test('classifyDirection — boundary cut points mirror the chart', () => {
  assert.equal(classifyDirection(4), 'strong_bull');
  assert.equal(classifyDirection(3), 'bull');
  assert.equal(classifyDirection(2), 'bull');
  assert.equal(classifyDirection(1), 'neutral');
  assert.equal(classifyDirection(0), 'neutral');
  assert.equal(classifyDirection(-1), 'neutral');
  assert.equal(classifyDirection(-2), 'bear');
  assert.equal(classifyDirection(-3), 'bear');
  assert.equal(classifyDirection(-4), 'strong_bear');
});

test('sampleBucket — explicit bucket wins, garbage falls back to ts', () => {
  assert.equal(sampleBucket({ bucket: 'bear', ts: 5 }), 'bear');
  assert.equal(sampleBucket({ ts: 5 }), 'strong_bull');
  assert.equal(sampleBucket({ bucket: 'garbage', ts: 0 }), 'neutral');
});

test('detectFlips — finds each bucket change with time and direction', () => {
  const series = [
    s(0, 100, { ts: 0 }),
    s(20, 100, { ts: 2 }),
    s(40, 100, { ts: 2 }),
    s(60, 100, { ts: -2 }),
  ];
  const flips = detectFlips(series);
  assert.equal(flips.length, 2);
  assert.deepEqual(
    flips.map((f) => [f.from, f.to, f.direction, f.at]),
    [
      ['neutral', 'bull', 'up', at(20)],
      ['bull', 'bear', 'down', at(60)],
    ]
  );
});

test('analyzeMovement — V-shape: net, high/low, up-leg and down-leg', () => {
  const m = analyzeMovement([s(0, 100), s(20, 96), s(40, 98)]);
  assert.equal(m.enough, true);
  approx(m.netPct, -2); // 100 -> 98
  assert.equal(m.high.price, 100);
  assert.equal(m.low.price, 96);
  approx(m.downLeg.pct, 4); // 100 -> 96
  approx(m.upLeg.pct, (2 / 96) * 100); // 96 -> 98
  assert.equal(m.downLeg.toT, at(20));
  assert.equal(m.upLeg.toT, at(40));
});

test('analyzeMovement — inverted-V: largest rise then largest drop', () => {
  const m = analyzeMovement([s(0, 100), s(20, 104), s(40, 101)]);
  approx(m.netPct, 1);
  approx(m.upLeg.pct, 4); // 100 -> 104
  approx(m.downLeg.pct, (3 / 104) * 100); // 104 -> 101
});

test('analyzeMovement — fewer than two valid points is "not enough"', () => {
  assert.equal(analyzeMovement([]).enough, false);
  assert.equal(analyzeMovement([s(0, 100)]).enough, false);
  assert.equal(analyzeMovement([{ t: at(0) }, { price: 1 }]).enough, false);
});

test('buildMovementSummary — empty series returns a graceful message', () => {
  const ar = buildMovementSummary([], { lang: 'ar' });
  assert.equal(ar.enough, false);
  assert.match(ar.text, /لا تتوفّر بيانات كافية/);
  const en = buildMovementSummary([s(0, 1)], { lang: 'en' });
  assert.equal(en.enough, false);
  assert.match(en.text, /Not enough data/);
});

test('buildMovementSummary — monotonic up: rise, no down-leg, no flip', () => {
  const up = [s(0, 73200, { ts: 2 }), s(20, 73600, { ts: 2 }), s(40, 74100, { ts: 3 })];
  const r = buildMovementSummary(up, { lang: 'ar', coinName: 'البيتكوين' });
  assert.equal(r.enough, true);
  assert.match(r.text, /صعد البيتكوين/);
  assert.ok(r.text.includes('$74,100'));
  assert.ok(r.text.includes('أعلى ارتفاع'));
  assert.ok(!r.text.includes('أكبر تراجع')); // monotonic: no meaningful drop
  assert.match(r.text, /بقي الاتجاه صعودي/); // no flip
  assert.match(r.text, /للاطلاع فقط/);
  assert.ok(!/undefined|NaN/.test(r.text));
});

test('buildMovementSummary — V-shape with flips + full context (ar)', () => {
  const series = [
    s(0, 74000, { ts: 2, funding: 0.0006 }),
    s(20, 73000, { ts: -2, funding: 0.0004 }),
    s(40, 73500, {
      ts: 0,
      funding: 0.0003,
      oiChangePct: -1.7,
      newsTone: 'negative',
      completeness: 0.75,
    }),
  ];
  const r = buildMovementSummary(series, { lang: 'ar', coinName: 'البيتكوين' });
  assert.match(r.text, /تراجع البيتكوين/); // net is slightly negative
  assert.ok(r.text.includes('أعلى ارتفاع'));
  assert.ok(r.text.includes('أكبر تراجع'));
  assert.match(r.text, /انقلب الاتجاه 2 مرات/);
  assert.ok(r.text.includes('محايد')); // last flip target
  assert.ok(r.text.includes('تبريد التمويل'));
  assert.ok(r.text.includes('تقلّص المراكز المفتوحة'));
  assert.ok(r.text.includes('-1.7%'));
  assert.ok(r.text.includes('نبرة أخبار سلبية'));
  assert.ok(r.text.includes('اكتمال المصادر 75%'));
  assert.match(r.text, /للاطلاع فقط/);
  assert.ok(!/undefined|NaN/.test(r.text));
  assert.equal(r.flips.length, 2);
});

test('buildMovementSummary — never emits an action verb', () => {
  const series = [
    s(0, 74000, { ts: 2, funding: 0.0006 }),
    s(20, 73000, { ts: -2 }),
    s(40, 73500, { ts: 0, newsTone: 'negative' }),
  ];
  const ar = buildMovementSummary(series, { lang: 'ar' }).text;
  const en = buildMovementSummary(series, { lang: 'en' }).text;
  assert.ok(!/اشتر|ابيع|بِع/.test(ar), 'no Arabic buy/sell imperative');
  assert.ok(!/\b(buy|sell)\b/i.test(en), 'no English buy/sell verb');
});

test('buildMovementSummary — English variant reads correctly', () => {
  const series = [
    s(0, 74000, { ts: 2, funding: 0.0006 }),
    s(20, 73000, { ts: -2, funding: 0.0004 }),
    s(40, 73500, { ts: 0, funding: 0.0003, oiChangePct: -1.7, newsTone: 'negative' }),
  ];
  const t = buildMovementSummary(series, { lang: 'en', coinName: 'BTC' }).text;
  assert.match(t, /Over the last/);
  assert.match(t, /BTC fell/);
  assert.match(t, /direction flipped/);
  assert.match(t, /cooling funding/);
  assert.match(t, /OI deleveraging/);
  assert.match(t, /informational only/);
  assert.ok(!/undefined|NaN/.test(t));
});

test('buildMovementSummary — deterministic for identical input', () => {
  const series = [s(0, 100, { ts: 2 }), s(20, 99, { ts: -2 }), s(40, 101, { ts: 2 })];
  const a = buildMovementSummary(series, { lang: 'ar' }).text;
  const b = buildMovementSummary(series, { lang: 'ar' }).text;
  assert.equal(a, b);
});

test('formatters — price, percent, and deterministic UTC clock', () => {
  assert.equal(formatPrice(74100), '$74,100');
  assert.equal(formatPrice(2.5), '$2.50');
  assert.equal(formatPrice(0.0012), '$0.0012');
  assert.equal(formatPrice(NaN), '—');
  assert.equal(formatPct(-1.7), '-1.7%');
  assert.equal(formatPct(2), '+2.0%');
  assert.equal(_clock(BASE), '08:00');
  assert.equal(_clock(at(20)), '08:20');
});
