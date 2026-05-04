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

  /* Update the open coin modal: header price + percentage, and the
     last candle on the chart. We don't re-fetch /klines — instead we
     overwrite the trailing bar's close with T[sym].p and stretch its
     high/low if needed. The user sees the current bar inhale and
     exhale in real time, exactly like the live bar on Binance. */
  function pulseModalChart() {
    if (!isModalOpen('coinMo')) return;
    if (typeof curCoin === 'undefined' || !curCoin) return;
    if (typeof T === 'undefined' || !T) return;
    var d = T[curCoin];
    if (!d || !(d.p > 0)) return;

    /* Header: price + 24h percentage */
    var pEl = document.getElementById('cmP');
    var cEl = document.getElementById('cmC');
    if (pEl && typeof fP === 'function') {
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

    /* Chart: stretch the trailing bar to track the live price */
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
       src/live-trading.js — leave it alone to avoid duplicate work. */
    var page = activePageId();
    if (page === 'live') return;
    reapPendingFlickers();
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
