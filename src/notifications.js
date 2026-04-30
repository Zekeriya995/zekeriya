/* NEXUS PRO — notifications: in-page popup, audio cues, history list,
   Telegram relay, and the per-hour notification dedupe set.

   This file owns the notification surface end-to-end. The `notify()`
   entry point at the bottom is what the rest of the app calls; all
   wiring around it (popups, sound preference, Telegram message
   formatting, watchlist alerts, history persistence) lives here too.

   Cross-file dependencies are resolved at call time:
     - constants:    PROXY (src/constants.js)
     - utils:        esc, fmt, fP (src/utils.js)
     - app.js state: T, FR, CBP, whaleWaves, lang, signalQualityGate,
                     openTrade, timeBadge
   The hourly reset in init() (app.js) clears notifiedSet + tgSent. */

/* ─── per-hour dedupe set, persisted to localStorage ───────────── */
var notifiedSet = {};
try {
  notifiedSet = JSON.parse(localStorage.getItem('nxnot10') || '{}');
} catch (e) {}

/* Telegram dedupe set — also persisted now (was in-memory only,
   which made every page reload re-send the same Telegram for the
   same signal/hour). Same key shape as notifiedSet so the bgInterval
   reset can wipe both atomically. */
var tgSent = {};
try {
  tgSent = JSON.parse(localStorage.getItem('nxtgs10') || '{}');
} catch (e) {}

/* ─── persisted notification history (last 50) ─────────────────── */
var notifHist = [];
try {
  notifHist = JSON.parse(localStorage.getItem('nxnh10') || '[]');
} catch (e) {}

function addNotifHist(icon, sym, type, body) {
  notifHist.unshift({ icon: icon, sym: sym, type: type, body: body, time: Date.now() });
  if (notifHist.length > 50) notifHist = notifHist.slice(0, 50);
  try {
    localStorage.setItem('nxnh10', JSON.stringify(notifHist));
  } catch (e) {}
}

/* Delegated click handler — installed once on the list container so
   it survives every innerHTML re-render of its children. Replaces the
   inline `onclick="openCoin('SYM')"` attribute, which was both a CSP
   liability and an attribute-injection sink (apostrophes in user-
   sourced data could break out of the handler string). The data-sym
   attribute is escape-friendly: textContent / setAttribute won't
   collapse a malformed value into JS source. */
function _attachNotifHistDelegate(el) {
  if (!el || el._nxNotifBound) return;
  el._nxNotifBound = true;
  el.addEventListener('click', function (ev) {
    var row = ev.target && ev.target.closest ? ev.target.closest('[data-sym]') : null;
    if (!row) return;
    var sym = row.getAttribute('data-sym');
    if (sym && typeof openCoin === 'function') openCoin(sym);
  });
}

function renderNotifHist() {
  var el = document.getElementById('notifHistList');
  if (!el) return;
  _attachNotifHistDelegate(el);
  el.innerHTML = notifHist.length
    ? notifHist
        .slice(0, 20)
        .map(function (n) {
          return (
            '<div class="al-i" style="cursor:pointer" data-sym="' +
            esc(n.sym) +
            '"><div class="al-l"><div style="font-size:18px">' +
            esc(n.icon) +
            '</div><div><div style="font-weight:600;font-size:11px">' +
            esc(n.sym) +
            ' — ' +
            esc(n.type) +
            '</div><div style="font-size:8px;color:var(--t3)">' +
            esc(n.body) +
            '</div></div></div><div style="font-size:8px;font-family:var(--fm);color:var(--t2)">' +
            timeBadge(n.time) +
            '</div></div>'
          );
        })
        .join('')
    : '<div class="empty"><div class="empty-ic">🔔</div><div class="empty-tx">' +
      (lang === 'ar' ? 'لا إشعارات' : 'No notifications') +
      '</div></div>';
}

/* ─── watchlist alerts: ±3% triggers a notification per coin/hour ─ */
function checkWatchlistAlerts() {
  /* Honour the user's "Watchlist" toggle (default ON). */
  if (!isAlertEnabled(alertPrefs, 'watchlist')) return;
  var wl = [];
  try {
    wl = JSON.parse(localStorage.getItem('nxwl10') || '[]');
  } catch (e) {}
  var bucket = notifHourBucket();
  wl.forEach(function (sym) {
    var d = T[sym];
    if (!d) return;
    if (d.c >= 3) {
      var k = 'wl_' + sym + '_' + bucket;
      if (!notifiedSet[k]) {
        notifiedSet[k] = true;
        try {
          localStorage.setItem('nxnot10', JSON.stringify(notifiedSet));
        } catch (e) {}
        playSound('whale');
        showPopup(
          '👁',
          sym + ' — ' + (lang === 'ar' ? 'عملة مراقبة تحركت!' : 'Watchlist coin moved!'),
          '+' + d.c.toFixed(1) + '% | ' + fP(d.p)
        );
        addNotifHist('👁', sym, 'Watchlist', '+' + d.c.toFixed(1) + '%');
      }
    }
    if (d.c <= -3) {
      var kd = 'wl_dn_' + sym + '_' + bucket;
      if (!notifiedSet[kd]) {
        notifiedSet[kd] = true;
        try {
          localStorage.setItem('nxnot10', JSON.stringify(notifiedSet));
        } catch (e) {}
        playSound('whale');
        showPopup(
          '⚠️',
          sym + ' — ' + (lang === 'ar' ? 'عملة مراقبة هبطت!' : 'Watchlist coin dropped!'),
          d.c.toFixed(1) + '% | ' + fP(d.p)
        );
        addNotifHist('⚠️', sym, 'Watchlist Drop', d.c.toFixed(1) + '%');
      }
    }
  });
}

/* ─── audio cues — Web Audio API, respects user tone preference ── */
var soundPref = 'bell';
try {
  soundPref = localStorage.getItem('nxsnd10') || 'bell';
} catch (e) {}
var soundEnabled = true;
try {
  soundEnabled = localStorage.getItem('nxsndon10') !== 'off';
} catch (e) {}

/* Severity-style inputs ('ultra'/'whale'/'gem'/'breakout') are mapped
   to the user's preferred tone via resolveNotifTone (pure helper in
   src/scanner-helpers.js). The previous version forwarded 'ultra'
   straight into previewTone which only knows 'bell'/'horn'/'pulse'
   — every severity notification fell through every branch and played
   nothing, so every ULTRA / whale signal was actually silent.
   tone === 'silent' is still an explicit mute per-call. */
function playSound(tone) {
  var pick = resolveNotifTone(tone, soundPref, soundEnabled);
  if (pick === 'silent') return;
  previewTone(pick);
}

function saveSoundPref() {
  var el = document.getElementById('tglSound');
  if (el) soundEnabled = el.classList.contains('on');
  try {
    localStorage.setItem('nxsndon10', soundEnabled ? 'on' : 'off');
  } catch (e) {}
}

function selTone(el) {
  document.querySelectorAll('.tone-opt').forEach(function (o) {
    o.classList.remove('act');
  });
  el.classList.add('act');
  soundPref = el.dataset.tone;
  try {
    localStorage.setItem('nxsnd10', soundPref);
  } catch (e) {}
  previewTone(soundPref);
}

/* Lazily-created shared AudioContext. Browsers cap concurrent
   AudioContexts (~6) and never garbage-collect un-`close()`d ones
   promptly — the previous code created one per call, so after ~6
   notifications all subsequent sound silently broke. One context
   for the lifetime of the page, with a resume() to undo the
   user-gesture suspension Chrome applies before the first click. */
var _notifAudioCtx = null;
function _notifGetAudioCtx() {
  if (!_notifAudioCtx) {
    try {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      _notifAudioCtx = new Ctor();
    } catch (e) {
      return null;
    }
  }
  if (_notifAudioCtx.state === 'suspended') {
    try {
      _notifAudioCtx.resume();
    } catch (e) {}
  }
  return _notifAudioCtx;
}

function previewTone(tone) {
  if (tone === 'silent') return;
  /* selTone() and the tone-picker UI play a preview synchronously
     in response to a user click. playSound() — invoked from notify() —
     can fire when the page is in the background, where the user has
     not yet clicked anything and AudioContext is suspended. The
     resume() inside _notifGetAudioCtx covers both paths. */
  if (soundEnabled === false) return;
  try {
    var ac = _notifGetAudioCtx();
    if (!ac) return;
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    if (tone === 'bell') {
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ac.currentTime + 0.15);
      setTimeout(function () {
        var o2 = ac.createOscillator();
        var g2 = ac.createGain();
        o2.connect(g2);
        g2.connect(ac.destination);
        g2.gain.value = 0.3;
        o2.frequency.value = 1100;
        o2.type = 'sine';
        o2.start();
        o2.stop(ac.currentTime + 0.15);
      }, 180);
    } else if (tone === 'horn') {
      osc.frequency.value = 440;
      osc.type = 'sawtooth';
      gain.gain.value = 0.35;
      osc.start();
      osc.stop(ac.currentTime + 0.4);
    } else if (tone === 'pulse') {
      osc.frequency.value = 1000;
      osc.type = 'square';
      gain.gain.value = 0.2;
      osc.start();
      osc.stop(ac.currentTime + 0.08);
      setTimeout(function () {
        var o2 = ac.createOscillator();
        var g2 = ac.createGain();
        o2.connect(g2);
        g2.connect(ac.destination);
        g2.gain.value = 0.2;
        o2.frequency.value = 1000;
        o2.type = 'square';
        o2.start();
        o2.stop(ac.currentTime + 0.08);
      }, 120);
      setTimeout(function () {
        var o3 = ac.createOscillator();
        var g3 = ac.createGain();
        o3.connect(g3);
        g3.connect(ac.destination);
        g3.gain.value = 0.2;
        o3.frequency.value = 1200;
        o3.type = 'square';
        o3.start();
        o3.stop(ac.currentTime + 0.12);
      }, 240);
    }
  } catch (e) {}
}

function loadToneUI() {
  var opts = document.querySelectorAll('.tone-opt');
  opts.forEach(function (o) {
    o.classList.remove('act');
    if (o.dataset.tone === soundPref) o.classList.add('act');
  });
  if (!soundEnabled) document.getElementById('tglSound').classList.remove('on');
}

/* ─── Telegram relay (via the secure proxy — token never client-side) ─
   tgSent is now persisted (loaded near the top of the file via
   safeGetJSON('nxtgs10', {})) so a page reload no longer re-sends
   the same Telegram for the same signal. */
var TG_PROXY = PROXY + '/notify';
if (/your-nexus-proxy|placeholder|example\.com/i.test(TG_PROXY)) {
  console.warn(
    '[TG] TG_PROXY looks like a placeholder — Telegram notifications disabled:',
    TG_PROXY
  );
}

function sendTG(html) {
  if (/your-nexus-proxy|placeholder|example\.com/i.test(TG_PROXY)) return;
  try {
    fetch(TG_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: html }),
    }).catch(function (e) {
      console.warn('[TG] send failed:', e);
    });
  } catch (e) {
    console.warn('[TG] send threw:', e);
  }
}

function tgNotify(sym, type, data) {
  /* Dedup: same coin+type per hour-bucket (bucket = epoch_ms / 3600000). */
  var k = notifDedupeKey(sym, type);
  if (tgSent[k]) return;
  tgSent[k] = true;
  try {
    localStorage.setItem('nxtgs10', JSON.stringify(tgSent));
  } catch (e) {}
  var d = T[sym] || { p: 0, c: 0, v: 0 };
  var fr = FR[sym];
  var waves = whaleWaves[sym] ? whaleWaves[sym].waves : [];
  var src = [];
  if (T[sym]) src.push('Binance');
  if (d.by) src.push('Bybit');
  if (CBP[sym]) src.push('Coinbase');
  var msg = '';
  if (type === 'ultra') {
    var checks = data.checks || {};
    var passed = data.passed || 0;
    var total = data.total || 6;
    msg =
      '⭐ <b>ULTRA SIGNAL — ' +
      sym +
      '/USDT</b>\n\n' +
      '📊 Score: <b>' +
      data.score +
      '</b> | ' +
      passed +
      '/' +
      total +
      ' Checks ✅\n' +
      '💰 <b>' +
      fP(d.p) +
      '</b> (' +
      (d.c >= 0 ? '+' : '') +
      d.c.toFixed(1) +
      '%)\n' +
      '📈 Vol: <b>' +
      fmt(d.v) +
      '</b>\n\n' +
      '✅ VOL ' +
      (checks.vol ? '✅' : '❌') +
      ' │ OB ' +
      (checks.ob ? '✅' : '❌') +
      '\n' +
      '✅ RSI ' +
      (checks.rsi ? '✅' : '❌') +
      ' │ MACD ' +
      (checks.macd ? '✅' : '❌') +
      '\n' +
      '✅ FR ' +
      (checks.fr ? '✅' : '❌') +
      ' │ OI ' +
      (checks.oi ? '✅' : '❌') +
      '\n\n' +
      '🎯 هدف: <b>' +
      fP(d.p * 1.08) +
      ' — ' +
      fP(d.p * 1.15) +
      '</b>\n' +
      '🛑 وقف: <b>' +
      fP(d.p * 0.93) +
      '</b>\n' +
      (waves.length >= 2 ? '\n🐋 ' + waves.length + ' موجات حيتان | ⚡ تجميع قوي\n' : '') +
      (fr ? '\n💰 FR: ' + (fr.rate >= 0 ? '+' : '') + fr.rate.toFixed(4) + '%\n' : '') +
      '\n📍 ' +
      src.join(' · ') +
      '\n' +
      '━━━━━━━━━━━━━━━━━\n' +
      '🤖 <b>NEXUS PRO</b> | ⏱ ' +
      new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  } else if (type === 'whale') {
    var waveCount = waves.length;
    msg =
      '🐋 <b>' +
      (waveCount >= 3 ? '🐋🐋🐋' : '🐋') +
      ' تجميع حيتان — ' +
      sym +
      '/USDT</b>\n\n' +
      '💰 <b>' +
      fP(d.p) +
      '</b> (' +
      (d.c >= 0 ? '+' : '') +
      d.c.toFixed(1) +
      '%)\n' +
      '📈 Vol: ' +
      fmt(d.v) +
      '\n';
    if (waveCount > 0) {
      msg += '\n📊 <b>' + waveCount + ' موجات تجميع:</b>\n';
      waves.forEach(function (w, i) {
        msg += '🐋 #' + (i + 1) + ' | ' + fmt(w.amount) + ' | ' + fP(w.price) + '\n';
      });
      var tot = waves.reduce(function (s, w) {
        return s + w.amount;
      }, 0);
      msg += '\n💎 إجمالي: <b>' + fmt(tot) + '</b>\n';
    }
    msg +=
      '\n📍 ' +
      src.join(' · ') +
      '\n' +
      '━━━━━━━━━━━━━━━━━\n' +
      '🤖 <b>NEXUS PRO</b> | ⏱ ' +
      new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  } else if (type === 'gem') {
    msg =
      '💎 <b>جوهرة مكتشفة — ' +
      sym +
      '/USDT</b>\n\n' +
      '💰 <b>' +
      fP(d.p) +
      '</b> (' +
      (d.c >= 0 ? '+' : '') +
      d.c.toFixed(1) +
      '%)\n' +
      '📈 Vol: ' +
      fmt(d.v) +
      '\n' +
      (d.c < 3
        ? '\n🟢 <b>صيد مبكر — ادخل!</b>\n'
        : d.c < 8
          ? '\n🟡 لسا فيه فرصة\n'
          : '\n🔴 متأخر — راقب فقط\n') +
      '\n📍 ' +
      src.join(' · ') +
      '\n' +
      '━━━━━━━━━━━━━━━━━\n' +
      '🤖 <b>NEXUS PRO</b> | ⏱ ' +
      new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  }
  if (msg) sendTG(msg);
}

/* ─── on-screen popup (uses textContent — no XSS risk) ─────────────
   The popup is a single shared DOM element and a single visible-time
   slot. Two notifications close together used to overwrite each
   other mid-display because the hide timer was non-cancellable.

   New contract:
     - showPopup() during an active display queues the new entry
     - the previously-scheduled hide timer is cancelled and
       re-scheduled so the just-arrived popup gets its full 4000ms
     - on hide, the queue's next entry slides in after a 350ms gap
       to let the slide-out animation finish

   Also gives the popup a polite aria-live region so screen readers
   pick up each new title — `index.html:219` adds role="status" and
   aria-live="polite" so the textContent updates announce. */
var _popupVisible = false;
var _popupHideTimer = null;
var _popupQueue = [];
var _POPUP_VISIBLE_MS = 4000;
var _POPUP_GAP_MS = 350;

/* Defensive document lookup — returns null if `document` is missing
   (test harness with stubbed/replaced globals) or the element isn't
   in the DOM yet. Both paths are non-fatal; the popup just no-ops. */
function _popupGetEl(id) {
  try {
    if (typeof document === 'undefined' || !document || !document.getElementById) return null;
    return document.getElementById(id);
  } catch (e) {
    return null;
  }
}

function _popupApply(icon, title, body) {
  var el = _popupGetEl('notifPopup');
  if (!el) return false;
  var ic = _popupGetEl('npIcon');
  var ti = _popupGetEl('npTitle');
  var bd = _popupGetEl('npBody');
  var tm = _popupGetEl('npTime');
  if (ic) ic.textContent = icon;
  if (ti) ti.textContent = title;
  if (bd) bd.textContent = body;
  if (tm) tm.textContent = '🆕';
  if (el.style) el.style.top = '12px';
  return true;
}

function _popupHideAndDrain() {
  var el = _popupGetEl('notifPopup');
  if (el && el.style) el.style.top = '-80px';
  _popupVisible = false;
  _popupHideTimer = null;
  if (_popupQueue.length) {
    /* Tiny gap so the slide-out animation reads as a transition,
       not a flicker. Then the next entry slides in. */
    setTimeout(function () {
      var next = _popupQueue.shift();
      if (next) _popupShowNow(next.icon, next.title, next.body);
    }, _POPUP_GAP_MS);
  }
}

function _popupShowNow(icon, title, body) {
  if (!_popupApply(icon, title, body)) return;
  _popupVisible = true;
  if (_popupHideTimer) clearTimeout(_popupHideTimer);
  _popupHideTimer = setTimeout(_popupHideAndDrain, _POPUP_VISIBLE_MS);
}

function showPopup(icon, title, body) {
  if (_popupVisible) {
    /* Bound the queue so a notification storm doesn't grow it
       unbounded. 5 queued is enough to cover a typical scanner
       burst; older entries are dropped (they'd be stale by the time
       they showed anyway). */
    if (_popupQueue.length >= 5) _popupQueue.shift();
    _popupQueue.push({ icon: icon, title: title, body: body });
    return;
  }
  _popupShowNow(icon, title, body);
}

/* ─── per-page alert preferences (toggle list in settings) ─────── */
var alertPrefs = {};
try {
  alertPrefs = JSON.parse(localStorage.getItem('nxAlertPrefs') || '{}');
} catch (e) {
  alertPrefs = {};
}

function saveAlertPref(key, val) {
  alertPrefs[key] = val;
  try {
    localStorage.setItem('nxAlertPrefs', JSON.stringify(alertPrefs));
  } catch (e) {}
}

/* ─── public entry point: route a signal through the gate, dedupe,
       trigger sound + popup + history + Telegram + auto-trade ──── */
function notify(sym, type, score, extra) {
  /* Block small coin (gem) notifications first — even before
     alertPrefs — because gems have their own dedicated UI panel
     and must never spam the popup channel. */
  if (type === 'gem') return;
  /* Per-type user toggle. Defaults ON so existing users see no
     behavior change unless they explicitly disable a category in
     settings. The toggle UI was decorative until this gate was
     added — alertPrefs[key] was written but never read. */
  if (!isAlertEnabled(alertPrefs, type)) return;
  /* Hour-bucket dedupe key now uses a continuous bucket since epoch
     (notifDedupeKey helper). The previous `new Date().getHours()`
     suffix collided every 24h — a notification fired at 14:10 was
     still being suppressed at 14:10 the next day. */
  var k = notifDedupeKey(sym, type);
  if (notifiedSet[k]) return;
  /* Whale: only notify if total buy volume > $100,000 */
  if (type === 'whale') {
    var ww = whaleWaves[sym];
    if (!ww || !ww.engine || !ww.totalBuy || ww.totalBuy < 100000) return;
  }
  /* === QUALITY GATE ===
     A throwing gate used to fall through to the success path (empty
     catch + no return). Treat throws as "we cannot vouch for this
     signal — drop it" and mark the key so we don't retry on the
     next cycle. */
  try {
    var gate = signalQualityGate(sym, type, score);
    if (!gate.pass) {
      notifiedSet[k] = true;
      try {
        localStorage.setItem('nxnot10', JSON.stringify(notifiedSet));
      } catch (e) {}
      return;
    }
  } catch (gateErr) {
    console.warn('[notify] quality gate threw — skipping signal:', gateErr);
    notifiedSet[k] = true;
    try {
      localStorage.setItem('nxnot10', JSON.stringify(notifiedSet));
    } catch (e) {}
    return;
  }
  notifiedSet[k] = true;
  try {
    localStorage.setItem('nxnot10', JSON.stringify(notifiedSet));
  } catch (e) {}
  playSound(type);
  if (type === 'ultra') {
    showPopup(
      '⭐',
      sym + ' — ULTRA Signal!',
      'Score: ' + score + ' | ' + (lang === 'ar' ? 'ادخل الآن!' : 'Enter now!')
    );
    addNotifHist('⭐', sym, 'ULTRA', 'Score: ' + score);
    tgNotify(sym, 'ultra', extra || { score: score });
    if (T[sym]) openTrade(sym, T[sym].p, 'ultra', score, extra);
  } else if (type === 'whale') {
    var wVol = whaleWaves[sym] ? whaleWaves[sym].totalBuy : 0;
    showPopup(
      '🐋',
      sym + ' — ' + (lang === 'ar' ? 'تجميع حيتان!' : 'Whale detected!'),
      '$' + fmt(wVol)
    );
    addNotifHist('🐋', sym, lang === 'ar' ? 'حوت' : 'Whale', '$' + fmt(wVol));
    tgNotify(sym, 'whale', {});
    if (T[sym]) openTrade(sym, T[sym].p, 'whale', score);
  }
}
