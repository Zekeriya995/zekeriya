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

  /* ------------- dashboard secondary cards (1s) -------------
     The cards below the TOP-coin row (market health, L/S ratio,
     accuracy, stable-flow, warnings, breakout/ULTRA counts) used to
     repaint only every two minutes when loadDash() ran. They all read
     from already-cached state (T, FR, LS, fgValue, btcDom, etc.) and
     their renderers are network-free, so we can call them on every
     tick at zero cost beyond the DOM diffs they perform internally. */
  function pulseDashSecondary() {
    if (typeof T === 'undefined' || !T) return;

    /* Market health — recompute and paint score, label, dot, factors. */
    if (typeof calcHealth === 'function') {
      try {
        var h = calcHealth();
        var hc = h.score >= 70 ? 'up' : h.score >= 45 ? 'warn' : 'dn';
        var mhSE = document.getElementById('mhScore');
        if (mhSE) {
          if (mhSE.textContent !== String(h.score)) {
            mhSE.textContent = h.score;
            flick(mhSE, h.score >= 50 ? 1 : -1);
          }
          mhSE.style.color = 'var(--' + hc + ')';
        }
        var mhLE = document.getElementById('mhLabel');
        if (mhLE) {
          var ar = typeof lang !== 'undefined' && lang === 'ar';
          mhLE.textContent =
            h.score >= 70
              ? ar
                ? 'سوق صحي'
                : 'Healthy'
              : h.score >= 45
                ? ar
                  ? 'محايد — حذر'
                  : 'Neutral'
                : ar
                  ? 'ضعيف'
                  : 'Weak';
        }
        var mhPE = document.getElementById('mhPt');
        if (mhPE) mhPE.style.left = h.score + '%';
        var pMHE = document.getElementById('pMH');
        if (pMHE) pMHE.textContent = h.score;
        var mhFE = document.getElementById('mhFactors');
        if (mhFE && h.factors && h.factors.map) {
          mhFE.innerHTML = h.factors
            .map(function (f) {
              return (
                '<div class="mh-f"><div class="mh-f-v" style="color:var(--' +
                f.c +
                ')">' +
                f.v +
                '</div><div class="mh-f-l">' +
                f.l +
                '</div></div>'
              );
            })
            .join('');
        }
      } catch (e) {
        /* swallow */
      }
    }

    /* Long/Short ratio panel + Accuracy panel + Top-3 panel. */
    if (typeof renderDashLS === 'function') {
      try {
        renderDashLS();
      } catch (e) {
        /* swallow */
      }
    }
    if (typeof renderAcc === 'function') {
      try {
        renderAcc('accCard');
      } catch (e) {
        /* swallow */
      }
    }
    if (typeof renderTop3 === 'function') {
      try {
        renderTop3();
      } catch (e) {
        /* swallow */
      }
    }

    /* Stablecoin flow — recompute breakout count + ULTRA count. */
    var bk = 0;
    var keys = Object.keys(T);
    for (var i = 0; i < keys.length; i++) {
      if (T[keys[i]] && T[keys[i]].c >= 8) bk++;
    }
    var bkE = document.getElementById('brkC');
    if (bkE && bkE.textContent !== String(bk)) {
      bkE.textContent = bk;
      flick(bkE, 1);
    }
    var pBE = document.getElementById('pBrk');
    if (pBE) pBE.textContent = bk;

    /* Warnings list — pure recompute from FR + LS caches. */
    if (typeof getWarnings === 'function') {
      try {
        var ws = getWarnings();
        var wbE = document.getElementById('warnBox');
        if (wbE) {
          var html = ws
            .map(function (w) {
              return (
                '<div class="warn-box"><div class="w-ic">' +
                w.ic +
                '</div><div class="w-txt">' +
                w.txt +
                '</div></div>'
              );
            })
            .join('');
          if (wbE.innerHTML !== html) wbE.innerHTML = html;
        }
      } catch (e) {
        /* swallow */
      }
    }

    /* QA cards strip + sparkHist refresh handled elsewhere. */
    if (typeof updateQACards === 'function') {
      try {
        updateQACards();
      } catch (e) {
        /* swallow */
      }
    }
  }

  /* ------------- portfolio P&L (1s) -------------
     renderPort() reads each holding's amount × current T[sym].p, so a
     re-render on each tick gives the user a live unrealised-P&L
     ticker. The function is also defensive against missing T entries. */
  function pulsePortfolio() {
    if (typeof renderPort !== 'function') return;
    if (typeof portfolio === 'undefined' || !portfolio || !portfolio.length) return;
    /* Only repaint if any tracked symbol's price actually moved. */
    var changed = false;
    for (var i = 0; i < portfolio.length; i++) {
      var s = portfolio[i] && portfolio[i].sym;
      var d = s && typeof T !== 'undefined' ? T[s] : null;
      if (!d || !(d.p > 0)) continue;
      if (prevPrice['port:' + s] !== d.p) changed = true;
      prevPrice['port:' + s] = d.p;
    }
    if (!changed) return;
    var pVal = document.getElementById('pVal');
    var pCh = document.getElementById('pCh');
    var prevPVal = pVal ? pVal.textContent : '';
    try {
      renderPort();
    } catch (e) {
      /* swallow */
    }
    if (pVal && pVal.textContent !== prevPVal) flick(pVal, 1);
    if (pCh) flick(pCh, 1);
  }

  /* ------------- whale page (1s) -------------
     Whale rows show price + 24h change + rolling buy/sell totals; all
     derive from T[sym] + cached scan results. Rebuild only when the
     scan cache exists (otherwise the page is showing the loader). */
  function pulseWhale() {
    if (typeof renderWhaleResults !== 'function') return;
    if (typeof cache === 'undefined' || !cache || !cache.scan) return;
    try {
      renderWhaleResults(cache.scan);
    } catch (e) {
      /* swallow */
    }
  }

  /* ------------- heatmap / alerts / monitor (1s) -------------
     These pages read pure-JS state (T, alertsList, monitorState) and
     their render functions are inexpensive. */
  function pulseHeatmap() {
    if (typeof renderHeatmap === 'function') {
      try {
        renderHeatmap();
      } catch (e) {
        /* swallow */
      }
    }
  }
  function pulseAlerts() {
    if (typeof renderAlerts === 'function') {
      try {
        renderAlerts();
      } catch (e) {
        /* swallow */
      }
    }
  }
  function pulseMonitor() {
    /* Monitor page does heavier work (rendering tabs and data
       breakdowns), so we throttle it to once every 3 ticks. */
    if (!pulseMonitor._n) pulseMonitor._n = 0;
    pulseMonitor._n++;
    if (pulseMonitor._n % 3 !== 0) return;
    if (typeof renderMonPanel === 'function') {
      try {
        renderMonPanel();
      } catch (e) {
        /* swallow */
      }
    }
  }

  /* ------------- indicators page (every 2s) -------------
     The 20+ indicator cards rebuild from cached extras (FR, OI, LS,
     CVD, …). Re-fetching the network would hammer the proxy, so we
     re-run only the local builders. The full indicator HTML rebuild
     is a few-millisecond DOM update on every other tick. */
  function pulseIndicators() {
    if (!pulseIndicators._n) pulseIndicators._n = 0;
    pulseIndicators._n++;
    if (pulseIndicators._n % 2 !== 0) return;
    var el = document.getElementById('indCards');
    if (!el || !el.children || !el.children.length) return; /* never rebuilt yet */
    var builders = [
      'buildStablecoinCard',
      'buildTVLCard',
      'buildUnlocksCard',
      'buildFRCard',
      'buildFRHistCard',
      'buildOICard',
      'buildOIHistCard',
      'buildTopTradersCard',
      'buildLiqCard',
      'buildWhaleCard',
      'buildRealCVDCard',
      'buildCVDCard',
      'buildOBCard',
      'buildTakerCard',
      'buildSpreadCard',
      'buildMultiOICard',
      'buildMultiFRCard',
      'buildAggLiqCard',
      'buildDEXCard',
      'buildCBPremiumCard',
      'buildOnChainCard',
      'buildBitfinexCard',
    ];
    var html = '';
    for (var i = 0; i < builders.length; i++) {
      try {
        var fn = window[builders[i]];
        if (typeof fn === 'function') html += fn();
      } catch (e) {
        /* skip a single broken builder */
      }
    }
    if (html && el.innerHTML.length !== html.length) el.innerHTML = html;
  }

  /* ------------- order book on whale page (depth WebSocket) -------------
     The legacy loadLiq() built #obS from a one-shot REST /depth call
     for five symbols; nothing kept it fresh after the user opened the
     page. We now subscribe to <sym>@depth20@100ms for each of those
     symbols whenever the whale page is active and the liquidity tab
     is open, then redraw the bid/ask bars in place every ~100ms. */
  var OB_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
  var obSubs = {};
  var obBooks = {};
  var obLastRender = 0;

  function _obRender() {
    var el = document.getElementById('obS');
    if (!el) return;
    var now = Date.now();
    /* Cap the DOM refresh to ~10fps even though the WS pushes every
       100ms — it means at most one render per push and avoids
       redundant work when multiple subs fire in the same tick. */
    if (now - obLastRender < 90) return;
    obLastRender = now;
    var html = '';
    for (var i = 0; i < OB_SYMBOLS.length; i++) {
      var s = OB_SYMBOLS[i];
      var book = obBooks[s];
      if (!book || !book.bids.length || !book.asks.length) continue;
      var bidsVal = book.bids.map(function (b) {
        return b.p * b.q;
      });
      var asksVal = book.asks.map(function (a) {
        return a.p * a.q;
      });
      var bT = bidsVal.reduce(function (acc, v) {
        return acc + v;
      }, 0);
      var aT = asksVal.reduce(function (acc, v) {
        return acc + v;
      }, 0);
      var r = aT > 0 ? bT / aT : 1;
      var mx = Math.max.apply(null, bidsVal.concat(asksVal));
      var lbl = r > 1.3 ? 'BUY' : r < 0.7 ? 'SELL' : 'NEUTRAL';
      var col = r > 1.3 ? 'up' : r < 0.7 ? 'dn' : 'warn';
      var bidsHtml = bidsVal
        .slice()
        .reverse()
        .map(function (v) {
          return '<div class="ob-b bid" style="height:' + Math.max(3, (v / mx) * 100) + '%"></div>';
        })
        .join('');
      var asksHtml = asksVal
        .map(function (v) {
          return '<div class="ob-b ask" style="height:' + Math.max(3, (v / mx) * 100) + '%"></div>';
        })
        .join('');
      html +=
        '<div class="cd" style="padding:8px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:700;font-family:var(--fd)">' +
        s +
        '</span><span style="font-size:9px;font-family:var(--fm);color:var(--' +
        col +
        ')">' +
        lbl +
        ' ' +
        r.toFixed(2) +
        'x</span></div><div class="ob-v">' +
        bidsHtml +
        '<div style="width:1px;background:var(--t3);height:100%"></div>' +
        asksHtml +
        '</div></div>';
    }
    if (html && el.innerHTML.length !== html.length) el.innerHTML = html;
  }

  function syncOrderBookSubs() {
    /* Order book lives on the whale page under the liquidity tab
       (#wh1 must be the visible tab body). When it isn't visible
       there's no DOM to update, so unsubscribe to free the sockets. */
    var page = activePageId();
    var liqVisible =
      page === 'whale' &&
      (function () {
        var tab = document.getElementById('wh1');
        return !!(tab && tab.style.display !== 'none');
      })();
    var want = liqVisible;
    var have = !!Object.keys(obSubs).length;
    if (want && !have && typeof DepthStream !== 'undefined' && DepthStream.subscribe) {
      OB_SYMBOLS.forEach(function (s) {
        obSubs[s] = DepthStream.subscribe(s + 'USDT', function (book) {
          obBooks[s] = book;
          _obRender();
        });
      });
    } else if (!want && have) {
      Object.keys(obSubs).forEach(function (k) {
        try {
          obSubs[k].close();
        } catch (e) {
          /* ignore */
        }
      });
      obSubs = {};
    }
  }

  /* ------------- BTC/ETH market analysis page price ticker -------------
     The market analysis report is heavy and stays cached for 30 min,
     but the headline price + 24h change at the top should track
     real-time. We tag those elements with data-live-mkt during render
     and update only their text from T[sym] on each tick. */
  function pulseMarket() {
    if (typeof T === 'undefined' || !T) return;
    var nodes = document.querySelectorAll('[data-live-mkt]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var sym = n.getAttribute('data-live-mkt-sym');
      var kind = n.getAttribute('data-live-mkt');
      if (!sym) continue;
      var d = T[sym];
      if (!d || !(d.p > 0)) continue;
      if (kind === 'price') {
        var newTxt = typeof rP === 'function' ? rP(d.p) : d.p.toFixed(2);
        if (n.textContent !== newTxt) {
          var prev = prevPrice['mkt:' + sym];
          n.textContent = newTxt;
          if (prev != null && prev !== d.p) flick(n, d.p > prev ? 1 : -1);
          prevPrice['mkt:' + sym] = d.p;
        }
      } else if (kind === 'change') {
        var ch = typeof d.c === 'number' ? d.c : 0;
        var ctx = (ch >= 0 ? '+' : '') + ch.toFixed(1) + '% (24h)';
        if (n.textContent !== ctx) {
          n.textContent = ctx;
          n.style.color = ch >= 0 ? 'var(--up)' : 'var(--dn)';
        }
      }
    }
  }

  /* ------------- VPS notifier 24/7 status pill -------------
     The Contabo VPS posts a heartbeat to /api/vps-heartbeat every
     60s; we poll /api/vps-status every 15s and reflect the result on
     the #vpsPill in the header. Keeps users honest about whether
     their always-on Telegram path is actually running, separately
     from the in-browser WebSocket health. */
  var lastVpsCheck = 0;
  function pulseVpsStatus() {
    var pill = document.getElementById('vpsPill');
    if (!pill) return;
    var now = Date.now();
    if (now - lastVpsCheck < 15000) return;
    lastVpsCheck = now;
    var proxy = typeof PROXY !== 'undefined' && PROXY ? PROXY : '';
    if (!proxy) return;
    fetch(proxy + '/api/vps-status', { method: 'GET', cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        setVpsCache(j);
        if (!j) {
          pill.setAttribute('data-state', 'offline');
          var s1 = document.getElementById('vpsPillState');
          if (s1) s1.textContent = 'OFFLINE';
          return;
        }
        var stateEl = document.getElementById('vpsPillState');
        if (j.alive) {
          pill.setAttribute('data-state', 'online');
          if (stateEl) stateEl.textContent = 'ONLINE';
          if (j.last && (j.last.sent != null || j.last.dropped != null)) {
            pill.title =
              '24/7 VPS notifier — sent ' +
              (j.last.sent || 0) +
              ' · dropped ' +
              (j.last.dropped || 0) +
              ' · last ' +
              Math.round(j.ageMs / 1000) +
              's ago';
          }
        } else if (j.stale) {
          pill.setAttribute('data-state', 'stale');
          if (stateEl) stateEl.textContent = 'STALE';
          pill.title = '24/7 VPS notifier — last heartbeat ' + Math.round(j.ageMs / 1000) + 's ago';
        } else {
          pill.setAttribute('data-state', 'offline');
          if (stateEl) stateEl.textContent = 'OFFLINE';
          pill.title = '24/7 VPS notifier — no heartbeat received';
        }
      })
      .catch(function () {
        pill.setAttribute('data-state', 'offline');
        var s2 = document.getElementById('vpsPillState');
        if (s2) s2.textContent = 'OFFLINE';
      });
  }

  /* ------------- Live System Status panel (sidebar) -------------
     Reads the snapshot APIs from KlineStream / DepthStream + the
     existing connMetrics + the cached vps-status so the user has a
     single diagnostic surface for the whole real-time stack.
     Repaints only while the side menu is visible — guarded by the
     `.show` class on #sideMenu — to avoid useless DOM churn. */
  var lastVpsStatus = null;
  function setVpsCache(j) {
    lastVpsStatus = j;
  }
  /* Reuse the response we already fetch in pulseVpsStatus by hooking
     into the same /api/vps-status poller — patch it once below. */

  function pulseLiveSystem() {
    var menu = document.getElementById('sideMenu');
    if (!menu || !menu.classList.contains('show')) return;
    var grid = document.getElementById('lssGrid');
    if (!grid) return;

    /* Ticker WS — driven by src/price-stream.js. */
    var tEl = document.getElementById('lssTicker');
    if (tEl) {
      var up = typeof connMetrics !== 'undefined' && connMetrics && connMetrics.wsUp;
      tEl.textContent = up ? 'CONNECTED' : 'DOWN';
      tEl.className = 'lss-v ' + (up ? 'ok' : 'bad');
    }

    /* Kline streams. */
    var kEl = document.getElementById('lssKline');
    if (kEl && typeof KlineStream !== 'undefined' && KlineStream.snapshot) {
      var ks = KlineStream.snapshot();
      kEl.textContent = ks.streams + ' streams · ' + ks.subs + ' subs';
      kEl.className = 'lss-v ' + (ks.streams ? 'ok' : '');
    }

    /* Depth streams. */
    var dEl = document.getElementById('lssDepth');
    if (dEl && typeof DepthStream !== 'undefined' && DepthStream.snapshot) {
      var ds = DepthStream.snapshot();
      dEl.textContent = ds.streams + ' streams · ' + ds.subs + ' subs';
      dEl.className = 'lss-v ' + (ds.streams ? 'ok' : '');
    }

    /* Latency — kline if available, else depth. */
    var lEl = document.getElementById('lssLat');
    if (lEl) {
      var lat = null;
      if (typeof KlineStream !== 'undefined' && KlineStream.metrics)
        lat = KlineStream.metrics.latencyMs;
      if (lat == null && typeof DepthStream !== 'undefined' && DepthStream.metrics)
        lat = DepthStream.metrics.latencyMs;
      if (lat == null || lat < 0) {
        lEl.textContent = '--';
        lEl.className = 'lss-v';
      } else {
        lEl.textContent = lat + ' ms';
        lEl.className = 'lss-v ' + (lat < 500 ? 'ok' : lat < 2000 ? 'warn' : 'bad');
      }
    }

    /* VPS notifier — uses the cached /api/vps-status response. */
    var vEl = document.getElementById('lssVps');
    if (vEl) {
      var v = lastVpsStatus;
      if (!v) {
        vEl.textContent = '...';
        vEl.className = 'lss-v';
      } else if (v.alive) {
        vEl.textContent = 'ONLINE · ' + Math.round(v.ageMs / 1000) + 's ago';
        vEl.className = 'lss-v ok';
      } else if (v.stale) {
        vEl.textContent = 'STALE · ' + Math.round(v.ageMs / 1000) + 's ago';
        vEl.className = 'lss-v warn';
      } else {
        vEl.textContent = 'OFFLINE';
        vEl.className = 'lss-v bad';
      }
    }

    /* Sent / Dropped counters from the heartbeat tooltip. */
    var cEl = document.getElementById('lssCnt');
    if (cEl) {
      var lv = lastVpsStatus && lastVpsStatus.last;
      if (lv && (lv.sent != null || lv.dropped != null)) {
        cEl.textContent = (lv.sent || 0) + ' / ' + (lv.dropped || 0);
        cEl.className = 'lss-v ok';
      } else {
        cEl.textContent = '--';
        cEl.className = 'lss-v';
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
    pulseVpsStatus();
    pulseLiveSystem();
    var page = activePageId();
    if (page === 'live') return;
    if (page === 'dash') {
      pulseDashboard();
      pulseDashSecondary();
    }
    if (page === 'favs') pulseFavourites();
    if (page === 'scan') pulseScanner();
    if (page === 'whale') {
      pulseWhale();
      syncOrderBookSubs();
    } else {
      /* Tear down depth subs if we're no longer on the whale page. */
      syncOrderBookSubs();
    }
    if (page === 'market') pulseMarket();
    if (page === 'heatmap') pulseHeatmap();
    if (page === 'alerts') pulseAlerts();
    if (page === 'monitor') pulseMonitor();
    if (page === 'ind') pulseIndicators();
    if (page === 'me') pulsePortfolio();
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
