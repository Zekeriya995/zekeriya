/* NEXUS PRO — Shared kline WebSocket multiplexer
 *
 * Multiple parts of the app (the modal coin chart, the upcoming
 * inline chart on the market page, etc.) want a live candle stream
 * for the coin currently in view. Opening one socket per consumer
 * burns connections and bandwidth, so this module owns a single
 * Binance kline WebSocket per (symbol, timeframe) pair and
 * fan-outs each frame to every subscriber.
 *
 * Public API:
 *   var sub = KlineStream.subscribe('BTCUSDT', '1h', fn);
 *   sub.close();
 *
 * `fn(kline, isFinal)` is invoked on every kline event with a
 * normalised candle in the same shape used by app.js' chartData
 * ({ t, o, h, l, c, v }) plus a boolean for whether the candle has
 * closed (Binance flag `x`). Late subscribers immediately receive
 * the cached last candle so the UI doesn't wait a full second for
 * the first frame.
 *
 * Connection health is published on KlineStream.metrics so a UI pill
 * can render the current latency (ms between kline event time and
 * arrival).
 */

(function () {
  'use strict';

  /* key = sym + '|' + tf → { ws, last, subs[], backoff, t, lastMsgAt } */
  var streams = {};
  var metrics = { latencyMs: null, connected: 0, reconnects: 0 };

  function _key(sym, tf) {
    return String(sym).toUpperCase() + '|' + String(tf);
  }

  function _open(key) {
    var st = streams[key];
    if (!st) return;
    var parts = key.split('|');
    var sym = parts[0].toLowerCase();
    var tf = parts[1];
    var url = 'wss://stream.binance.com:9443/ws/' + sym + '@kline_' + tf;
    var ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      _scheduleReconnect(key);
      return;
    }
    st.ws = ws;
    ws.onopen = function () {
      st.backoff = 1000;
      metrics.connected++;
    };
    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (!msg || !msg.k) return;
      var k = msg.k;
      var candle = {
        t: +k.t,
        T: +k.T,
        o: +k.o,
        h: +k.h,
        l: +k.l,
        c: +k.c,
        v: +k.v,
      };
      st.last = candle;
      st.lastMsgAt = Date.now();
      metrics.latencyMs = st.lastMsgAt - +msg.E;
      var subs = st.subs.slice();
      for (var i = 0; i < subs.length; i++) {
        try {
          subs[i].fn(candle, !!k.x);
        } catch (err) {
          /* never let a single subscriber kill the broadcast loop */
        }
      }
    };
    ws.onclose = function () {
      st.ws = null;
      metrics.connected = Math.max(0, metrics.connected - 1);
      if (st.subs.length) _scheduleReconnect(key);
    };
    ws.onerror = function () {
      /* onclose follows */
    };
  }

  function _scheduleReconnect(key) {
    var st = streams[key];
    if (!st) return;
    if (st.reconnectTimer) return;
    var delay = st.backoff || 1000;
    st.reconnectTimer = setTimeout(function () {
      st.reconnectTimer = null;
      st.backoff = Math.min(30000, delay * 2);
      metrics.reconnects++;
      if (streams[key] && streams[key].subs.length) _open(key);
    }, delay);
  }

  function subscribe(sym, tf, fn) {
    if (typeof WebSocket === 'undefined' || typeof fn !== 'function') {
      return { close: function () {} };
    }
    var key = _key(sym, tf);
    var st = streams[key];
    if (!st) {
      st = streams[key] = {
        ws: null,
        last: null,
        lastMsgAt: 0,
        subs: [],
        backoff: 1000,
        reconnectTimer: null,
      };
      _open(key);
    }
    var sub = { fn: fn, key: key };
    st.subs.push(sub);
    /* Replay the cached candle so the UI gets a frame immediately
       instead of waiting up to a second for the next push. */
    if (st.last) {
      try {
        fn(st.last, false);
      } catch (e) {
        /* ignore */
      }
    }
    return {
      close: function () {
        var s = streams[sub.key];
        if (!s) return;
        var idx = s.subs.indexOf(sub);
        if (idx !== -1) s.subs.splice(idx, 1);
        if (!s.subs.length) {
          /* tear the socket down once nobody cares */
          if (s.ws) {
            try {
              s.ws.close();
            } catch (e) {
              /* ignore */
            }
          }
          if (s.reconnectTimer) {
            clearTimeout(s.reconnectTimer);
            s.reconnectTimer = null;
          }
          delete streams[sub.key];
        }
      },
    };
  }

  function snapshot() {
    var keys = Object.keys(streams);
    return {
      streams: keys.length,
      subs: keys.reduce(function (acc, k) {
        return acc + streams[k].subs.length;
      }, 0),
      latencyMs: metrics.latencyMs,
      reconnects: metrics.reconnects,
    };
  }

  if (typeof window !== 'undefined') {
    window.KlineStream = {
      subscribe: subscribe,
      snapshot: snapshot,
      metrics: metrics,
    };
  }
})();
