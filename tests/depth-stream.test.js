const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup.js');

/* Same WebSocket stub pattern as kline-stream.test.js. depth-stream
   has the same lifecycle shape — multiplex per-symbol, fan-out to
   subscribers, replay last frame on late subscribe — so the tests
   mirror kline-stream's. */
let lastSocket = null;

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    lastSocket = this;
  }
  close() {
    this.closed = true;
    if (typeof this.onclose === 'function') this.onclose();
  }
}

globalThis.WebSocket = MockWebSocket;
globalThis.window = globalThis.window || { addEventListener: () => {} };
loadScript('src/depth-stream.js');
const DepthStream = globalThis.window.DepthStream;

function deliverBook(socket, bids, asks) {
  socket.onmessage({
    data: JSON.stringify({ E: Date.now(), bids: bids, asks: asks }),
  });
}

test('subscribe — opens one socket per symbol, depth20@100ms URL', () => {
  lastSocket = null;
  const sub = DepthStream.subscribe('BTCUSDT', () => {});
  assert.ok(lastSocket instanceof MockWebSocket);
  assert.match(lastSocket.url, /btcusdt@depth20@100ms$/);
  sub.close();
});

test('subscribe — onmessage normalises bids and asks into {p, q} objects', () => {
  lastSocket = null;
  let captured = null;
  const sub = DepthStream.subscribe('ETHUSDT', (book) => {
    captured = book;
  });
  deliverBook(
    lastSocket,
    [
      ['100.5', '2'],
      ['100.4', '5'],
      ['100.3', '0'],
    ] /* last entry is filtered: q=0 */,
    [
      ['100.6', '1.5'],
      ['100.7', '3'],
    ]
  );
  assert.ok(captured);
  assert.equal(captured.bids.length, 2, 'zero-quantity entries are stripped');
  assert.deepEqual(captured.bids[0], { p: 100.5, q: 2 });
  assert.deepEqual(captured.bids[1], { p: 100.4, q: 5 });
  assert.equal(captured.asks.length, 2);
  assert.deepEqual(captured.asks[0], { p: 100.6, q: 1.5 });
  assert.deepEqual(captured.asks[1], { p: 100.7, q: 3 });
  sub.close();
});

test('subscribe — caps both sides at 20 levels (defensive against gateway changes)', () => {
  lastSocket = null;
  let captured = null;
  const sub = DepthStream.subscribe('SOLUSDT', (book) => {
    captured = book;
  });
  const big = [];
  for (let i = 0; i < 50; i++) big.push([String(100 - i), '1']);
  deliverBook(lastSocket, big, big);
  assert.equal(captured.bids.length, 20);
  assert.equal(captured.asks.length, 20);
  sub.close();
});

test('subscribe — filters out non-numeric / negative levels', () => {
  lastSocket = null;
  let captured = null;
  const sub = DepthStream.subscribe('XRPUSDT', (book) => {
    captured = book;
  });
  deliverBook(
    lastSocket,
    [
      ['1.0', '5'],
      ['NaN', '5'],
      ['-2.0', '5'],
      ['0.9', '0'],
      ['0.8', '7'],
    ],
    [['1.1', '3']]
  );
  assert.equal(captured.bids.length, 2, 'only the two valid bid rows survive');
  assert.deepEqual(captured.bids[0], { p: 1, q: 5 });
  assert.deepEqual(captured.bids[1], { p: 0.8, q: 7 });
  sub.close();
});

test('subscribe — late subscriber receives cached last book synchronously', () => {
  lastSocket = null;
  const a = DepthStream.subscribe('BNBUSDT', () => {});
  deliverBook(lastSocket, [['10', '1']], [['11', '1']]);
  let lateFrames = 0;
  let lateBook = null;
  const late = DepthStream.subscribe('BNBUSDT', (book) => {
    lateFrames++;
    lateBook = book;
  });
  assert.equal(lateFrames, 1);
  assert.equal(lateBook.bids[0].p, 10);
  assert.equal(lateBook.asks[0].p, 11);
  a.close();
  late.close();
});

test('subscribe — silently drops malformed payloads', () => {
  lastSocket = null;
  let frames = 0;
  const sub = DepthStream.subscribe('TRXUSDT', () => {
    frames++;
  });
  /* Garbage JSON. */
  lastSocket.onmessage({ data: '{not-json' });
  /* Valid JSON but missing both bids and asks. */
  lastSocket.onmessage({ data: JSON.stringify({ noBook: true }) });
  /* Valid JSON with only one side. */
  lastSocket.onmessage({ data: JSON.stringify({ bids: [['1', '1']] }) });
  assert.equal(frames, 0);
  /* Now a complete frame proves the handler is still alive. */
  deliverBook(lastSocket, [['1', '1']], [['2', '1']]);
  assert.equal(frames, 1);
  sub.close();
});

test('subscribe — multiple subscribers on one symbol share a single socket', () => {
  lastSocket = null;
  let aFrames = 0;
  let bFrames = 0;
  const a = DepthStream.subscribe('AVAXUSDT', () => {
    aFrames++;
  });
  const sockA = lastSocket;
  const b = DepthStream.subscribe('AVAXUSDT', () => {
    bFrames++;
  });
  assert.equal(lastSocket, sockA, 'second subscriber reuses the open socket');
  deliverBook(sockA, [['1', '1']], [['2', '1']]);
  assert.equal(aFrames, 1);
  assert.equal(bFrames, 1);
  a.close();
  assert.equal(sockA.closed, false);
  b.close();
  assert.equal(sockA.closed, true);
});

test('subscribe — invalid fn returns a no-op handle', () => {
  lastSocket = null;
  const before = DepthStream.snapshot().streams;
  const sub = DepthStream.subscribe('BTCUSDT', null);
  assert.equal(typeof sub.close, 'function');
  sub.close();
  assert.equal(DepthStream.snapshot().streams, before, 'no socket is opened on invalid args');
});

test('snapshot — reports stream count and subscriber count', () => {
  /* fresh: no leftover streams */
  while (DepthStream.snapshot().streams) {
    /* shouldn't loop, paranoia */ break;
  }
  const a = DepthStream.subscribe('LINKUSDT', () => {});
  const b = DepthStream.subscribe('LINKUSDT', () => {});
  const c = DepthStream.subscribe('NEARUSDT', () => {});
  const snap = DepthStream.snapshot();
  assert.equal(snap.streams, 2);
  assert.equal(snap.subs, 3);
  a.close();
  b.close();
  c.close();
});
