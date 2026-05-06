/* HTTP-level integration tests for server.js.

   Drives the Express app via supertest — no real listening socket is
   opened, the data-refresh loops are skipped (they only start when
   server.js is run directly), and axios.post is stubbed so /notify
   doesn't try to reach Telegram. */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

/* Stub axios.post BEFORE requiring server.js so the /notify path
   doesn't try to make a real Telegram API call. */
const axios = require('axios');
const realAxiosPost = axios.post;
const realAxiosGet = axios.get;
axios.post = async () => ({ data: { ok: true, result: { message_id: 1 } } });

/* Configure the server before loading it. */
process.env.PORT = '0';
process.env.TG_BOT_TOKEN = 'stub-bot-token';
process.env.TG_CHAT_ID = '42';
process.env.NEXUS_NOTIFY_SECRET = 'topsecret-test';
process.env.ALLOWED_ORIGINS = 'https://example.test,https://other.test';

const {
  app,
  cache,
  _resetApiAllSnapshot,
  safeFetch,
  upstreamMetrics,
  upstreamByLabel,
  responseMetrics,
  evaluateAlerts,
} = require('../server.js');

/* Reset the /api/all TTL cache before each /api/all-touching test so
   stale snapshots don't bleed between cases. */
function freshSnapshot() {
  _resetApiAllSnapshot();
}

test.after(() => {
  axios.post = realAxiosPost;
  axios.get = realAxiosGet;
});

/* ─── safeFetch retries ───────────────────────────────────────────── */

function _resetUpstreamMetrics() {
  upstreamMetrics.success = 0;
  upstreamMetrics.retried = 0;
  upstreamMetrics.failed = 0;
  upstreamMetrics.rateLimited = 0;
  upstreamMetrics.timeout = 0;
}

test('safeFetch retries on 429 and succeeds on the second attempt', async () => {
  _resetUpstreamMetrics();
  let calls = 0;
  axios.get = async () => {
    calls++;
    if (calls === 1) {
      const err = new Error('429');
      err.response = { status: 429 };
      throw err;
    }
    return { data: { ok: true } };
  };
  const result = await safeFetch('https://api.binance.com/api/v3/ping', 'TEST-429');
  axios.get = realAxiosGet;
  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: true });
  assert.equal(upstreamMetrics.success, 1);
  assert.equal(upstreamMetrics.retried, 1);
  assert.equal(upstreamMetrics.rateLimited, 1);
  assert.equal(upstreamMetrics.failed, 0);
});

test('safeFetch does not retry on 4xx other than 429', async () => {
  _resetUpstreamMetrics();
  let calls = 0;
  axios.get = async () => {
    calls++;
    const err = new Error('400');
    err.response = { status: 400 };
    throw err;
  };
  const result = await safeFetch('https://api.binance.com/api/v3/ping', 'TEST-400');
  axios.get = realAxiosGet;
  assert.equal(calls, 1);
  assert.equal(result, null);
  assert.equal(upstreamMetrics.failed, 1);
  assert.equal(upstreamMetrics.retried, 0);
});

test('safeFetch retries on network errors and gives up after the configured cap', async () => {
  _resetUpstreamMetrics();
  let calls = 0;
  axios.get = async () => {
    calls++;
    const err = new Error('timeout');
    /* No err.response → treated as a network/timeout error */
    throw err;
  };
  const result = await safeFetch('https://api.binance.com/api/v3/ping', 'TEST-NET', {
    retries: 1,
  });
  axios.get = realAxiosGet;
  assert.equal(calls, 2);
  assert.equal(result, null);
  assert.equal(upstreamMetrics.failed, 1);
  assert.equal(upstreamMetrics.timeout, 2);
});

/* ─── /api/health ─────────────────────────────────────────────────── */

test('GET /api/health returns 503 + status=down before any tickers are loaded', async () => {
  cache.lastUpdate.tickers = 0;
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'down');
  assert.equal(res.body.coins, Object.keys(cache.tickers).length);
});

test('GET /api/health reports healthy with a fresh tickers timestamp', async () => {
  cache.lastUpdate.tickers = Date.now();
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'healthy');
});

test('GET /api/health flips to stale between 30 s and 60 s', async () => {
  cache.lastUpdate.tickers = Date.now() - 45_000;
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'stale');
});

test('GET /api/health exposes per-cache ages with status classification', async () => {
  const now = Date.now();
  cache.lastUpdate.tickers = now;
  cache.lastUpdate.fr = now - 200_000;
  cache.lastUpdate.oi = 0;
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.ok(res.body.ages, 'ages object is present');
  assert.equal(res.body.ages.tickers.status, 'healthy');
  assert.equal(res.body.ages.fr.status, 'stale');
  assert.equal(res.body.ages.oi.status, 'down');
  assert.equal(res.body.ages.oi.ageMs, null);
});

/* ─── /api/metrics ────────────────────────────────────────────────── */

function _resetUpstreamByLabel() {
  for (const k of Object.keys(upstreamByLabel)) delete upstreamByLabel[k];
}

test('GET /api/metrics returns process + cache + upstream + alerts shape', async () => {
  cache.lastUpdate.tickers = Date.now();
  const res = await request(app).get('/api/metrics');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(typeof res.body.timestamp === 'number');
  assert.ok(typeof res.body.uptime === 'number');
  assert.ok(res.body.process);
  assert.ok(typeof res.body.process.heapUsedMb === 'number');
  assert.ok(res.body.cache);
  assert.ok(res.body.ages);
  assert.ok(res.body.upstream);
  assert.ok(res.body.upstream.total);
  assert.ok(res.body.upstream.byLabel);
  assert.ok(res.body.requests);
  assert.ok(Array.isArray(res.body.alerts));
});

test('GET /api/metrics tracks per-label upstream after a real safeFetch error', async () => {
  _resetUpstreamMetrics();
  _resetUpstreamByLabel();
  axios.get = async () => {
    const err = new Error('400');
    err.response = { status: 400 };
    throw err;
  };
  await safeFetch('https://api.binance.com/api/v3/ping', 'TEST-LABEL');
  axios.get = realAxiosGet;
  const res = await request(app).get('/api/metrics');
  assert.equal(res.status, 200);
  assert.ok(res.body.upstream.byLabel['TEST-LABEL']);
  assert.equal(res.body.upstream.byLabel['TEST-LABEL'].failed, 1);
  assert.equal(res.body.upstream.byLabel['TEST-LABEL'].lastError, 'HTTP 400');
});

test('evaluateAlerts surfaces a critical alert when tickers cache is down', () => {
  cache.lastUpdate.tickers = 0;
  const alerts = evaluateAlerts(Date.now());
  const tickerAlert = alerts.find((a) => a.source === 'tickers');
  assert.ok(tickerAlert);
  assert.equal(tickerAlert.level, 'critical');
});

test('evaluateAlerts ignores low-volume failures (under min-call threshold)', () => {
  _resetUpstreamMetrics();
  _resetUpstreamByLabel();
  cache.lastUpdate.tickers = Date.now();
  /* One failed call → ratio 100 % but volume below threshold */
  upstreamByLabel['LIGHT-LOAD'] = {
    success: 0,
    failed: 1,
    retried: 0,
    rateLimited: 0,
    timeout: 0,
    lastError: 'HTTP 500',
    lastErrorAt: Date.now(),
  };
  const alerts = evaluateAlerts(Date.now());
  assert.ok(!alerts.find((a) => a.source === 'LIGHT-LOAD'));
});

test('evaluateAlerts fires when failure ratio exceeds 20 % over enough calls', () => {
  _resetUpstreamMetrics();
  _resetUpstreamByLabel();
  cache.lastUpdate.tickers = Date.now();
  upstreamByLabel['HOT-LOAD'] = {
    success: 30,
    failed: 20 /* 40 % failure ratio over 50 calls */,
    retried: 0,
    rateLimited: 0,
    timeout: 0,
    lastError: 'HTTP 503',
    lastErrorAt: Date.now(),
  };
  const alerts = evaluateAlerts(Date.now());
  const hot = alerts.find((a) => a.source === 'HOT-LOAD');
  assert.ok(hot);
  assert.equal(hot.level, 'warning');
});

test('responseMetrics counters increment on the public endpoints', async () => {
  cache.lastUpdate.tickers = Date.now();
  const before = { ...responseMetrics };
  await request(app).get('/api/health');
  await request(app).get('/api/metrics');
  assert.equal(responseMetrics.apiHealth, before.apiHealth + 1);
  assert.equal(responseMetrics.apiMetrics, before.apiMetrics + 1);
});

/* ─── /api/all ────────────────────────────────────────────────────── */

test('GET /api/all returns the cache snapshot with a Cache-Control header', async () => {
  freshSnapshot();
  cache.tickers.BTC = { price: 50_000, change: 1.2, volume: 1, high: 0, low: 0, src: 'BN' };
  cache.lastUpdate.tickers = Date.now();
  const res = await request(app).get('/api/all');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /max-age=\d+/);
  assert.ok(res.body.tickers.BTC);
  assert.equal(res.body.tickers.BTC.price, 50_000);
  assert.ok(typeof res.body.meta.snapshotAt === 'number');
});

test('GET /api/all returns the SAME snapshotAt within the TTL window', async () => {
  freshSnapshot();
  cache.tickers.BTC = { price: 60_000, change: 0, volume: 0, high: 0, low: 0, src: 'BN' };
  const r1 = await request(app).get('/api/all');
  const r2 = await request(app).get('/api/all');
  assert.equal(r1.body.meta.snapshotAt, r2.body.meta.snapshotAt);
});

test('GET /api/all clones cache so a later mutation does not reflect in the response body', async () => {
  freshSnapshot();
  cache.tickers.RACE = { price: 1, change: 0, volume: 0, high: 0, low: 0, src: 'BN' };
  const res = await request(app).get('/api/all');
  /* After the response is built, mutate the live cache. The serialised
     body must still show the snapshot price. */
  cache.tickers.RACE.price = 999;
  assert.equal(res.body.tickers.RACE.price, 1, 'snapshot must be a copy, not a reference');
});

/* ─── POST /notify ────────────────────────────────────────────────── */

test('POST /notify rejects requests with no Origin header (403)', async () => {
  const res = await request(app)
    .post('/notify')
    .set('X-Notify-Secret', 'topsecret-test')
    .send({ message: 'hi' });
  assert.equal(res.status, 403);
});

test('POST /notify rejects bad shared secret (401)', async () => {
  const res = await request(app)
    .post('/notify')
    .set('Origin', 'https://example.test')
    .set('X-Notify-Secret', 'wrong')
    .send({ message: 'hi' });
  assert.equal(res.status, 401);
});

test('POST /notify rejects empty message (400)', async () => {
  const res = await request(app)
    .post('/notify')
    .set('Origin', 'https://example.test')
    .set('X-Notify-Secret', 'topsecret-test')
    .send({});
  assert.equal(res.status, 400);
});

test('POST /notify accepts a valid request (200)', async () => {
  const res = await request(app)
    .post('/notify')
    .set('Origin', 'https://example.test')
    .set('X-Notify-Secret', 'topsecret-test')
    .send({ message: '<b>hello</b>' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('POST /notify rejects non-string message (400)', async () => {
  const res = await request(app)
    .post('/notify')
    .set('Origin', 'https://example.test')
    .set('X-Notify-Secret', 'topsecret-test')
    .send({ message: { not: 'a string' } });
  assert.equal(res.status, 400);
});

test('POST /notify rejects an Origin not in ALLOWED_ORIGINS', async () => {
  const res = await request(app)
    .post('/notify')
    .set('Origin', 'https://attacker.invalid')
    .set('X-Notify-Secret', 'topsecret-test')
    .send({ message: 'hi' });
  /* CORS rejects with a 500-class error before the handler runs.
     The exact status depends on cors version; assert it isn't a 200. */
  assert.notEqual(res.status, 200);
});

/* ─── 404 / unmatched ─────────────────────────────────────────────── */

test('GET / on an unmatched route returns 404', async () => {
  const res = await request(app).get('/some-random-path');
  assert.equal(res.status, 404);
});
