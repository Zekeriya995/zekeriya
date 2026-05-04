/* NEXUS PRO — Live ticker for the existing pages
 *
 * The existing pages (dashboard, favourites, scanner, modal coin chart)
 * only repaint when an explicit refresh fires — the WebSocket ticker
 * stream in src/price-stream.js is updating T[sym] on the fly, but the
 * cards on screen never re-read T until loadDash() runs (every two
 * minutes). This module closes that gap: a single 1-second pulse,
 * gated by document visibility through bgInterval, that:
 *
 *   • repaints the ticker tape, the TOP-coin cards, and the TOP-3
 *     panel on the dashboard
 *   • repaints the favourites list while the favourites page is open
 *   • re-renders the in-modal coin chart by stretching the trailing
 *     candle's close (and its high/low) to track T[sym].p, then asking
 *     drawChartFrame() to redraw — same pattern Binance / Bybit use
 *     to advance the live candle between full kline snapshots
 *   • adds a light flicker (green/red) to elements whose cached price
 *     changed since the previous tick so the user can see the page
 *     breathing
 *
 * The whole thing is a no-op when none of the conditions above apply,
 * and bgInterval already pauses on tab hide so we don't burn CPU
 * behind the user's back.
 */

(function () {
  'use strict';

  /* Per-symbol cache of the price we rendered last tick. Compared
     against T[sym].p before each repaint to decide whether the
     'flicker' classes need to be reapplied. */
  var prevPrice = {};
  /* Key → { cls, until } for elements currently mid-flash. We strip
     the class once the timer expires so animations can replay. */
  var flickerEls = [];

  /* ---------- helpers ---------- */
  function activePageId() {
    var p = document.querySelector('.pg.act');
    return p && p.id ? p.id.replace(/^pg-/, '') : null;
  }

  function isModalOpen(id) {
    var el = document.getElementById(id);
    return !!(el && el.classList.contains('show'));
  }

  function flick(el, dir) {
    if (!el) return;
    var cls = dir > 0 ? 'lt-flick-up' : 'lt-flick-dn';
    el.classList.remove('lt-flick-up', 'lt-flick-dn');
    /* force reflow so the CSS animation restarts even when the
       same direction class is reapplied a second later */
    void el.offsetWidth;
    el.classList.add(cls);
    flickerEls.push({ el: el, until: Date.now() + 420 });
  }

  function reapPendingFlickers() {
    var now = Date.now();
    for (var i = flickerEls.length - 1; i >= 0; i--) {
      if (flickerEls[i].until <= now) {
        if (flickerEls[i].el && flickerEls[i].el.classList) {
          flickerEls[i].el.classList.remove('lt-flick-up', 'lt-flick-dn');
        }
        flickerEls.splice(i, 1);
      }
    }
  }

  /* ---------- per-page handlers ---------- */
  function pulseDashboard() {
    if (typeof T === 'undefined' || !T) return;
    /* TOP-coin cards: detect price changes per row and flicker only
       the rows that moved, then repaint the lot in one shot. */
    var topEl = document.getElementById('topCoins');
    if (topEl && typeof TOP4 !== 'undefined' && TOP4 && TOP4.length) {
      var changedAny = false;
      for (var i = 0; i < TOP4.length; i++) {
        var s = TOP4[i];
        var d = T[s];
        if (!d || !(d.p > 0)) continue;
        var pp = prevPrice['top:' + s];
        if (pp != null && pp !== d.p) {
          changedAny = true;
          var card = topEl.children[i];
          if (card) {
            var priceEl = card.querySelector('.coin-card-price');
            flick(priceEl, d.p > pp ? 1 : -1);
          }
        }
        prevPrice['top:' + s] = d.p;
      }
      if (changedAny && typeof renderTopCoins === 'function') {
        try {
          renderTopCoins();
        } catch (e) {
          /* swallow render-time errors */
        }
        /* re-apply flicker classes after innerHTML rebuild — the
           previous .coin-card nodes were thrown away. We can use
           the same per-row check against the freshly rebuilt DOM. */
        for (var k = 0; k < TOP4.length; k++) {
          var s2 = TOP4[k];
          var d2 = T[s2];
          if (!d2) continue;
          var card2 = topEl.children[k];
          var price2 = card2 && card2.querySelector('.coin-card-price');
          if (!price2) continue;
          if (prevPrice['top-prev:' + s2] != null && prevPrice['top-prev:' + s2] !== d2.p) {
            flick(price2, d2.p > prevPrice['top-prev:' + s2] ? 1 : -1);
          }
          prevPrice['top-prev:' + s2] = d2.p;
        }
      }
    }

    /* Ticker tape — rebuilt cheaply against T[sym] for the watchlist. */
    var tkr = document.getElementById('tkrEl');
    if (tkr && typeof WL !== 'undefined' && typeof fP === 'function') {
      var items = [];
      for (var w = 0; w < WL.length && items.length < 16; w++) {
        if (T[WL[w]]) items.push(WL[w]);
      }
      if (items.length) {
        var html = '';
        var sparkFn = typeof mkSpark === 'function' ? mkSpark : null;
        for (var pass = 0; pass < 2; pass++) {
          for (var n = 0; n < items.length; n++) {
            var sy = items[n];
            var dt = T[sy];
            var upd = (dt.c || 0) >= 0;
            html +=
              '<div class="tkr-i"><span class="tkr-sym">' +
              sy +
              '</span><span style="font-family:var(--fm);font-size:9px;color:var(--t2)">' +
              fP(dt.p) +
              '</span><div class="spark">' +
              (sparkFn ? sparkFn(sy) : '') +
              '</div>' +
              '<span class="tkr-c ' +
              (upd ? 'up' : 'dn') +
              '">' +
              (upd ? '+' : '') +
              (dt.c || 0).toFixed(1) +
              '%</span></div>';
          }
        }
        tkr.innerHTML = html;
      }
    }
  }

  function pulseFavourites() {
    if (typeof favorites === 'undefined' || !favorites || !favorites.length) return;
    if (typeof renderFavs !== 'function') return;
    var changed = false;
    for (var i = 0; i < favorites.length; i++) {
      var s = favorites[i];
      var d = typeof T !== 'undefined' ? T[s] : null;
      if (!d || !(d.p > 0)) continue;
      var pp = prevPrice['fav:' + s];
      if (pp != null && pp !== d.p) changed = true;
      prevPrice['fav:' + s] = d.p;
    }
    if (changed) {
      try {
        renderFavs();
      } catch (e) {
        /* ignore */
      }
    }
  }

  /* ------------- modal coin chart (kline-stream backed) -------------
     The modal originally fetches /klines once via REST. Without a live
     stream the trailing bar would freeze and new bars would never
     appear. Here we subscribe to the appropriate Binance kline_<tf>
     WebSocket whenever the modal is open and (curCoin, curTF) is
     stable, then fan-out each frame into chartData and ask
     drawChartFrame() to repaint. When the modal closes (or the user
     switches symbol/timeframe) we tear the subscription down so we
     never leak sockets. */
  var modalSub = null;
  var modalSubKey = '';

  function _modalKlineHandler(candle) {
    if (typeof chartData === 'undefined' || !chartData || !chartData.length) return;
    var n = chartData.length;
    var last = chartData[n - 1];
    if (last.t === candle.t) {
      /* Update in place — Binance pushes the in-progress candle
         many times per second and only sets `x:true` on close. */
      last.o = candle.o;
      last.h = candle.h;
      last.l = candle.l;
      last.c = candle.c;
      last.v = candle.v;
    } else if (candle.t > last.t) {
      chartData.push(candle);
      if (chartData.length > 500) chartData.shift();
    } else {
      return;
    }
    /* Mirror the candle's close into the modal header so the price
       above the chart matches the price label drawn next to the live
       candle. T[sym].p comes from the !ticker@arr aggregate stream
       which lags the per-symbol kline stream by a tick or two —
       that mismatch was visible to users as e.g. $80,418 in the
       header vs $80,414 on the candle. */
    var pEl = document.getElementById('cmP');
    if (pEl && typeof fP === 'function') {
      var prev = prevPrice['mod-kline:' + (typeof curCoin !== 'undefined' ? curCoin : '')];
      var newTxt = fP(candle.c);
      if (pEl.textContent !== newTxt) {
        pEl.textContent = newTxt;
        if (prev != null && prev !== candle.c) flick(pEl, candle.c > prev ? 1 : -1);
      }
      prevPrice['mod-kline:' + (typeof curCoin !== 'undefined' ? curCoin : '')] = candle.c;
    }
    if (typeof drawChartFrame === 'function') {
      try {
        drawChartFrame();
      } catch (e) {
        /* ignore — drawChartFrame guards itself but we don't trust it */
      }
    }
  }

  function syncModalKlineSub() {
    var open = isModalOpen('coinMo');
    var sym = typeof curCoin !== 'undefined' ? curCoin : '';
    var tf = typeof curTF !== 'undefined' ? curTF : '';
    var want = open && sym && tf ? sym + 'USDT|' + tf : '';
    if (want === modalSubKey) return;
    if (modalSub) {
      try {
        modalSub.close();
      } catch (e) {
        /* ignore */
      }
      modalSub = null;
    }
    modalSubKey = want;
    if (want && typeof KlineStream !== 'undefined' && KlineStream.subscribe) {
      modalSub = KlineStream.subscribe(sym + 'USDT', tf, _modalKlineHandler);
    }
  }

  function pulseModalChart() {
    syncModalKlineSub();
    if (!isModalOpen('coinMo')) return;
    if (typeof curCoin === 'undefined' || !curCoin) return;
    if (typeof T === 'undefined' || !T) return;
    var d = T[curCoin];
    if (!d || !(d.p > 0)) return;

    /* Header price: only paint from T[sym].p as a cold-start fallback.
       Once the kline subscription is pushing, _modalKlineHandler owns
       the cmP element so the header value matches the candle exactly. */
    var klineDriving = !!(
      modalSub &&
      typeof KlineStream !== 'undefined' &&
      KlineStream.metrics &&
      KlineStream.metrics.latencyMs != null
    );
    var pEl = document.getElementById('cmP');
    var cEl = document.getElementById('cmC');
    if (!klineDriving && pEl && typeof fP === 'function') {
      var prev = prevPrice['mod:' + curCoin];
      pEl.textContent = fP(d.p);
      if (prev != null && prev !== d.p) flick(pEl, d.p > prev ? 1 : -1);
      prevPrice['mod:' + curCoin] = d.p;
    }
    if (cEl) {
      var ch = typeof d.c === 'number' ? d.c : 0;
      cEl.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%';
      cEl.style.color = ch >= 0 ? 'var(--up)' : 'var(--dn)';
    }

    /* If the kline socket hasn't pushed yet (cold start, or 1d/1w bars
       that update infrequently), keep the legacy "stretch the trailing
       bar" fallback so the chart still feels alive immediately. */
    if (!modalSub || !KlineStream.metrics || !KlineStream.metrics.latencyMs) {
      var cd = typeof chartData !== 'undefined' ? chartData : null;
      if (cd && cd.length) {
        var last = cd[cd.length - 1];
        var moved = last.c !== d.p;
        last.c = d.p;
        if (d.p > last.h) last.h = d.p;
        if (d.p < last.l) last.l = d.p;
        if (moved && typeof drawChartFrame === 'function') {
          try {
            drawChartFrame();
          } catch (e) {
            /* ignore */
          }
        }
      }
    }
  }

  /* ------------- live sparkline accumulator -------------
     The dashboard sparklines read from sparkHist[s], which is appended
     in loadTk() — and that runs every two minutes. So sparklines
     barely move. Here we sample T[s].p once a tick and keep the last
     ~24 readings; combined with renderTopCoins() running on the same
     tick the trailing edge of every sparkline now actually breathes. */
  var lastSparkSample = 0;
  function pulseSparkAccumulator() {
    if (typeof T === 'undefined' || !T) return;
    if (typeof sparkHist === 'undefined') return;
    var now = Date.now();
    if (now - lastSparkSample < 5000) return; /* one fresh point every 5s */
    lastSparkSample = now;
    Object.keys(T).forEach(function (s) {
      var d = T[s];
      if (!d || !(d.p > 0)) return;
      if (!sparkHist[s]) sparkHist[s] = [];
      sparkHist[s].push(d.p);
      /* Keep the buffer bounded so a long-lived tab doesn't grow it
         indefinitely. 36 samples × 5s ≈ 3 minutes of trailing data. */
      if (sparkHist[s].length > 36) sparkHist[s] = sparkHist[s].slice(-36);
    });
  }

  /* ------------- live connection status -------------
     We piggy-back on the existing #connStatus / #validatorDot pair in
     the header. Healthy means the kline stream pushed within the last
     ~6s; stale means we haven't seen a frame for 10s+; offline means
     we have no socket open at all. */
  function pulseConnectionStatus() {
    var dot = document.getElementById('validatorDot');
    var label = document.getElementById('connStatus');
    if (!dot && !label) return;
    var lat =
      typeof KlineStream !== 'undefined' && KlineStream.metrics
        ? KlineStream.metrics.latencyMs
        : null;
    var streamsCount =
      typeof KlineStream !== 'undefined' && KlineStream.snapshot
        ? KlineStream.snapshot().streams
        : 0;
    var wsTickerUp = typeof connMetrics !== 'undefined' && connMetrics ? !!connMetrics.wsUp : false;
    var healthy = wsTickerUp || streamsCount > 0;
    var color = healthy ? 'var(--up)' : 'var(--warn)';
    if (dot) {
      dot.style.background = color;
      dot.style.boxShadow = '0 0 6px ' + color;
    }
    if (label) {
      var text = healthy
        ? lat != null && lat >= 0 && lat < 5000
          ? 'LIVE ' + lat + 'ms'
          : 'LIVE'
        : 'OFFLINE';
      if (label.textContent !== text) label.textContent = text;
      label.style.color = color;
    }
  }

  /* Scanner page is heavy to repaint, so we only refresh the visible
     price column without touching the rest of the row. */
  function pulseScanner() {
    if (typeof T === 'undefined' || !T) return;
    var rows = document.querySelectorAll('#tradeList [data-sym]');
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i].getAttribute('data-sym');
      var d = T[s];
      if (!d || !(d.p > 0)) continue;
      var pe = rows[i].querySelector('[data-live="price"]');
      var ce = rows[i].querySelector('[data-live="ch"]');
      if (pe && typeof fP === 'function') {
        var prev = prevPrice['scan:' + s];
        var newTxt = fP(d.p);
        if (pe.textContent !== newTxt) {
          pe.textContent = newTxt;
          if (prev != null && prev !== d.p) flick(pe, d.p > prev ? 1 : -1);
        }
        prevPrice['scan:' + s] = d.p;
      }
      if (ce) {
        var ch = typeof d.c === 'number' ? d.c : 0;
        ce.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%';
        ce.style.color = ch >= 0 ? 'var(--up)' : 'var(--dn)';
      }
    }
  }

  /* ---------- master tick ---------- */
  function tick() {
    /* The dedicated /pg-live page runs its own RAF render loop in
       src/live-trading.js — leave it alone for the page-specific
       pulses but still keep the sparkline accumulator and connection
       indicator running across the whole app. */
    reapPendingFlickers();
    pulseSparkAccumulator();
    pulseConnectionStatus();
    var page = activePageId();
    if (page === 'live') return;
    if (page === 'dash') pulseDashboard();
    if (page === 'favs') pulseFavourites();
    if (page === 'scan') pulseScanner();
    /* The coin modal can be opened from any page, so check it
       independently of activePageId(). */
    pulseModalChart();
  }

  function start() {
    var schedule =
      typeof bgInterval === 'function'
        ? bgInterval
        : function (fn, ms) {
            return setInterval(fn, ms);
          };
    /* 1s cadence keeps DOM churn manageable while still feeling
       "alive" on the wire. The WebSocket itself sends ticker
       updates roughly every second, so a faster loop would just
       redraw the same numbers. */
    schedule(tick, 1000);
  }

  if (typeof window !== 'undefined') {
    window.LiveTicker = { start: start, tick: tick };
    /* Auto-start once the DOM is ready. We wait for the rest of the
       app.js init to finish so T, TOP4, WL, favorites and friends are
       all in scope. */
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(start, 1500);
      });
    } else {
      setTimeout(start, 1500);
    }
  }
})();
