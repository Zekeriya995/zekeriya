/* T2 — symmetric sector-heat strength score (2026-05 scanner audit).

   The legacy analyzeSectors ladder was structurally bull-biased: five
   positive buckets vs two negative ones, so a sector down −2% and one down
   −10% scored identically and the "money flow" panel was blind to the depth
   of an outflow. sectorStrength re-centres on 50 = flat and mirrors the
   bullish ladder onto the bearish side. These tests pin BOTH the calibration
   (so a future tweak is deliberate) and the headline SYMMETRY property. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { sectorStrength, sectorVerdictTier } = require('../src/sectors');

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
