const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup.js');

/* The module touches the T ticker map and the WL watchlist. Seed
   both as plain globals before loading — _setup.js already provides
   localStorage + window stubs, but not these app-side objects. */
globalThis.T = {};
globalThis.WL = ['BTC', 'ETH', 'SOL'];
/* WebSocket is referenced inside startPriceStream. We don't
   exercise that path here; applyTicker is the pure piece. The
   stream constructors are only touched when explicitly called. */
globalThis.WebSocket = undefined;
/* Load the price-stream module into this VM context — it declares
   applyTicker / startPriceStream / stopPriceStream / priceStreamState. */
loadScript('src/price-stream.js');

test('applyTicker — parses a Binance ticker and writes T[sym]', () => {
  globalThis.T = {};
  const ok = applyTicker({
    s: 'BTCUSDT',
    c: '76160.50',
    P: '1.23',
    q: '2500000000',
    h: '77000.00',
    l: '75000.00',
  });
  assert.equal(ok, true);
  const row = globalThis.T.BTC;
  assert.ok(row, 'BTC row should exist');
  assert.equal(row.p, 76160.5);
  assert.equal(row.c, 1.23);
  assert.equal(row.v, 2500000000);
  assert.equal(row.h, 77000);
  assert.equal(row.l, 75000);
  assert.equal(row.src, 'WS');
  assert.equal(row.loaded, true);
  assert.ok(row.t > 0, 'timestamp should be set');
});

test('applyTicker — rejects non-USDT pairs', () => {
  globalThis.T = {};
  assert.equal(applyTicker({ s: 'BTCUSDC', c: '76000' }), false);
  assert.equal(applyTicker({ s: 'BTCBTC', c: '76000' }), false);
  assert.equal(globalThis.T.BTC, undefined);
});

test('applyTicker — rejects symbols not on the watchlist', () => {
  globalThis.T = {};
  globalThis.WL = ['BTC', 'ETH'];
  assert.equal(applyTicker({ s: 'DOGEUSDT', c: '0.12' }), false);
  assert.equal(globalThis.T.DOGE, undefined);
});

test('applyTicker — rejects zero or negative prices', () => {
  globalThis.T = {};
  assert.equal(applyTicker({ s: 'BTCUSDT', c: '0' }), false);
  assert.equal(applyTicker({ s: 'BTCUSDT', c: '-1.5' }), false);
  assert.equal(applyTicker({ s: 'BTCUSDT', c: 'not-a-number' }), false);
  assert.equal(globalThis.T.BTC, undefined);
});

test('applyTicker — rejects malformed payloads', () => {
  globalThis.T = {};
  assert.equal(applyTicker(null), false);
  assert.equal(applyTicker(undefined), false);
  assert.equal(applyTicker({}), false);
  assert.equal(applyTicker({ s: '' }), false);
  assert.equal(applyTicker({ s: 'X', c: '1' }), false); // too short
});

test('applyTicker — preserves existing Bybit price (by) across updates', () => {
  globalThis.T = { ETH: { p: 3000, by: 2999.5, src: 'PROXY' } };
  applyTicker({ s: 'ETHUSDT', c: '3005', P: '0.5', q: '1e9', h: '3010', l: '2990' });
  assert.equal(globalThis.T.ETH.p, 3005);
  assert.equal(globalThis.T.ETH.by, 2999.5, 'by should be preserved');
  assert.equal(globalThis.T.ETH.src, 'WS');
});

test('applyTicker — falls back to existing volume when payload omits it', () => {
  globalThis.T = { SOL: { p: 150, v: 5e8 } };
  globalThis.WL = ['BTC', 'ETH', 'SOL'];
  applyTicker({ s: 'SOLUSDT', c: '155' }); // no q/h/l
  assert.equal(globalThis.T.SOL.p, 155);
  assert.equal(globalThis.T.SOL.v, 5e8, 'volume should be preserved from previous row');
});

test('startPriceStream — is a no-op when WebSocket is undefined', () => {
  /* Safe: the production path installs WebSocket via the browser. In
     Node our env has no constructor, so the early return avoids a
     ReferenceError. After the call, priceStreamState.ws stays null. */
  globalThis.WebSocket = undefined;
  priceStreamState.ws = null;
  startPriceStream();
  assert.equal(priceStreamState.ws, null);
});

test('stopPriceStream — marks the state stopped and suppresses reconnects', () => {
  stopPriceStream();
  assert.equal(priceStreamState.stopped, true);
  assert.equal(priceStreamState.reconnectTimer, null);
  assert.equal(priceStreamState.watchdogTimer, null);
});
