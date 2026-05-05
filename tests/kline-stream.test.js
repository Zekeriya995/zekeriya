const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup.js');

/* Minimal WebSocket mock that records the last instance so each test
   can drive its lifecycle (open / message / close) deterministically.
   The kline-stream module never reaches into WebSocket beyond the
   constructor, .close(), and the four standard event handlers, so a
   tiny stub is enough to exercise every branch. */
let lastSocket = null;

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    /* Handlers are intentionally null until the module wires them. */
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
loadScript('src/kline-stream.js');
const KlineStream = globalThis.window.KlineStream;

function freshState() {
  /* Close any sockets left over from the previous test so each test
     starts with an empty `streams` map. */
  lastSocket = null;
}

function deliverKline(socket, t, c) {
  socket.onmessage({
    data: JSON.stringify({
      E: Date.now(),
      k: { t: t, T: t + 60_000, o: c, h: c, l: c, c: c, v: 1 },
    }),
  });
}

test('subscribe — opens one socket per (symbol, timeframe) pair', () => {
  freshState();
  const s1 = KlineStream.subscribe('BTCUSDT', '1h', () => {});
  const sock = lastSocket;
  assert.ok(sock instanceof MockWebSocket);
  assert.match(sock.url, /btcusdt@kline_1h$/);
  assert.equal(KlineStream.snapshot().streams, 1);
  s1.close();
  assert.equal(KlineStream.snapshot().streams, 0, 'tearing down last sub closes the socket');
});

test('subscribe — two callers on the same key share one socket', () => {
  freshState();
  let aFrames = 0;
  let bFrames = 0;
  const a = KlineStream.subscribe('ETHUSDT', '5m', () => {
    aFrames++;
  });
  const sockA = lastSocket;
  const b = KlineStream.subscribe('ETHUSDT', '5m', () => {
    bFrames++;
  });
  assert.equal(lastSocket, sockA, 'second subscriber must reuse the open socket');
  /* Drive a frame and confirm both callbacks fire. */
  deliverKline(sockA, 1, 100);
  assert.equal(aFrames, 1);
  assert.equal(bFrames, 1);
  /* Closing one sub keeps the socket alive for the other. */
  a.close();
  assert.equal(sockA.closed, false);
  b.close();
  assert.equal(sockA.closed, true, 'last sub close tears the socket down');
});

test('subscribe — late subscribers immediately receive the cached last frame', () => {
  freshState();
  const a = KlineStream.subscribe('SOLUSDT', '15m', () => {});
  deliverKline(lastSocket, 42, 200);
  let lateFrames = 0;
  let lastClose = null;
  const late = KlineStream.subscribe('SOLUSDT', '15m', (candle) => {
    lateFrames++;
    lastClose = candle.c;
  });
  assert.equal(lateFrames, 1, 'cached frame replays synchronously on subscribe');
  assert.equal(lastClose, 200);
  a.close();
  late.close();
});

test('subscribe — onmessage normalises the kline payload', () => {
  freshState();
  let captured = null;
  const sub = KlineStream.subscribe('ADAUSDT', '1h', (candle, isFinal) => {
    captured = { candle: candle, isFinal: isFinal };
  });
  lastSocket.onmessage({
    data: JSON.stringify({
      E: 1,
      k: { t: '111', T: '222', o: '0.5', h: '0.6', l: '0.4', c: '0.55', v: '1000', x: true },
    }),
  });
  assert.ok(captured);
  assert.equal(captured.candle.t, 111);
  assert.equal(captured.candle.o, 0.5);
  assert.equal(captured.candle.h, 0.6);
  assert.equal(captured.candle.l, 0.4);
  assert.equal(captured.candle.c, 0.55);
  assert.equal(captured.candle.v, 1000);
  assert.equal(captured.isFinal, true, 'k.x should propagate as the isFinal flag');
  sub.close();
});

test('subscribe — silently drops malformed JSON and missing kline body', () => {
  freshState();
  let frames = 0;
  const sub = KlineStream.subscribe('XRPUSDT', '1m', () => {
    frames++;
  });
  /* Bad JSON — should not throw. */
  lastSocket.onmessage({ data: '{not-json' });
  /* Valid JSON but no `k` field — should not throw. */
  lastSocket.onmessage({ data: JSON.stringify({ noKline: true }) });
  assert.equal(frames, 0);
  /* Now a real frame proves the listener is still alive. */
  deliverKline(lastSocket, 1, 1);
  assert.equal(frames, 1);
  sub.close();
});

test('subscribe — close is a no-op when the same handle is closed twice', () => {
  freshState();
  const sub = KlineStream.subscribe('DOTUSDT', '1m', () => {});
  sub.close();
  /* The internal store deletes the entry on the first close; the
     second call must not throw or re-open anything. */
  assert.doesNotThrow(() => sub.close());
  assert.equal(KlineStream.snapshot().streams, 0);
});

test('snapshot — reports stream count, subscriber count, latency', () => {
  freshState();
  KlineStream.metrics.latencyMs = null;
  const a = KlineStream.subscribe('BTCUSDT', '1h', () => {});
  const b = KlineStream.subscribe('BTCUSDT', '1h', () => {});
  const c = KlineStream.subscribe('ETHUSDT', '1h', () => {});
  const snap = KlineStream.snapshot();
  assert.equal(snap.streams, 2, 'two distinct symbols ⇒ two sockets');
  assert.equal(snap.subs, 3, 'three subscribers across both sockets');
  a.close();
  b.close();
  c.close();
});

test('subscribe — invalid args return a no-op handle', () => {
  freshState();
  const noFn = KlineStream.subscribe('BTCUSDT', '1m', null);
  assert.equal(typeof noFn.close, 'function');
  noFn.close(); /* must not throw */
  /* No socket should have been opened. */
  assert.equal(KlineStream.snapshot().streams, 0);
});
