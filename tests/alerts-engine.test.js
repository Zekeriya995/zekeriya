/* Unit tests for src/alerts-engine.js — the user-defined custom
   alert evaluator. Covers parser correctness, validation, field
   readout from the cache, and the runAlertsCheck triage between
   fired / kept / removed. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRule,
  validateAlertInput,
  evaluateAlert,
  runAlertsCheck,
  MAX_PER_USER,
} = require('../src/alerts-engine');

/* ─── parseRule ──────────────────────────────────────────────────── */

test('parseRule — accepts the four supported fields', () => {
  for (const f of ['price', 'change', 'rsi', 'score']) {
    const r = parseRule(f + '>=10');
    assert.ok(r);
    assert.equal(r.field, f);
    assert.equal(r.value, 10);
  }
});

test('parseRule — accepts both operators', () => {
  assert.equal(parseRule('price>=100').op, '>=');
  assert.equal(parseRule('price<=100').op, '<=');
});

test('parseRule — rejects unsupported field', () => {
  assert.equal(parseRule('volume>=100'), null);
});

test('parseRule — rejects unsupported operator', () => {
  assert.equal(parseRule('price>100'), null);
  assert.equal(parseRule('price=100'), null);
});

test('parseRule — rejects non-numeric value', () => {
  assert.equal(parseRule('price>=abc'), null);
});

test('parseRule — strips whitespace', () => {
  assert.equal(parseRule(' price >= 100 ').value, 100);
});

test('parseRule — accepts decimal and negative values', () => {
  assert.equal(parseRule('change>=-5').value, -5);
  assert.equal(parseRule('price>=99.5').value, 99.5);
});

test('parseRule — rejects garbage', () => {
  assert.equal(parseRule(''), null);
  assert.equal(parseRule(null), null);
  assert.equal(parseRule({}), null);
});

/* ─── validateAlertInput ─────────────────────────────────────────── */

test('validateAlertInput — null on valid input', () => {
  assert.equal(validateAlertInput({ sym: 'BTC', rule: 'price>=100' }, 0), null);
});

test('validateAlertInput — flags missing fields with stable error codes', () => {
  assert.equal(validateAlertInput({}, 0), 'sym_required');
  assert.equal(validateAlertInput({ sym: 'BTC' }, 0), 'rule_required');
  assert.equal(validateAlertInput({ sym: 'BTC', rule: 'lol' }, 0), 'rule_invalid');
});

test('validateAlertInput — caps per-user count', () => {
  assert.equal(
    validateAlertInput({ sym: 'BTC', rule: 'price>=100' }, MAX_PER_USER),
    'limit_reached'
  );
});

test('validateAlertInput — sym length cap', () => {
  assert.equal(validateAlertInput({ sym: 'A'.repeat(20), rule: 'price>=1' }, 0), 'sym_too_long');
});

/* ─── evaluateAlert ──────────────────────────────────────────────── */

test('evaluateAlert — price rule against cache.tickers', () => {
  const cache = { tickers: { BTC: { price: 110_000, change: 1, volume: 1e8 } } };
  assert.equal(evaluateAlert({ sym: 'BTC', rule: 'price>=100000' }, cache), true);
  assert.equal(evaluateAlert({ sym: 'BTC', rule: 'price>=120000' }, cache), false);
  assert.equal(evaluateAlert({ sym: 'BTC', rule: 'price<=100000' }, cache), false);
});

test('evaluateAlert — change rule', () => {
  const cache = { tickers: { ETH: { change: -7 } } };
  assert.equal(evaluateAlert({ sym: 'ETH', rule: 'change<=-5' }, cache), true);
  assert.equal(evaluateAlert({ sym: 'ETH', rule: 'change>=0' }, cache), false);
});

test('evaluateAlert — rsi rule reads cache.indicators', () => {
  const cache = { indicators: { BTC: { rsi: 75 } } };
  assert.equal(evaluateAlert({ sym: 'BTC', rule: 'rsi>=70' }, cache), true);
  assert.equal(evaluateAlert({ sym: 'BTC', rule: 'rsi<=30' }, cache), false);
});

test('evaluateAlert — score rule reads cache.signals', () => {
  const cache = { signals: [{ s: 'SOL', score: 95 }] };
  assert.equal(evaluateAlert({ sym: 'SOL', rule: 'score>=90' }, cache), true);
  assert.equal(evaluateAlert({ sym: 'SOL', rule: 'score>=100' }, cache), false);
});

test('evaluateAlert — missing data returns false (not throw)', () => {
  assert.equal(evaluateAlert({ sym: 'XYZ', rule: 'price>=1' }, {}), false);
  assert.equal(evaluateAlert({ sym: 'XYZ', rule: 'rsi>=50' }, {}), false);
});

test('evaluateAlert — malformed rule short-circuits', () => {
  const cache = { tickers: { BTC: { price: 1 } } };
  assert.equal(evaluateAlert({ sym: 'BTC', rule: 'lol' }, cache), false);
});

/* ─── runAlertsCheck ─────────────────────────────────────────────── */

test('runAlertsCheck — one-shot fires once and is removed', () => {
  const alerts = [{ id: 'a1', sym: 'BTC', rule: 'price>=100', endpoint: 'x' }];
  const cache = { tickers: { BTC: { price: 200 } } };
  const out = runAlertsCheck(alerts, cache, 1000);
  assert.equal(out.fired.length, 1);
  assert.deepEqual(out.removed, ['a1']);
  assert.equal(out.kept.length, 0);
});

test('runAlertsCheck — non-matching alerts stay kept', () => {
  const alerts = [{ id: 'a1', sym: 'BTC', rule: 'price>=999', endpoint: 'x' }];
  const cache = { tickers: { BTC: { price: 100 } } };
  const out = runAlertsCheck(alerts, cache, 1000);
  assert.equal(out.fired.length, 0);
  assert.equal(out.kept.length, 1);
});

test('runAlertsCheck — repeat fires + cools down', () => {
  const alerts = [{ id: 'r1', sym: 'BTC', rule: 'price>=100', endpoint: 'x', repeat: true }];
  const cache = { tickers: { BTC: { price: 200 } } };
  const out = runAlertsCheck(alerts, cache, 1_000_000);
  assert.equal(out.fired.length, 1);
  assert.equal(out.removed.length, 0);
  /* lastFiredAt is stamped on the kept copy. */
  assert.equal(out.kept[0].lastFiredAt, 1_000_000);
});

test('runAlertsCheck — repeat respects 30-min cooldown', () => {
  const alerts = [
    {
      id: 'r1',
      sym: 'BTC',
      rule: 'price>=100',
      endpoint: 'x',
      repeat: true,
      lastFiredAt: 0,
    },
  ];
  const cache = { tickers: { BTC: { price: 200 } } };
  const stillCooling = runAlertsCheck(alerts, cache, 10 * 60 * 1000);
  assert.equal(stillCooling.fired.length, 0);
  assert.equal(stillCooling.kept.length, 1);
  /* Past 30 min → fires again. */
  const refire = runAlertsCheck(alerts, cache, 31 * 60 * 1000);
  assert.equal(refire.fired.length, 1);
});

test('runAlertsCheck — bad input returns empty triage', () => {
  const out = runAlertsCheck(null, {}, 0);
  assert.deepEqual(out.fired, []);
  assert.deepEqual(out.kept, []);
  assert.deepEqual(out.removed, []);
});
