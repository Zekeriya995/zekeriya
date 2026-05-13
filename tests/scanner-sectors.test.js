/* Unit tests for src/scanner-sectors.js — pure aggregation, no
   disk or network. We exercise the verdict ladder, the per-sector
   top-3 cap, and the COIN_TO_SECTOR reverse index. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { SECTOR_COINS, getSector, aggregateBySector } = require('../src/scanner-sectors');

function sig(s, score, change) {
  return { s, score, change: change || 0, tier: 'STRONG' };
}

test('SECTOR_COINS covers the major buckets', () => {
  for (const sec of ['ai', 'gaming', 'layer1', 'layer2', 'defi', 'meme']) {
    assert.ok(Array.isArray(SECTOR_COINS[sec]) && SECTOR_COINS[sec].length > 0, sec + ' missing');
  }
});

test('getSector — known coins return their bucket', () => {
  assert.equal(getSector('BTC'), 'layer1');
  assert.equal(getSector('FET'), 'ai');
  assert.equal(getSector('AAVE'), 'defi');
  assert.equal(getSector('DOGE'), 'meme');
});

test('getSector — unknown coin returns null', () => {
  assert.equal(getSector('NONEXISTENT_XYZ'), null);
});

test('aggregateBySector — empty input returns all sectors as empty', () => {
  const out = aggregateBySector([]);
  for (const sec in SECTOR_COINS) {
    assert.equal(out[sec].count, 0);
    assert.equal(out[sec].verdict, 'empty');
  }
});

test('aggregateBySector — null / non-array input is safe', () => {
  const out1 = aggregateBySector(null);
  assert.equal(out1.layer1.count, 0);
  const out2 = aggregateBySector('not an array');
  assert.equal(out2.layer1.count, 0);
});

test('aggregateBySector — counts and averages per sector', () => {
  const signals = [sig('BTC', 80), sig('ETH', 70), sig('SOL', 60), sig('FET', 50)];
  const out = aggregateBySector(signals);
  assert.equal(out.layer1.count, 3);
  assert.equal(out.layer1.avgScore, 70); /* (80+70+60)/3 */
  assert.equal(out.ai.count, 1);
  assert.equal(out.ai.avgScore, 50);
});

test('aggregateBySector — verdict ladder matches score buckets', () => {
  /* avg 80 → strong_bullish */
  const a = aggregateBySector([sig('BTC', 80), sig('ETH', 80)]);
  assert.equal(a.layer1.verdict, 'strong_bullish');
  /* avg 60 → bullish */
  const b = aggregateBySector([sig('BTC', 60)]);
  assert.equal(b.layer1.verdict, 'bullish');
  /* avg 35 → neutral */
  const c = aggregateBySector([sig('BTC', 35)]);
  assert.equal(c.layer1.verdict, 'neutral');
  /* avg 20 → weak */
  const d = aggregateBySector([sig('BTC', 20)]);
  assert.equal(d.layer1.verdict, 'weak');
});

test('aggregateBySector — topSignals cap at 3 per sector', () => {
  const signals = [
    sig('BTC', 90),
    sig('ETH', 85),
    sig('SOL', 80),
    sig('AVAX', 75),
    sig('NEAR', 70),
  ];
  const out = aggregateBySector(signals);
  assert.equal(out.layer1.topSignals.length, 3);
  /* Sorted by score descending */
  assert.equal(out.layer1.topSignals[0].s, 'BTC');
  assert.equal(out.layer1.topSignals[1].s, 'ETH');
  assert.equal(out.layer1.topSignals[2].s, 'SOL');
});

test('aggregateBySector — unknown symbols are skipped silently', () => {
  const signals = [sig('BTC', 70), sig('UNKNOWNCOIN_FOO', 90)];
  const out = aggregateBySector(signals);
  assert.equal(out.layer1.count, 1);
});
