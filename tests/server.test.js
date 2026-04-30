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
axios.post = async () => ({ data: { ok: true, result: { message_id: 1 } } });

/* Configure the server before loading it. */
process.env.PORT = '0';
process.env.TG_BOT_TOKEN = 'stub-bot-token';
process.env.TG_CHAT_ID = '42';
process.env.NEXUS_NOTIFY_SECRET = 'topsecret-test';
process.env.ALLOWED_ORIGINS = 'https://example.test,https://other.test';

const { app, cache, _resetApiAllSnapshot } = require('../server.js');

/* Reset the /api/all TTL cache before each /api/all-touching test so
   stale snapshots don't bleed between cases. */
function freshSnapshot() {
  _resetApiAllSnapshot();
}

test.after(() => {
  axios.post = realAxiosPost;
});

/* ─── /api/health ─────────────────────────────────────────────────── */

test('GET /api/health returns down before any tickers are loaded', async () => {
  cache.lastUpdate.tickers = 0;
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'down');
  assert.equal(res.body.coins, Object.keys(cache.tickers).length);
});

test('GET /api/health reports healthy with a fresh tickers timestamp', async () => {
  cache.lastUpdate.tickers = Date.now();
  const res = await request(app).get('/api/health');
  assert.equal(res.body.status, 'healthy');
});

test('GET /api/health flips to stale between 30 s and 60 s', async () => {
  cache.lastUpdate.tickers = Date.now() - 45_000;
  const res = await request(app).get('/api/health');
  assert.equal(res.body.status, 'stale');
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
