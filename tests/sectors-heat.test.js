/* T2 — symmetric sector-heat strength score (2026-05 scanner audit).

   The legacy analyzeSectors ladder was structurally bull-biased: five
   positive buckets vs two negative ones, so a sector down −2% and one down
   −10% scored identically and the "money flow" panel was blind to the depth
   of an outflow. sectorStrength re-centres on 50 = flat and mirrors the
   bullish ladder onto the bearish side. These tests pin BOTH the calibration
   (so a future tweak is deliberate) and the headline SYMMETRY property. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sectorStrength,
  sectorVerdictTier,
  sectorWeightedAvg,
  filterRowsBySector,
  SECTORS,
} = require('../src/sectors');

test('sectorStrength — flat sector sits at the 50 midpoint', () => {
  assert.equal(sectorStrength(0, 50), 50);
  assert.equal(sectorStrength(0.9, 50), 50); /* still inside the flat band */
  assert.equal(sectorStrength(-0.9, 50), 50);
});

test('sectorStrength — calibration ladder (both directions)', () => {
  assert.equal(sectorStrength(8, 50), 92);
  assert.equal(sectorStrength(5, 50), 82);
  assert.equal(sectorStrength(3, 50), 72);
  assert.equal(sectorStrength(1, 50), 60);
  assert.equal(sectorStrength(-1, 50), 40);
  assert.equal(sectorStrength(-3, 50), 28);
  assert.equal(sectorStrength(-5, 50), 18);
  assert.equal(sectorStrength(-8, 50), 8);
});

test('sectorStrength — each band is symmetric around 50 (the B-class fix)', () => {
  /* An N% drop must be exactly as far BELOW 50 as an N% rise is ABOVE it. */
  for (const a of [1, 3, 5, 8]) {
    const up = sectorStrength(a, 50);
    const down = sectorStrength(-a, 50);
    assert.equal(up - 50, 50 - down, `±${a}% not symmetric: ${up} vs ${down}`);
  }
});

test('sectorStrength — depth of an outflow is now distinguishable', () => {
  /* The exact bug: −2% and −10% used to collapse to the same bucket. */
  assert.ok(
    sectorStrength(-10, 50) < sectorStrength(-2, 50),
    'a −10% sector must score below a −2% sector'
  );
});

test('sectorStrength — breadth nudge is symmetric and bounded', () => {
  const flat = sectorStrength(0, 50);
  assert.equal(sectorStrength(0, 90) - flat, 8); /* broad strength lifts */
  assert.equal(flat - sectorStrength(0, 10), 8); /* broad weakness drags equally */
  assert.equal(sectorStrength(0, 70) - flat, 4);
  assert.equal(flat - sectorStrength(0, 30), 4);
});

test('sectorStrength — monotonic non-decreasing in avg', () => {
  let prev = -1;
  for (const a of [-12, -8, -5, -3, -1, 0, 1, 3, 5, 8, 12]) {
    const s = sectorStrength(a, 50);
    assert.ok(s >= prev, `not monotonic at avg=${a}: ${s} < ${prev}`);
    prev = s;
  }
});

test('sectorStrength — clamps to 0..100 and tolerates junk input', () => {
  assert.ok(sectorStrength(99, 100) <= 100);
  assert.ok(sectorStrength(-99, 0) >= 0);
  assert.equal(sectorStrength(NaN, NaN), 50); /* unknown → flat midpoint */
  assert.equal(sectorStrength(undefined, undefined), 50);
});

test('sectorVerdictTier — symmetric bands around the flat midpoint', () => {
  assert.equal(sectorVerdictTier(70), 'hot');
  assert.equal(sectorVerdictTier(69), 'rising');
  assert.equal(sectorVerdictTier(56), 'rising');
  assert.equal(sectorVerdictTier(55), 'neutral');
  assert.equal(sectorVerdictTier(50), 'neutral'); /* flat reads neutral */
  assert.equal(sectorVerdictTier(44), 'neutral');
  assert.equal(sectorVerdictTier(43), 'declining');
  assert.equal(sectorVerdictTier(8), 'declining');
});

test('sectorVerdictTier — the neutral band is centred on 50', () => {
  /* 44..55 brackets the flat midpoint with equal room either side. */
  assert.equal(sectorVerdictTier(50 - 6), 'neutral');
  assert.equal(sectorVerdictTier(50 + 5), 'neutral');
  assert.equal(sectorVerdictTier(50 - 7), 'declining');
  assert.equal(sectorVerdictTier(50 + 6), 'rising');
});

/* ─── T3 — volume-weighted sector change ──────────────────────────────
   The flat mean let a thin microcap outvote the megacap that holds the
   capital. sectorWeightedAvg weights each coin's change by its volume. */

test('sectorWeightedAvg — equal volumes reduce to the flat mean', () => {
  const flat = sectorWeightedAvg([
    { c: 2, v: 100 },
    { c: -2, v: 100 },
    { c: 6, v: 100 },
  ]);
  assert.equal(flat, (2 - 2 + 6) / 3);
});

test('sectorWeightedAvg — the megacap that holds the money sets the sign (the T3 fix)', () => {
  /* Flat mean would read −3% (bearish); weighting by where capital sits
     flips it positive because the +2% coin carries ~99.7% of the volume. */
  const coins = [
    { c: 2, v: 30e9 } /* megacap up */,
    { c: -8, v: 0.1e9 } /* microcap down, thin */,
  ];
  const flat = (2 - 8) / 2;
  const wt = sectorWeightedAvg(coins);
  assert.equal(flat, -3);
  assert.ok(wt > 0, `expected weighted avg positive, got ${wt}`);
  assert.ok(Math.abs(wt - 1.97) < 0.05, `expected ~1.97, got ${wt}`);
});

test('sectorWeightedAvg — zero/absent volume falls back to the flat mean (no div-by-zero)', () => {
  assert.equal(
    sectorWeightedAvg([
      { c: 4, v: 0 },
      { c: -2, v: 0 },
    ]),
    1 /* (4 + -2)/2 */
  );
  assert.equal(sectorWeightedAvg([{ c: 5 }, { c: 1 }]), 3); /* v undefined */
});

test('sectorWeightedAvg — a coin with unknown change is skipped, not treated as 0%', () => {
  /* NaN change must not dilute the average toward zero. */
  const wt = sectorWeightedAvg([
    { c: 6, v: 100 },
    { c: NaN, v: 100 },
  ]);
  assert.equal(wt, 6);
});

test('sectorWeightedAvg — empty / junk input is 0, never NaN', () => {
  assert.equal(sectorWeightedAvg([]), 0);
  assert.equal(sectorWeightedAvg(null), 0);
  assert.equal(sectorWeightedAvg([{ c: NaN, v: NaN }]), 0);
  assert.ok(Number.isFinite(sectorWeightedAvg([{ c: 3, v: -5 }]))); /* neg vol ignored */
});

test('sectorWeightedAvg — negative volume is ignored, positive-volume coins still weight', () => {
  /* a junk negative volume must not subtract weight; it's dropped, and the
     remaining positive-volume coin drives the result. */
  assert.equal(
    sectorWeightedAvg([
      { c: 10, v: -100 } /* ignored */,
      { c: 4, v: 50 },
    ]),
    4
  );
});

/* ─── Sector → gems bridge (compass → radar) ──────────────────────────
   filterRowsBySector narrows the already-gated gem rows to the members of
   one sector, so a hot sector card on the trend tab links to its early
   small-cap gems instead of dead-ending at the large movers it mirrors. */

test("filterRowsBySector — narrows gems to a sector's members", () => {
  const rows = [
    { s: 'CTXC', sc: 60 } /* AI member */,
    { s: 'NMR', sc: 55 } /* AI member */,
    { s: 'GALA', sc: 70 } /* gaming member */,
    { s: 'WOOF', sc: 40 } /* not in any sector */,
  ];
  assert.deepEqual(
    filterRowsBySector(rows, 'ai').map((r) => r.s),
    ['CTXC', 'NMR']
  );
  assert.deepEqual(
    filterRowsBySector(rows, 'gaming').map((r) => r.s),
    ['GALA']
  );
});

test('filterRowsBySector — only real SECTORS members survive (uses live taxonomy)', () => {
  /* Pin the contract against the actual taxonomy, not a fixture: every AI
     gem returned must be a declared member of SECTORS.ai. */
  const rows = SECTORS.ai.coins.concat(['NOTACOIN', 'ZZZZ']).map((s) => ({ s }));
  const out = filterRowsBySector(rows, 'ai').map((r) => r.s);
  assert.deepEqual(out, SECTORS.ai.coins);
  out.forEach((s) => assert.ok(SECTORS.ai.coins.includes(s)));
});

test('filterRowsBySector — null / all / unknown key is a no-op passthrough (same array)', () => {
  const rows = [{ s: 'CTXC' }, { s: 'GALA' }];
  assert.equal(filterRowsBySector(rows, 'all'), rows);
  assert.equal(filterRowsBySector(rows, null), rows);
  assert.equal(filterRowsBySector(rows, undefined), rows);
  assert.equal(filterRowsBySector(rows, 'no_such_sector'), rows);
});

test('filterRowsBySector — preserves input order and the original row objects', () => {
  const rows = [
    { s: 'NMR', sc: 1 },
    { s: 'FET', sc: 2 } /* AI but TIER1 — membership only; gating is upstream */,
    { s: 'CTXC', sc: 3 },
  ];
  const out = filterRowsBySector(rows, 'ai');
  assert.deepEqual(
    out.map((r) => r.s),
    ['NMR', 'FET', 'CTXC']
  );
  assert.equal(out[0], rows[0]); /* same object refs, not copies */
});

test('filterRowsBySector — non-array rows yield [] (never throw)', () => {
  assert.deepEqual(filterRowsBySector(null, 'ai'), []);
  assert.deepEqual(filterRowsBySector(undefined, 'ai'), []);
  assert.deepEqual(filterRowsBySector('oops', 'ai'), []);
});

test('filterRowsBySector — a sector with no gem members yields an empty set', () => {
  const rows = [{ s: 'CTXC' }, { s: 'GALA' }];
  assert.deepEqual(filterRowsBySector(rows, 'privacy'), []);
});
