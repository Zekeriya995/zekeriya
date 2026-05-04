/* NEXUS PRO — Real-time Live Trading View
 *
 * Self-contained, high-performance live trading module that connects
 * directly to Binance public WebSocket streams and renders everything
 * — candles, order book, trade tape, mini-tickers — at 60fps using
 * Canvas + requestAnimationFrame.
 *
 * Streams used (all on the public CSP-allowed wss endpoint):
 *   <sym>@aggTrade        — tick-by-tick trades (sub-second latency)
 *   <sym>@kline_<tf>      — primary candle stream
 *   <sym>@depth20@100ms   — order book top-20 levels every 100ms
 *   <sym>@ticker          — 24h rolling stats
 *   !miniTicker@arr       — multi-symbol ticker tape
 *
 * The module exposes a single global namespace `LiveTrading` and is
 * initialised lazily the first time the user navigates to the
 * `pg-live` page. Everything tears down cleanly when the page is
 * hidden so we never leak sockets or animation frames in the
 * background.
 */

(function () {
  'use strict';

  /* ---------- shared formatters ---------- */
  function fmtPrice(v) {
    if (!isFinite(v) || v <= 0) return '--';
    if (v >= 1000) return v.toFixed(2);
    if (v >= 10) return v.toFixed(3);
    if (v >= 1) return v.toFixed(4);
    if (v >= 0.01) return v.toFixed(5);
    return v.toFixed(8);
  }
  function fmtVol(v) {
    if (!isFinite(v) || v <= 0) return '--';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
    return v.toFixed(2);
  }
  function fmtPct(v) {
    if (!isFinite(v)) return '0.00%';
    var sign = v >= 0 ? '+' : '';
    return sign + v.toFixed(2) + '%';
  }
  function fmtTime(ms) {
    var d = new Date(ms);
    var h = ('0' + d.getHours()).slice(-2);
    var m = ('0' + d.getMinutes()).slice(-2);
    var s = ('0' + d.getSeconds()).slice(-2);
    return h + ':' + m + ':' + s;
  }

  /* ---------- engine state ---------- */
  var state = {
    initialised: false,
    active: false,
    symbol: 'BTCUSDT',
    timeframe: '1m',
    sockets: {},
    candles: [],
    livePrice: 0,
    prevPrice: 0,
    flickerDir: 0,
    flickerUntil: 0,
    stats24h: { open: 0, high: 0, low: 0, vol: 0, change: 0, count: 0 },
    bids: [],
    asks: [],
    spread: 0,
    trades: [],
    miniTickers: {},
    rafId: null,
    chart: null,
    book: null,
    tape: null,
    crosshair: { active: false, x: 0, y: 0 },
    lastFrameTs: 0,
    fps: 60,
    backoff: { aggTrade: 1000, kline: 1000, depth: 1000, ticker: 1000, mini: 1000 },
    backoffTimers: {},
  };

  var SYMBOLS = [
    'BTCUSDT',
    'ETHUSDT',
    'BNBUSDT',
    'SOLUSDT',
    'XRPUSDT',
    'ADAUSDT',
    'DOGEUSDT',
    'AVAXUSDT',
    'LINKUSDT',
    'TRXUSDT',
    'TONUSDT',
    'SUIUSDT',
    'MATICUSDT',
    'DOTUSDT',
    'NEARUSDT',
    'ARBUSDT',
    'OPUSDT',
    'APTUSDT',
    'FILUSDT',
    'INJUSDT',
  ];

  var TF_MAP = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
  };

  /* ---------- WebSocket plumbing with auto-reconnect ---------- */
  function _open(name, url, onMessage) {
    if (typeof WebSocket === 'undefined') return;
    if (state.sockets[name]) {
      try {
        state.sockets[name].close();
      } catch (e) {
        /* ignore */
      }
    }
    var ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      _scheduleReconnect(name, url, onMessage);
      return;
    }
    state.sockets[name] = ws;
    ws.onopen = function () {
      state.backoff[name] = 1000;
    };
    ws.onmessage = function (ev) {
      try {
        onMessage(JSON.parse(ev.data));
      } catch (e) {
        /* swallow per-frame parse errors */
      }
    };
    ws.onclose = function () {
      if (state.active) _scheduleReconnect(name, url, onMessage);
    };
    ws.onerror = function () {
      /* onclose follows */
    };
  }

  function _scheduleReconnect(name, url, onMessage) {
    if (state.backoffTimers[name]) return;
    var delay = state.backoff[name] || 1000;
    state.backoffTimers[name] = setTimeout(function () {
      state.backoffTimers[name] = null;
      state.backoff[name] = Math.min(30000, delay * 2);
      if (state.active) _open(name, url, onMessage);
    }, delay);
  }

  function _closeAll() {
    Object.keys(state.sockets).forEach(function (k) {
      try {
        state.sockets[k].close();
      } catch (e) {
        /* ignore */
      }
      state.sockets[k] = null;
    });
    Object.keys(state.backoffTimers).forEach(function (k) {
      if (state.backoffTimers[k]) {
        clearTimeout(state.backoffTimers[k]);
        state.backoffTimers[k] = null;
      }
    });
  }

  /* ---------- data subscriptions ---------- */
  function subscribeSymbol(sym, tf) {
    var lower = sym.toLowerCase();
    var base = 'wss://stream.binance.com:9443/ws/';

    _open('aggTrade', base + lower + '@aggTrade', function (m) {
      var price = parseFloat(m.p);
      var qty = parseFloat(m.q);
      if (!(price > 0)) return;
      _onTick(price, qty, m.T, m.m);
    });

    _open('kline', base + lower + '@kline_' + tf, function (m) {
      if (!m.k) return;
      var k = m.k;
      _onKline({
        t: +k.t,
        T: +k.T,
        o: +k.o,
        h: +k.h,
        l: +k.l,
        c: +k.c,
        v: +k.v,
        x: !!k.x,
      });
    });

    _open('depth', base + lower + '@depth20@100ms', function (m) {
      var bids = m.bids || m.b;
      var asks = m.asks || m.a;
      if (!bids || !asks) return;
      _onBook(bids, asks);
    });

    _open('ticker', base + lower + '@ticker', function (m) {
      _onTicker(m);
    });
  }

  function unsubscribeSymbol() {
    ['aggTrade', 'kline', 'depth', 'ticker'].forEach(function (k) {
      try {
        state.sockets[k] && state.sockets[k].close();
      } catch (e) {
        /* ignore */
      }
      state.sockets[k] = null;
    });
  }

  function subscribeMiniArr() {
    _open('mini', 'wss://stream.binance.com:9443/ws/!miniTicker@arr', function (arr) {
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length; i++) {
        var t = arr[i];
        if (!t || !t.s) continue;
        if (SYMBOLS.indexOf(t.s) === -1) continue;
        var prev = state.miniTickers[t.s] || {};
        var c = parseFloat(t.c) || prev.c || 0;
        var o = parseFloat(t.o) || prev.o || 0;
        var ch = o > 0 ? ((c - o) / o) * 100 : 0;
        state.miniTickers[t.s] = {
          c: c,
          o: o,
          h: parseFloat(t.h) || 0,
          l: parseFloat(t.l) || 0,
          v: parseFloat(t.q) || 0,
          ch: ch,
          prevC: prev.c || c,
          t: Date.now(),
        };
      }
    });
  }

  /* ---------- per-message handlers ---------- */
  function _onTick(price, qty, ts, isMaker) {
    state.prevPrice = state.livePrice || price;
    state.livePrice = price;
    if (price > state.prevPrice) state.flickerDir = 1;
    else if (price < state.prevPrice) state.flickerDir = -1;
    state.flickerUntil = performance.now() + 380;

    var n = state.candles.length;
    if (n) {
      var last = state.candles[n - 1];
      last.c = price;
      if (price > last.h) last.h = price;
      if (price < last.l) last.l = price;
      last.v += qty || 0;
    }

    state.trades.unshift({
      p: price,
      q: qty || 0,
      t: ts || Date.now(),
      buy: !isMaker,
    });
    if (state.trades.length > 80) state.trades.length = 80;
  }

  function _onKline(k) {
    var n = state.candles.length;
    if (n && state.candles[n - 1].t === k.t) {
      state.candles[n - 1] = k;
    } else {
      state.candles.push(k);
      if (state.candles.length > 240) state.candles.shift();
    }
  }

  function _onBook(bids, asks) {
    var b = [];
    var a = [];
    var i;
    for (i = 0; i < bids.length && i < 20; i++) {
      var bp = parseFloat(bids[i][0]);
      var bq = parseFloat(bids[i][1]);
      if (bp > 0 && bq > 0) b.push({ p: bp, q: bq });
    }
    for (i = 0; i < asks.length && i < 20; i++) {
      var ap = parseFloat(asks[i][0]);
      var aq = parseFloat(asks[i][1]);
      if (ap > 0 && aq > 0) a.push({ p: ap, q: aq });
    }
    b.sort(function (x, y) {
      return y.p - x.p;
    });
    a.sort(function (x, y) {
      return x.p - y.p;
    });
    state.bids = b;
    state.asks = a;
    state.spread = a.length && b.length ? a[0].p - b[0].p : 0;
  }

  function _onTicker(m) {
    state.stats24h = {
      open: parseFloat(m.o) || 0,
      high: parseFloat(m.h) || 0,
      low: parseFloat(m.l) || 0,
      vol: parseFloat(m.q) || 0,
      change: parseFloat(m.P) || 0,
      count: parseInt(m.n, 10) || 0,
    };
  }

  /* ---------- REST snapshot for initial candle history ---------- */
  function loadHistory(sym, tf) {
    state.candles = [];
    var url =
      'https://api.binance.com/api/v3/klines?symbol=' + sym + '&interval=' + tf + '&limit=200';
    fetch(url)
      .then(function (r) {
        return r.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) return;
        state.candles = rows.map(function (row) {
          return {
            t: +row[0],
            T: +row[6],
            o: +row[1],
            h: +row[2],
            l: +row[3],
            c: +row[4],
            v: +row[5],
            x: true,
          };
        });
        var last = state.candles[state.candles.length - 1];
        if (last) {
          state.livePrice = last.c;
          state.prevPrice = last.c;
        }
      })
      .catch(function () {
        /* network blip — kline stream will rebuild */
      });
  }

  /* =====================================================================
   *                          CANDLESTICK CHART
   * =====================================================================*/
  function ChartView(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this._bindEvents();
  }
  ChartView.prototype._bindEvents = function () {
    var self = this;
    function setCH(e) {
      var rect = self.cv.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      var y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      state.crosshair = { active: true, x: x, y: y };
    }
    function clr() {
      state.crosshair.active = false;
    }
    this.cv.addEventListener('mousemove', setCH);
    this.cv.addEventListener('mouseleave', clr);
    this.cv.addEventListener('touchstart', setCH, { passive: true });
    this.cv.addEventListener('touchmove', setCH, { passive: true });
    this.cv.addEventListener('touchend', clr);
  };
  ChartView.prototype.resize = function () {
    var w = this.cv.clientWidth || 600;
    var h = this.cv.clientHeight || 360;
    if (this.cv.width !== w * this.dpr || this.cv.height !== h * this.dpr) {
      this.cv.width = w * this.dpr;
      this.cv.height = h * this.dpr;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.w = w;
    this.h = h;
  };
  ChartView.prototype.draw = function (now) {
    this.resize();
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    ctx.clearRect(0, 0, w, h);

    var c = state.candles;
    if (!c.length) {
      this._drawIdle();
      return;
    }

    var visible = Math.min(c.length, Math.floor(w / 7));
    var slice = c.slice(c.length - visible);

    var hi = -Infinity,
      lo = Infinity;
    for (var i = 0; i < slice.length; i++) {
      if (slice[i].h > hi) hi = slice[i].h;
      if (slice[i].l < lo) lo = slice[i].l;
    }
    if (state.livePrice > 0) {
      if (state.livePrice > hi) hi = state.livePrice;
      if (state.livePrice < lo) lo = state.livePrice;
    }
    if (!isFinite(hi) || !isFinite(lo) || hi === lo) {
      hi = (lo || 1) * 1.001;
      lo = (lo || 1) * 0.999;
    }
    var pad = (hi - lo) * 0.08;
    hi += pad;
    lo -= pad;

    var leftPad = 8;
    var rightPad = 76;
    var topPad = 10;
    var botPad = 26;
    var plotW = w - leftPad - rightPad;
    var plotH = h - topPad - botPad;
    var bw = Math.max(2, plotW / slice.length - 1);

    function y(p) {
      return topPad + (1 - (p - lo) / (hi - lo)) * plotH;
    }

    /* horizontal grid + price axis */
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(110,130,160,0.7)';
    ctx.font = '9px Geist Mono, monospace';
    ctx.textAlign = 'left';
    var lines = 6;
    for (var g = 0; g <= lines; g++) {
      var p = lo + (hi - lo) * (g / lines);
      var yy = y(p);
      ctx.beginPath();
      ctx.moveTo(leftPad, yy);
      ctx.lineTo(leftPad + plotW, yy);
      ctx.stroke();
      ctx.fillText(fmtPrice(p), leftPad + plotW + 4, yy + 3);
    }

    /* vertical time grid every ~50px */
    var step = Math.max(1, Math.floor(slice.length / 6));
    ctx.fillStyle = 'rgba(110,130,160,0.55)';
    ctx.textAlign = 'center';
    for (var ti = 0; ti < slice.length; ti += step) {
      var xx = leftPad + ti * (plotW / slice.length) + bw / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.025)';
      ctx.beginPath();
      ctx.moveTo(xx, topPad);
      ctx.lineTo(xx, topPad + plotH);
      ctx.stroke();
      var d = new Date(slice[ti].t);
      var label = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      ctx.fillText(label, xx, topPad + plotH + 14);
    }

    /* candles */
    for (var k = 0; k < slice.length; k++) {
      var cd = slice[k];
      var up = cd.c >= cd.o;
      var col = up ? '#00ff88' : '#ff3860';
      var x0 = leftPad + k * (plotW / slice.length) + 1;
      var yo = y(cd.o),
        yc = y(cd.c),
        yh = y(cd.h),
        yl = y(cd.l);
      var bodyTop = Math.min(yo, yc);
      var bodyH = Math.max(1, Math.abs(yc - yo));

      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + bw / 2, yh);
      ctx.lineTo(x0 + bw / 2, yl);
      ctx.stroke();

      ctx.fillStyle = up ? 'rgba(0,255,136,0.85)' : 'rgba(255,56,96,0.85)';
      ctx.fillRect(x0, bodyTop, bw, bodyH);

      /* live shimmer on the trailing candle */
      if (k === slice.length - 1 && now < state.flickerUntil) {
        var t = (state.flickerUntil - now) / 380;
        ctx.fillStyle =
          state.flickerDir > 0
            ? 'rgba(0,255,136,' + 0.45 * t + ')'
            : 'rgba(255,56,96,' + 0.45 * t + ')';
        ctx.fillRect(x0 - 1, topPad, bw + 2, plotH);
      }
    }

    /* live price line + label */
    if (state.livePrice > 0) {
      var ly = y(state.livePrice);
      var lpUp = state.livePrice >= (state.candles[state.candles.length - 1].o || state.livePrice);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = lpUp ? 'rgba(0,255,136,0.7)' : 'rgba(255,56,96,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftPad, ly);
      ctx.lineTo(leftPad + plotW, ly);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = lpUp ? '#00ff88' : '#ff3860';
      ctx.fillRect(leftPad + plotW, ly - 9, rightPad - 4, 18);
      ctx.fillStyle = '#020408';
      ctx.font = 'bold 10px Geist Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(fmtPrice(state.livePrice), leftPad + plotW + 4, ly + 3);

      /* pulsing dot at the latest candle close */
      var lastX = leftPad + (slice.length - 0.5) * (plotW / slice.length);
      var pulse = 0.5 + 0.5 * Math.sin(now / 160);
      ctx.beginPath();
      ctx.arc(lastX, ly, 3 + pulse * 2, 0, Math.PI * 2);
      ctx.fillStyle = lpUp
        ? 'rgba(0,255,136,' + (0.6 + 0.4 * pulse) + ')'
        : 'rgba(255,56,96,' + (0.6 + 0.4 * pulse) + ')';
      ctx.fill();
    }

    /* crosshair */
    if (state.crosshair.active) {
      ctx.strokeStyle = 'rgba(176,124,255,0.55)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(state.crosshair.x, topPad);
      ctx.lineTo(state.crosshair.x, topPad + plotH);
      ctx.moveTo(leftPad, state.crosshair.y);
      ctx.lineTo(leftPad + plotW, state.crosshair.y);
      ctx.stroke();
      ctx.setLineDash([]);

      var pAt = lo + (1 - (state.crosshair.y - topPad) / plotH) * (hi - lo);
      ctx.fillStyle = '#b07cff';
      ctx.fillRect(leftPad + plotW, state.crosshair.y - 9, rightPad - 4, 18);
      ctx.fillStyle = '#020408';
      ctx.fillText(fmtPrice(pAt), leftPad + plotW + 4, state.crosshair.y + 3);
    }
  };
  ChartView.prototype._drawIdle = function () {
    var ctx = this.ctx;
    ctx.fillStyle = 'rgba(110,130,160,0.6)';
    ctx.font = '11px Geist Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('connecting to live stream…', this.w / 2, this.h / 2);
  };

  /* =====================================================================
   *                          ORDER BOOK VIEW
   * =====================================================================*/
  function BookView(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
  }
  BookView.prototype.resize = function () {
    var w = this.cv.clientWidth || 280;
    var h = this.cv.clientHeight || 360;
    if (this.cv.width !== w * this.dpr || this.cv.height !== h * this.dpr) {
      this.cv.width = w * this.dpr;
      this.cv.height = h * this.dpr;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.w = w;
    this.h = h;
  };
  BookView.prototype.draw = function () {
    this.resize();
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    ctx.clearRect(0, 0, w, h);

    var bids = state.bids;
    var asks = state.asks;
    if (!bids.length && !asks.length) return;

    var rows = 12;
    var rowH = (h - 28) / (rows * 2 + 1);
    var maxQ = 0;
    var i;
    for (i = 0; i < rows && i < bids.length; i++) if (bids[i].q > maxQ) maxQ = bids[i].q;
    for (i = 0; i < rows && i < asks.length; i++) if (asks[i].q > maxQ) maxQ = asks[i].q;
    if (maxQ <= 0) maxQ = 1;

    ctx.font = '10px Geist Mono, monospace';
    ctx.textBaseline = 'middle';

    /* asks (reversed, so best ask sits next to spread) */
    for (i = rows - 1; i >= 0 && i < asks.length; i--) {
      var a = asks[i];
      var ay = (rows - 1 - i) * rowH;
      var aw = (a.q / maxQ) * w;
      ctx.fillStyle = 'rgba(255,56,96,0.14)';
      ctx.fillRect(w - aw, ay, aw, rowH - 1);
      ctx.fillStyle = '#ff3860';
      ctx.textAlign = 'left';
      ctx.fillText(fmtPrice(a.p), 6, ay + rowH / 2);
      ctx.fillStyle = '#d0dce8';
      ctx.textAlign = 'right';
      ctx.fillText(fmtVol(a.q), w - 6, ay + rowH / 2);
    }

    /* spread row */
    var sy = rows * rowH;
    ctx.fillStyle = 'rgba(176,124,255,0.08)';
    ctx.fillRect(0, sy, w, 26);
    ctx.fillStyle = state.flickerDir >= 0 ? '#00ff88' : '#ff3860';
    ctx.font = 'bold 13px Geist Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(fmtPrice(state.livePrice), w / 2, sy + 9);
    ctx.fillStyle = 'rgba(110,130,160,0.85)';
    ctx.font = '8px Geist Mono, monospace';
    var sp = state.spread > 0 ? 'spread ' + fmtPrice(state.spread) : '';
    ctx.fillText(sp, w / 2, sy + 20);

    /* bids */
    for (i = 0; i < rows && i < bids.length; i++) {
      var b = bids[i];
      var by = sy + 26 + i * rowH;
      var bw = (b.q / maxQ) * w;
      ctx.fillStyle = 'rgba(0,255,136,0.14)';
      ctx.fillRect(w - bw, by, bw, rowH - 1);
      ctx.fillStyle = '#00ff88';
      ctx.font = '10px Geist Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(fmtPrice(b.p), 6, by + rowH / 2);
      ctx.fillStyle = '#d0dce8';
      ctx.textAlign = 'right';
      ctx.fillText(fmtVol(b.q), w - 6, by + rowH / 2);
    }
  };

  /* =====================================================================
   *                            TRADE TAPE
   * =====================================================================*/
  function TapeView(container) {
    this.el = container;
    this._lastRender = 0;
  }
  TapeView.prototype.draw = function (now) {
    if (now - this._lastRender < 80) return;
    this._lastRender = now;
    var t = state.trades;
    if (!t.length) return;
    var html = '';
    for (var i = 0; i < Math.min(t.length, 28); i++) {
      var tr = t[i];
      var cls = tr.buy ? 'lv-trade-buy' : 'lv-trade-sell';
      var dot = tr.buy ? '▲' : '▼';
      html +=
        '<div class="lv-trade-row ' +
        cls +
        '">' +
        '<span class="lv-trade-side">' +
        dot +
        '</span>' +
        '<span class="lv-trade-price">' +
        fmtPrice(tr.p) +
        '</span>' +
        '<span class="lv-trade-qty">' +
        fmtVol(tr.q) +
        '</span>' +
        '<span class="lv-trade-time">' +
        fmtTime(tr.t) +
        '</span>' +
        '</div>';
    }
    this.el.innerHTML = html;
  };

  /* =====================================================================
   *                          MULTI-TICKER STRIP
   * =====================================================================*/
  function renderMiniTickers() {
    var el = document.getElementById('lvMiniGrid');
    if (!el) return;
    var keys = SYMBOLS;
    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var s = keys[i];
      var t = state.miniTickers[s];
      var sym = s.replace('USDT', '');
      var price = t ? fmtPrice(t.c) : '--';
      var ch = t ? fmtPct(t.ch) : '--';
      var dir = t && t.c > t.prevC ? 'up' : t && t.c < t.prevC ? 'dn' : '';
      var chCls = t && t.ch >= 0 ? 'up' : 'dn';
      var active = s === state.symbol ? ' lv-mini-active' : '';
      html +=
        '<button class="lv-mini-card ' +
        dir +
        active +
        '" data-sym="' +
        s +
        '">' +
        '<div class="lv-mini-sym">' +
        sym +
        '</div>' +
        '<div class="lv-mini-price">' +
        price +
        '</div>' +
        '<div class="lv-mini-ch ' +
        chCls +
        '">' +
        ch +
        '</div>' +
        '</button>';
    }
    el.innerHTML = html;
    var btns = el.querySelectorAll('.lv-mini-card');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function () {
        var sym = this.getAttribute('data-sym');
        if (sym && sym !== state.symbol) LiveTrading.setSymbol(sym);
      });
    }
  }

  /* =====================================================================
   *                          SCROLLING TICKER TAPE
   * =====================================================================*/
  function renderTickerTape() {
    var el = document.getElementById('lvTickerTape');
    if (!el) return;
    var html = '';
    var keys = SYMBOLS;
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < keys.length; i++) {
        var s = keys[i];
        var t = state.miniTickers[s];
        if (!t) continue;
        var ch = fmtPct(t.ch);
        var cls = t.ch >= 0 ? 'up' : 'dn';
        html +=
          '<span class="lv-tt-i"><b>' +
          s.replace('USDT', '') +
          '</b> ' +
          '<span>' +
          fmtPrice(t.c) +
          '</span> ' +
          '<span class="lv-tt-c ' +
          cls +
          '">' +
          ch +
          '</span></span>';
      }
    }
    el.innerHTML = html || '<span class="lv-tt-i muted">streaming…</span>';
  }

  /* =====================================================================
   *                         HEADER STATS PANEL
   * =====================================================================*/
  function renderStats() {
    var sym = state.symbol.replace('USDT', '');
    var price = state.livePrice;
    var s = state.stats24h;
    var ch = s.change || 0;
    var dir = ch >= 0 ? 'up' : 'dn';

    var symEl = document.getElementById('lvSymName');
    if (symEl) symEl.textContent = sym + '/USDT';
    var priceEl = document.getElementById('lvPrice');
    if (priceEl) {
      priceEl.textContent = fmtPrice(price);
      priceEl.classList.remove('lv-flick-up', 'lv-flick-dn');
      if (performance.now() < state.flickerUntil) {
        priceEl.classList.add(state.flickerDir > 0 ? 'lv-flick-up' : 'lv-flick-dn');
      }
      priceEl.style.color = dir === 'up' ? '#00ff88' : '#ff3860';
    }
    var chEl = document.getElementById('lvChange');
    if (chEl) {
      chEl.textContent = fmtPct(ch);
      chEl.className = 'lv-stat-v lv-' + dir;
    }
    var hiEl = document.getElementById('lvHigh');
    if (hiEl) hiEl.textContent = fmtPrice(s.high);
    var loEl = document.getElementById('lvLow');
    if (loEl) loEl.textContent = fmtPrice(s.low);
    var voEl = document.getElementById('lvVol');
    if (voEl) voEl.textContent = fmtVol(s.vol) + ' USDT';
    var cntEl = document.getElementById('lvTrades');
    if (cntEl) cntEl.textContent = (s.count || 0).toLocaleString();

    var fpsEl = document.getElementById('lvFps');
    if (fpsEl) fpsEl.textContent = state.fps.toFixed(0) + ' fps';
  }

  /* =====================================================================
   *                         RENDER LOOP
   * =====================================================================*/
  function frame(ts) {
    if (!state.active) return;
    if (state.lastFrameTs) {
      var dt = ts - state.lastFrameTs;
      if (dt > 0) {
        var inst = 1000 / dt;
        state.fps = state.fps * 0.9 + inst * 0.1;
      }
    }
    state.lastFrameTs = ts;

    if (state.chart) state.chart.draw(ts);
    if (state.book) state.book.draw();
    if (state.tape) state.tape.draw(ts);
    renderStats();
    state.rafId = requestAnimationFrame(frame);
  }

  /* keep the multi-ticker grid in sync at a lower cadence so it doesn't
     thrash innerHTML 60 times a second */
  var _miniInterval = null;
  function startMiniLoop() {
    if (_miniInterval) clearInterval(_miniInterval);
    _miniInterval = setInterval(function () {
      if (!state.active) return;
      renderMiniTickers();
      renderTickerTape();
    }, 600);
  }
  function stopMiniLoop() {
    if (_miniInterval) {
      clearInterval(_miniInterval);
      _miniInterval = null;
    }
  }

  /* =====================================================================
   *                            PUBLIC API
   * =====================================================================*/
  function bootDOM() {
    if (state.initialised) return;
    state.initialised = true;

    var chartCv = document.getElementById('lvChartCv');
    var bookCv = document.getElementById('lvBookCv');
    var tapeEl = document.getElementById('lvTapeList');
    if (chartCv) state.chart = new ChartView(chartCv);
    if (bookCv) state.book = new BookView(bookCv);
    if (tapeEl) state.tape = new TapeView(tapeEl);

    var tfBtns = document.querySelectorAll('#pg-live .lv-tf');
    for (var i = 0; i < tfBtns.length; i++) {
      tfBtns[i].addEventListener('click', function () {
        var tf = this.getAttribute('data-tf');
        if (!tf || tf === state.timeframe) return;
        var act = document.querySelector('#pg-live .lv-tf.act');
        if (act) act.classList.remove('act');
        this.classList.add('act');
        LiveTrading.setTimeframe(tf);
      });
    }

    var sel = document.getElementById('lvSymSelect');
    if (sel) {
      var opts = '';
      for (var k = 0; k < SYMBOLS.length; k++) {
        var s = SYMBOLS[k];
        opts +=
          '<option value="' +
          s +
          '"' +
          (s === state.symbol ? ' selected' : '') +
          '>' +
          s.replace('USDT', '') +
          ' / USDT</option>';
      }
      sel.innerHTML = opts;
      sel.addEventListener('change', function () {
        LiveTrading.setSymbol(this.value);
      });
    }
  }

  var LiveTrading = {
    start: function () {
      bootDOM();
      if (state.active) return;
      state.active = true;
      loadHistory(state.symbol, state.timeframe);
      subscribeSymbol(state.symbol, state.timeframe);
      subscribeMiniArr();
      startMiniLoop();
      state.lastFrameTs = 0;
      state.rafId = requestAnimationFrame(frame);
    },
    stop: function () {
      state.active = false;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = null;
      stopMiniLoop();
      _closeAll();
    },
    setSymbol: function (sym) {
      if (!sym || sym === state.symbol) return;
      state.symbol = sym;
      state.candles = [];
      state.bids = [];
      state.asks = [];
      state.trades = [];
      state.livePrice = 0;
      state.prevPrice = 0;
      var sel = document.getElementById('lvSymSelect');
      if (sel) sel.value = sym;
      unsubscribeSymbol();
      if (state.active) {
        loadHistory(sym, state.timeframe);
        subscribeSymbol(sym, state.timeframe);
      }
      renderMiniTickers();
    },
    setTimeframe: function (tf) {
      if (!TF_MAP[tf] || tf === state.timeframe) return;
      state.timeframe = tf;
      state.candles = [];
      unsubscribeSymbol();
      if (state.active) {
        loadHistory(state.symbol, tf);
        subscribeSymbol(state.symbol, tf);
      }
    },
    state: state,
  };

  if (typeof window !== 'undefined') window.LiveTrading = LiveTrading;
})();
