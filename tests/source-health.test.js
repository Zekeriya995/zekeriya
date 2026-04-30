/* Tests for src/source-health.js — verify the per-source counter
   accounting, timeout / network-error handling, and the catalogue
   stays in sync with the proxy / Binance constants the rest of the
   app uses. */

const test = require('node:test');
const assert = require('node:assert/strict');

/* The module reads PROXY / BN / BF / CG / CB at call time. Set them
   before loading so the `function () { return BN + '/ping' }` shapes
   resolve correctly. */
globalThis.PROXY = 'https://proxy.test';
globalThis.BN = 'https://api.binance.com/api/v3';
globalThis.BF = 'https://fapi.binance.com/fapi/v1';
globalThis.CG = 'https://api.coingecko.com/api/v3';
globalThis.CB = 'https://api.coinbase.com/v2';

const { loadScript } = require('./_setup.js');
loadScript('src/source-health.js');

function reset() {
  resetSourceHealth();
}

/* ─── catalogue invariants ────────────────────────────────────────── */

test('NEXUS_SOURCES — covers all 12 documented sources', () => {
  assert.equal(NEXUS_SOURCES.length, 12, 'audit lists 10 + Coinbase + Telegram-via-proxy = 12');
  const ids = NEXUS_SOURCES.map((s) => s.id);
  for (const required of ['proxy', 'bn-spot', 'bn-fut', 'coingecko', 'mempool']) {
    assert.ok(ids.includes(required), 'missing source: ' + required);
  }
});

test('NEXUS_SOURCES — all entries have id, name, url(), critical', () => {
  for (const s of NEXUS_SOURCES) {
    assert.equal(typeof s.id, 'string');
    assert.equal(typeof s.name, 'string');
    assert.equal(typeof s.url, 'function');
    assert.equal(typeof s.critical, 'boolean');
    const u = s.url();
    assert.match(u, /^https:\/\//, s.id + ' must be https://');
  }
});

test('NEXUS_SOURCES — proxy URL respects PROXY override', () => {
  const proxySpec = NEXUS_SOURCES.find((s) => s.id === 'proxy');
  assert.equal(proxySpec.url(), 'https://proxy.test/api/health');
});

test('NEXUS_SOURCES — at least three sources marked critical', () => {
  const crit = NEXUS_SOURCES.filter((s) => s.critical);
  assert.ok(crit.length >= 3, 'proxy + binance spot + binance futures at minimum');
});

/* ─── pingSource — success path ───────────────────────────────────── */

test('pingSource — successful 200 increments successCount + lastLatencyMs', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  const r = await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.ok(r.ms >= 0 && r.ms < 1000, 'realistic latency');
  assert.equal(sourceHealth.test.successCount, 1);
  assert.equal(sourceHealth.test.failCount, 0);
  assert.equal(sourceHealth.test.lastStatus, 200);
  assert.equal(sourceHealth.test.lastError, null);
});

test('pingSource — 4xx / 5xx status counts as failure', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const r = await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.equal(sourceHealth.test.failCount, 1);
  assert.equal(sourceHealth.test.lastError, 'HTTP 503');
});

test('pingSource — fetch throw counts as NETWORK_ERROR', async () => {
  reset();
  globalThis.fetch = async () => {
    throw new Error('refused');
  };
  const r = await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.equal(sourceHealth.test.failCount, 1);
  assert.equal(sourceHealth.test.lastError, 'refused');
});

test('pingSource — AbortError is reported as TIMEOUT (not raw message)', async () => {
  reset();
  globalThis.fetch = async () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  };
  const r = await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(r.error, 'TIMEOUT');
  assert.equal(sourceHealth.test.lastError, 'TIMEOUT');
});

test('pingSource — multiple successes accumulate', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  const spec = { id: 'test', name: 'Test', url: () => 'https://x.test/' };
  await pingSource(spec);
  await pingSource(spec);
  await pingSource(spec);
  assert.equal(sourceHealth.test.successCount, 3);
  assert.equal(sourceHealth.test.failCount, 0);
});

test('pingSource — success after failure clears lastError but keeps failCount', async () => {
  reset();
  /* First call: failure */
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(sourceHealth.test.failCount, 1);
  /* Second call: success */
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(sourceHealth.test.successCount, 1);
  assert.equal(sourceHealth.test.failCount, 1, 'failCount is monotonic');
  assert.equal(sourceHealth.test.lastError, null, 'success clears lastError');
});

/* ─── pingAllSources ──────────────────────────────────────────────── */

test('pingAllSources — probes every NEXUS_SOURCES entry exactly once', async () => {
  reset();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200 };
  };
  const results = await pingAllSources();
  assert.equal(calls, NEXUS_SOURCES.length);
  assert.equal(results.length, NEXUS_SOURCES.length);
  assert.ok(results.every((r) => r.ok));
});

test('pingAllSources — partial failures still resolve every entry', async () => {
  reset();
  let i = 0;
  globalThis.fetch = async () => {
    i++;
    /* Fail every other request. */
    if (i % 2 === 0) throw new Error('flaky');
    return { ok: true, status: 200 };
  };
  const results = await pingAllSources();
  assert.equal(results.length, NEXUS_SOURCES.length, 'no entry dropped on failure');
  assert.ok(results.some((r) => r.ok) && results.some((r) => !r.ok), 'mixed outcome reflected');
});

/* ─── resetSourceHealth ───────────────────────────────────────────── */

test('resetSourceHealth — wipes every counter', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(sourceHealth.test.successCount, 1);
  resetSourceHealth();
  assert.equal(Object.keys(sourceHealth).length, 0);
});
