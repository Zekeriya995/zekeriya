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

test('NEXUS_SOURCES — covers the 11 verified live sources', () => {
  /* Expected size dropped from 12 → 11 after the unverified
     llama-emissions entry was removed (its URL produced HTTP 503
     from production probes; not part of DeFiLlama's published
     free API). When a verified upstream is identified, this
     count goes back up. */
  assert.equal(NEXUS_SOURCES.length, 11);
  const ids = NEXUS_SOURCES.map((s) => s.id);
  for (const required of ['proxy', 'bn-spot', 'bn-fut', 'coingecko', 'mempool']) {
    assert.ok(ids.includes(required), 'missing source: ' + required);
  }
});

test('NEXUS_SOURCES — deprecated/unverified token-unlock upstreams not in catalogue', () => {
  /* Both api.tokenomist.ai/v1/* (404) and api.llama.fi/emissions
     (503) failed in production probes. The catalogue must not
     surface them — falling silently to the relative-date fallback
     in fetchTokenUnlocks is the correct degraded behaviour. */
  const ids = NEXUS_SOURCES.map((s) => s.id);
  assert.ok(!ids.includes('tokenomist'));
  assert.ok(!ids.includes('llama-emissions'));
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

/* ─── pingSource retry-on-transient ───────────────────────────────── */

/* Drive the back-off to 0 in tests so we don't sleep 400 ms each retry. */
globalThis.window = globalThis.window || {};
globalThis.window.NEXUS_PROBE_RETRY_MS = 0;

test('pingSource — retries once on 503; counts only the final outcome', async () => {
  reset();
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    /* First attempt: 503. Retry: 200. */
    return attempts === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 };
  };
  const r = await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(attempts, 2, 'second attempt fired');
  assert.equal(r.ok, true, 'final result reflects the retry success');
  assert.equal(r.status, 200);
  assert.equal(sourceHealth.test.successCount, 1);
  assert.equal(sourceHealth.test.failCount, 0, 'transient failure not counted when retry succeeds');
});

test('pingSource — retries on 429 (rate-limit) too', async () => {
  reset();
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return attempts === 1 ? { ok: false, status: 429 } : { ok: true, status: 200 };
  };
  await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(attempts, 2);
});

test('pingSource — retries on network error', async () => {
  reset();
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) throw new Error('flaky');
    return { ok: true, status: 200 };
  };
  const r = await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(attempts, 2);
  assert.equal(r.ok, true);
});

test('pingSource — does NOT retry on 4xx (permanent error)', async () => {
  reset();
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return { ok: false, status: 404 };
  };
  const r = await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(attempts, 1, '404 is permanent — no retry');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test('pingSource — both attempts fail → final result reports the second outcome', async () => {
  reset();
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return { ok: false, status: 503 };
  };
  const r = await pingSource({ id: 'test', name: 'Test', url: () => 'https://x.test/' });
  assert.equal(attempts, 2);
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.equal(sourceHealth.test.failCount, 1, 'one persistent failure counted, not two');
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
