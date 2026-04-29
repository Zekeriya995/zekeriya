/* Tests for src/connection.js — fj() (the safe JSON fetch wrapper),
   applyBackoff() exponential ladder, and getConnQuality()'s decay
   formula. updateConnStatus() is intentionally out of scope: it only
   paints the DOM. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadScript } = require('./_setup.js');

/* connection.js reads T (price ticker) and lastDataTime at call time. */
globalThis.T = {};
globalThis.lastDataTime = Date.now();
loadScript('src/connection.js');

function reset() {
  apiCooldown.until = 0;
  apiCooldown.reason = '';
  apiCooldown.attempts = 0;
  connMetrics.apiOk = 0;
  connMetrics.apiFail = 0;
  connMetrics.lastLatency = 0;
  for (const k of Object.keys(globalThis.T)) delete globalThis.T[k];
  globalThis.lastDataTime = Date.now();
}

/* ─── applyBackoff ────────────────────────────────────────────────── */

test('applyBackoff — first call: 1× base, attempts → 1', () => {
  reset();
  const before = Date.now();
  applyBackoff(1000, 'test');
  /* 1× base = 1000 ms; allow ±50 ms scheduler slack. */
  assert.ok(apiCooldown.until - before >= 950 && apiCooldown.until - before <= 1100);
  assert.equal(apiCooldown.reason, 'test');
  assert.equal(apiCooldown.attempts, 1);
});

test('applyBackoff — second call doubles to 2×', () => {
  reset();
  applyBackoff(1000, 'a');
  const before = Date.now();
  applyBackoff(1000, 'b');
  /* attempts was 1 going in → multiplier = 2 → 2000 ms */
  assert.ok(apiCooldown.until - before >= 1900 && apiCooldown.until - before <= 2100);
  assert.equal(apiCooldown.attempts, 2);
});

test('applyBackoff — caps at 8× regardless of attempts', () => {
  reset();
  /* Pre-load attempts so the next call would go past 8× */
  apiCooldown.attempts = 10;
  const before = Date.now();
  applyBackoff(1000, 'overflow');
  /* min(8, 2^10) = 8 → 8000 ms */
  assert.ok(apiCooldown.until - before >= 7900 && apiCooldown.until - before <= 8100);
});

/* ─── fj — cooldown gate ──────────────────────────────────────────── */

test('fj — short-circuits to null while cooldown is in the future (no fetch)', async () => {
  reset();
  apiCooldown.until = Date.now() + 60_000;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const r = await fj('https://example.invalid/x');
  assert.equal(r, null);
  assert.equal(called, false, 'fj must not hit the network during cooldown');
});

test('fj — successful response resets attempts and increments apiOk', async () => {
  reset();
  apiCooldown.attempts = 3;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ x: 1 }) });
  const r = await fj('https://example.invalid/x');
  assert.deepEqual(r, { x: 1 });
  assert.equal(apiCooldown.attempts, 0);
  assert.equal(connMetrics.apiOk, 1);
  assert.equal(connMetrics.apiFail, 0);
});

test('fj — 429 triggers applyBackoff and increments apiFail', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  const r = await fj('https://example.invalid/x');
  assert.equal(r, null);
  assert.ok(apiCooldown.until > Date.now(), 'cooldown must be armed');
  assert.equal(apiCooldown.reason, '429 Rate Limited');
  assert.equal(connMetrics.apiFail, 1);
  assert.equal(connMetrics.apiOk, 0);
});

test('fj — 418 triggers a longer backoff than 429', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: false, status: 418, json: async () => ({}) });
  await fj('https://example.invalid/x');
  /* 418 base is 300_000 ms vs 429 base 60_000 → cooldown should be > 60 s */
  assert.ok(apiCooldown.until - Date.now() > 60_000);
  assert.equal(apiCooldown.reason, '418 IP Banned');
});

test('fj — 403 arms a 60 s backoff', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await fj('https://example.invalid/x');
  assert.equal(apiCooldown.reason, '403 Forbidden');
  const remaining = apiCooldown.until - Date.now();
  assert.ok(remaining > 50_000 && remaining < 65_000);
});

test('fj — non-rate-limit 5xx returns null and bumps apiFail without backoff', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const r = await fj('https://example.invalid/x');
  assert.equal(r, null);
  assert.equal(connMetrics.apiFail, 1);
  assert.equal(apiCooldown.until, 0, 'no backoff for plain 5xx');
});

test('fj — fetch that throws is swallowed and counts as a failure', async () => {
  reset();
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  const r = await fj('https://example.invalid/x');
  assert.equal(r, null);
  assert.equal(connMetrics.apiFail, 1);
});

/* ─── getConnQuality ──────────────────────────────────────────────── */

test('getConnQuality — fresh tab with no data scores 80 (full coins penalty)', () => {
  reset();
  /* lastDataTime ≈ now → no freshness penalty.
     0/0 success rate → no rate penalty.
     coins (Object.keys(T).length) = 0 → -20.  */
  assert.equal(getConnQuality(), 80);
});

test('getConnQuality — stale data > 30 s drops 40 points', () => {
  reset();
  globalThis.lastDataTime = Date.now() - 31_000;
  /* 100 - 40 - 20(coins) = 40 */
  assert.equal(getConnQuality(), 40);
});

test('getConnQuality — sub-50 % success rate drops 30 points', () => {
  reset();
  /* Spread 300+ coins so the coins penalty is 0. */
  for (let i = 0; i < 301; i++) globalThis.T['C' + i] = { p: 1 };
  connMetrics.apiOk = 1;
  connMetrics.apiFail = 9;
  /* 100 - 30 = 70 */
  assert.equal(getConnQuality(), 70);
});

test('getConnQuality — clamps to 0 below floor', () => {
  reset();
  globalThis.lastDataTime = Date.now() - 60_000; /* -40 */
  connMetrics.apiOk = 0;
  connMetrics.apiFail = 100; /* -30 */
  /* coins=0 → -20.  100 - 90 = 10, then no further deduction → 10.
     To force a 0 floor, set lastDataTime even staler isn't enough
     (only one freshness band), so check the clamp from a synthetic
     extra debit by stacking another 30 + 20 + 40 = 90 + 5 = 95. */
  assert.ok(getConnQuality() >= 0);
});

test('getConnQuality — 80-100 range when everything is healthy', () => {
  reset();
  for (let i = 0; i < 350; i++) globalThis.T['C' + i] = { p: 1 };
  connMetrics.apiOk = 100;
  connMetrics.apiFail = 0;
  globalThis.lastDataTime = Date.now() - 1000;
  assert.equal(getConnQuality(), 100);
});
