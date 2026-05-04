/* NEXUS PRO — Shared depth WebSocket multiplexer
 *
 * Mirrors src/kline-stream.js but for Binance's @depth20@100ms
 * streams. The order-book panel on the whale page subscribes for the
 * five top symbols (BTC, ETH, SOL, BNB, XRP) and renders a live
 * bid/ask bar chart that refreshes ~10×/s. Any future caller that
 * wants a live order book gets the same multiplexed pipeline so we
 * never open more than one socket per (symbol, depth tier) pair.
 *
 * Usage:
 *   var sub = DepthStream.subscribe('BTCUSDT', fn);
 *   sub.close();
 *
 * fn(book) is called on every depth event with a normalised
 * { bids: [{p, q}], asks: [{p, q}] } shape (top 20 levels each).
 */

(function () {
  'use strict';

  var streams = {};
  var metrics = { latencyMs: null };

  function _key(sym) {
    return String(sym).toUpperCase();
  }

  function _normalise(arr) {
    var out = [];
    for (var i = 0; i < arr.length && i < 20; i++) {
      var p = parseFloat(arr[i][0]);
      var q = parseFloat(arr[i][1]);
      if (p > 0 && q > 0) out.push({ p: p, q: q });
    }
    return out;
  }

  function _open(key) {
    var st = streams[key];
    if (!st) return;
    var url = 'wss://stream.binance.com:9443/ws/' + key.toLowerCase() + '@depth20@100ms';
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
    };
    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      var b = msg && (msg.bids || msg.b);
      var a = msg && (msg.asks || msg.a);
      if (!b || !a) return;
      var book = { bids: _normalise(b), asks: _normalise(a) };
      st.last = book;
      st.lastMsgAt = Date.now();
      metrics.latencyMs = msg.E ? st.lastMsgAt - +msg.E : null;
      var subs = st.subs.slice();
      for (var i = 0; i < subs.length; i++) {
        try {
          subs[i].fn(book);
        } catch (err) {
          /* never let a single subscriber break the broadcast */
        }
      }
    };
    ws.onclose = function () {
      st.ws = null;
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
      if (streams[key] && streams[key].subs.length) _open(key);
    }, delay);
  }

  function subscribe(sym, fn) {
    if (typeof WebSocket === 'undefined' || typeof fn !== 'function') {
      return { close: function () {} };
    }
    var key = _key(sym);
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
    if (st.last) {
      try {
        fn(st.last);
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
    };
  }

  if (typeof window !== 'undefined') {
    window.DepthStream = { subscribe: subscribe, snapshot: snapshot, metrics: metrics };
  }
})();
