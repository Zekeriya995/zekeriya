/* NEXUS PRO — Binance public WebSocket ticker stream.

   Subscribes to `!ticker@arr` on Binance's public combined-stream
   endpoint. Every ~1s Binance pushes an array of 24h rolling
   tickers for every trading pair; we filter to the current
   watchlist (WL + the USDT quote asset) and update T[sym] in
   place. The REST polling in loadTk() continues to run in
   parallel — it still provides the FR/OI/LS/whale/depth bundle,
   which has no WebSocket stream on the public Binance endpoints.
   This module is strictly additive for the five price-native
   fields: price (c), 24h change percent (P), 24h quote volume
   (q), 24h high (h), 24h low (l).

   Lifetime model:
   * `startPriceStream()` is called once from init() in app.js.
   * Any drop (onclose, transport error) triggers exponential
     backoff reconnect: 1s, 2s, 4s, …, capped at 30s.
   * A watchdog pings every 30s — if no message has arrived for
     90s the socket is closed so the backoff path rebuilds it.
   * `stopPriceStream()` disarms everything and keeps it down;
     currently unused but exported for future wiring (e.g., an
     explicit offline mode toggle).

   Fallback contract: when the socket is down or flapping, nothing
   special happens — the platform reverts to the pre-existing REST
   polling cadence. There is no observable regression; the WS is a
   speed accelerator, not a dependency. */

var priceStreamState = {
  ws: null,
  backoffMs: 1000,
  maxBackoffMs: 30000,
  reconnectTimer: null,
  watchdogTimer: null,
  lastMessageTime: 0,
  stopped: false,
};

/* Apply a single Binance 24h rolling ticker payload to T[sym]. The
   payload shape comes from the !ticker@arr stream — field names are
   Binance's own conventions (s = symbol, c = last price, P = 24h
   change percent, q = 24h quote volume, h = 24h high, l = 24h low).

   Exported (in effect — it's a global) primarily so the unit tests
   can exercise it without having to stand up a real WebSocket. */
function applyTicker(tk) {
  if (!tk || typeof tk !== 'object') return false;
  var s = tk.s;
  if (!s || typeof s !== 'string' || s.length < 5 || s.slice(-4) !== 'USDT') {
    return false;
  }
  var sym = s.slice(0, -4);
  if (typeof WL !== 'undefined' && WL && WL.indexOf && WL.indexOf(sym) === -1) {
    return false;
  }
  var price = parseFloat(tk.c);
  if (!(price > 0)) return false;
  var existing = (typeof T !== 'undefined' && T && T[sym]) || {};
  T[sym] = {
    p: price,
    c: parseFloat(tk.P) || 0,
    v: parseFloat(tk.q) || existing.v || 0,
    h: parseFloat(tk.h) || existing.h || 0,
    l: parseFloat(tk.l) || existing.l || 0,
    by: existing.by,
    src: 'WS',
    loaded: true,
    t: Date.now(),
  };
  return true;
}

function _priceStreamScheduleReconnect() {
  if (priceStreamState.stopped) return;
  if (priceStreamState.reconnectTimer) return;
  var delay = priceStreamState.backoffMs;
  priceStreamState.reconnectTimer = setTimeout(function () {
    priceStreamState.reconnectTimer = null;
    priceStreamState.backoffMs = Math.min(
      priceStreamState.maxBackoffMs,
      priceStreamState.backoffMs * 2
    );
    startPriceStream();
  }, delay);
}

function _priceStreamArmWatchdog() {
  if (priceStreamState.watchdogTimer) {
    clearInterval(priceStreamState.watchdogTimer);
  }
  priceStreamState.watchdogTimer = setInterval(function () {
    var age = Date.now() - priceStreamState.lastMessageTime;
    if (age > 90000 && priceStreamState.ws) {
      try {
        priceStreamState.ws.close();
      } catch (e) {
        /* fall through to onclose handler */
      }
    }
  }, 30000);
}

function startPriceStream() {
  if (priceStreamState.stopped) return;
  if (typeof WebSocket === 'undefined') return;
  if (priceStreamState.ws) {
    try {
      priceStreamState.ws.close();
    } catch (e) {
      /* ignore */
    }
  }
  var url = 'wss://stream.binance.com:9443/ws/!ticker@arr';
  var ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    _priceStreamScheduleReconnect();
    return;
  }
  priceStreamState.ws = ws;
  ws.onopen = function () {
    priceStreamState.backoffMs = 1000;
    priceStreamState.lastMessageTime = Date.now();
    if (typeof connMetrics !== 'undefined' && connMetrics) connMetrics.wsUp = true;
    _priceStreamArmWatchdog();
  };
  ws.onmessage = function (ev) {
    priceStreamState.lastMessageTime = Date.now();
    var msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    if (!Array.isArray(msg)) return;
    for (var i = 0; i < msg.length; i++) {
      applyTicker(msg[i]);
    }
    if (typeof lastDataTime !== 'undefined') {
      /* lastDataTime is a var in app.js — plain assignment retargets the
         global the connection-status tick reads from. */
      lastDataTime = Date.now();
    }
  };
  ws.onclose = function () {
    if (typeof connMetrics !== 'undefined' && connMetrics) connMetrics.wsUp = false;
    _priceStreamScheduleReconnect();
  };
  ws.onerror = function () {
    /* onclose fires right after onerror; the reconnect is scheduled
       there so we don't queue two reconnects per failed cycle. */
    if (typeof connMetrics !== 'undefined' && connMetrics) connMetrics.wsUp = false;
  };
}

function stopPriceStream() {
  priceStreamState.stopped = true;
  if (priceStreamState.reconnectTimer) {
    clearTimeout(priceStreamState.reconnectTimer);
    priceStreamState.reconnectTimer = null;
  }
  if (priceStreamState.watchdogTimer) {
    clearInterval(priceStreamState.watchdogTimer);
    priceStreamState.watchdogTimer = null;
  }
  if (priceStreamState.ws) {
    try {
      priceStreamState.ws.close();
    } catch (e) {
      /* ignore */
    }
    priceStreamState.ws = null;
  }
  if (typeof connMetrics !== 'undefined' && connMetrics) connMetrics.wsUp = false;
}
