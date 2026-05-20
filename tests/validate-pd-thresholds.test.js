/* Unit tests for vps/validate-pd-thresholds.js — covers the pure
   aggregation + family-classification helpers. The CLI / I/O layer
   (parseArgs, loadHistory) is exercised via integration: it just
   reads the disk file and writes to stdout, so the helpers are
   what matter for correctness. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TAG_FAMILIES, aggregate, computeFamilyStats } = require('../vps/validate-pd-thresholds');

const NOW = 1_730_000_000_000;

function entry(over) {
  return Object.assign(
    {
      s: 'X',
      score: 105,
      tier: 'ULTRA',
      entryPrice: 100,
      tags: ['🐋ACC'],
      recordedAt: NOW - 60_000,
      evaluated: true,
      pctChange: 0,
      outcome: 'partial_win',
    },
    over
  );
}

/* ─── aggregate ────────────────────────────────────────────────── */

test('aggregate — empty array returns null win/avg fields', () => {
  const out = aggregate([]);
  assert.equal(out.count, 0);
  assert.equal(out.wins, 0);
  assert.equal(out.losses, 0);
  assert.equal(out.winRate, null);
  assert.equal(out.avgGain, null);
});

test('aggregate — wins / losses / winRate are correct', () => {
  const e = [
    entry({ outcome: 'win', pctChange: 8 }),
    entry({ outcome: 'win', pctChange: 6 }),
    entry({ outcome: 'loss', pctChange: -4 }),
    entry({ outcome: 'partial_win', pctChange: 2 }),
  ];
  const out = aggregate(e);
  assert.equal(out.count, 4);
  assert.equal(out.wins, 2);
  assert.equal(out.losses, 1);
  assert.equal(out.winRate, 50);
  assert.equal(out.avgGain, 3); /* mean of [8, 6, -4, 2] = 3 */
});

test('aggregate — winRate rounds to nearest percent', () => {
  /* 1 win / 3 → 33.333% → rounds to 33 */
  const e = [
    entry({ outcome: 'win', pctChange: 5 }),
    entry({ outcome: 'partial_win', pctChange: 2 }),
    entry({ outcome: 'partial_loss', pctChange: -2 }),
  ];
  const out = aggregate(e);
  assert.equal(out.winRate, 33);
});

/* ─── TAG_FAMILIES regex behaviour ─────────────────────────────── */

test('TAG_FAMILIES — P&D_RISK matches the 3+ flags tag including count suffix', () => {
  const fam = TAG_FAMILIES.find((f) => f.name === 'P&D_RISK');
  assert.ok(fam.re.test('🚨P&D_RISK:3/5'));
  assert.ok(fam.re.test('🚨P&D_RISK:5/5'));
  assert.ok(!fam.re.test('⚠️P&D_WARN:2/5'));
});

test('TAG_FAMILIES — anchored regex rejects future near-name tags (NIT B3)', () => {
  /* The post-review tightening anchors each family's regex at either
     `:` (for counted tags like P&D_RISK:3/5) or end-of-string (plain
     suffix tags). A future addition like `P&D_RISK_OVERRIDDEN` or
     `MANIP_CAP_PARTIAL` should NOT auto-bucket into the existing
     families. Locks the new boundaries. */
  const risk = TAG_FAMILIES.find((f) => f.name === 'P&D_RISK');
  const cap = TAG_FAMILIES.find((f) => f.name === 'MANIP_CAP');
  assert.ok(!risk.re.test('P&D_RISK_OVERRIDDEN'));
  assert.ok(!cap.re.test('MANIP_CAP_PARTIAL'));
  /* Sanity: the legitimate forms still match. */
  assert.ok(risk.re.test('🚨P&D_RISK:3/5'));
  assert.ok(cap.re.test('🚫MANIP_CAP'));
});

test('TAG_FAMILIES — MANIP_CAP matches the Phase 1.2 tier-cap tag', () => {
  const fam = TAG_FAMILIES.find((f) => f.name === 'MANIP_CAP');
  assert.ok(fam.re.test('🚫MANIP_CAP'));
  assert.ok(!fam.re.test('🚨MANIP_HIGH'));
});

test('TAG_FAMILIES — ATR_ZONES matches the Phase 2.A.4 tag', () => {
  const fam = TAG_FAMILIES.find((f) => f.name === 'ATR_ZONES');
  assert.ok(fam.re.test('📐ATR_ZONES'));
});

test('TAG_FAMILIES — every family has a unique name', () => {
  const names = TAG_FAMILIES.map((f) => f.name);
  assert.equal(names.length, new Set(names).size);
});

/* ─── computeFamilyStats ───────────────────────────────────────── */

test('computeFamilyStats — empty history yields zero baseline + all families empty', () => {
  const out = computeFamilyStats([], 30, NOW);
  assert.equal(out.baselineCount, 0);
  assert.equal(out.baselineStats.count, 0);
  for (const fam of out.families) {
    assert.equal(fam.stats.count, 0);
  }
});

test('computeFamilyStats — entries outside window are excluded', () => {
  const h = [
    entry({ s: 'IN', recordedAt: NOW - 1 * 24 * 60 * 60 * 1000 }),
    entry({ s: 'OUT', recordedAt: NOW - 60 * 24 * 60 * 60 * 1000 }),
  ];
  const out = computeFamilyStats(h, 30, NOW);
  assert.equal(out.baselineCount, 1);
});

test('computeFamilyStats — entries without tags are excluded from baseline', () => {
  const h = [
    entry({ s: 'A', tags: ['🐋ACC'], outcome: 'win', pctChange: 7 }),
    entry({ s: 'B', tags: undefined, outcome: 'win', pctChange: 7 }),
    entry({ s: 'C', tags: [], outcome: 'win', pctChange: 7 }),
  ];
  const out = computeFamilyStats(h, 30, NOW);
  assert.equal(out.baselineCount, 1, 'only A has usable tags');
});

test('computeFamilyStats — P&D_WARN family counts correctly', () => {
  const h = [
    entry({ s: 'A', tags: ['⚠️P&D_WARN:2/5'], outcome: 'win', pctChange: 7 }),
    entry({ s: 'B', tags: ['⚠️P&D_WARN:2/5'], outcome: 'loss', pctChange: -5 }),
    entry({ s: 'C', tags: ['🐋ACC'], outcome: 'win', pctChange: 7 }),
  ];
  const out = computeFamilyStats(h, 30, NOW);
  const warn = out.families.find((f) => f.name === 'P&D_WARN');
  assert.equal(warn.stats.count, 2);
  assert.equal(warn.stats.wins, 1);
  assert.equal(warn.stats.losses, 1);
  assert.equal(warn.stats.winRate, 50);
});

test('computeFamilyStats — entry with multiple matching tags counts in each family', () => {
  /* A signal with both ⚠️P&D_WARN and 🚫MANIP_CAP should contribute
     to BOTH families (they answer different questions). */
  const h = [
    entry({
      s: 'X',
      tags: ['⚠️P&D_WARN:2/5', '🚫MANIP_CAP'],
      outcome: 'loss',
      pctChange: -6,
    }),
  ];
  const out = computeFamilyStats(h, 30, NOW);
  const warn = out.families.find((f) => f.name === 'P&D_WARN');
  const cap = out.families.find((f) => f.name === 'MANIP_CAP');
  assert.equal(warn.stats.count, 1);
  assert.equal(cap.stats.count, 1);
});

test('computeFamilyStats — suppression family with lower winRate confirms the threshold works', () => {
  /* Realistic shape: baseline 50% winRate, P&D_WARN coins 20% winRate.
     A correctly-firing suppression tag should drag winRate DOWN
     (those signals SHOULD have been suppressed in retrospect). */
  const h = [];
  for (let i = 0; i < 5; i++) {
    h.push(entry({ s: 'CLEAN' + i, outcome: i < 3 ? 'win' : 'loss', pctChange: i < 3 ? 6 : -4 }));
  }
  for (let i = 0; i < 5; i++) {
    h.push(
      entry({
        s: 'PD' + i,
        tags: ['🐋ACC', '⚠️P&D_WARN:2/5'],
        outcome: i < 1 ? 'win' : 'loss',
        pctChange: i < 1 ? 6 : -5,
      })
    );
  }
  const out = computeFamilyStats(h, 30, NOW);
  const warn = out.families.find((f) => f.name === 'P&D_WARN');
  assert.equal(out.baselineStats.winRate, 40, 'baseline = 4 wins / 10 = 40%');
  assert.equal(warn.stats.winRate, 20, 'P&D_WARN = 1 win / 5 = 20%');
  assert.ok(
    warn.stats.winRate < out.baselineStats.winRate,
    'suppression tag should have LOWER win rate than baseline'
  );
});
