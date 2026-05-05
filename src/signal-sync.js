/* NEXUS PRO — VPS signal backlog sync
 *
 * The web platform stops processing the moment the user closes the
 * tab. Whale accumulations, breakouts and scanner picks that fire
 * during the offline window all get re-detected at cold start and
 * stamped with `Date.now()`, so the user sees "buy NOW" labels for
 * events that actually fired hours earlier — completely useless for
 * deciding whether a setup is fresh or stale.
 *
 * This module closes that gap. The Contabo VPS already runs
 * nexus_notifier.py 24/7; once vps/signal_log.py + signal_server.py
 * are deployed and exposed via a Cloudflare Tunnel, every signal
 * the notifier produces gets a permanent timestamped record. On
 * every PWA cold start we hit:
 *
 *     GET <vpsUrl>/signals?since=<lastSyncMs>
 *
 * and merge each row into notifHist with its REAL detection time, so
 * the notification log shows "BTC تجميع — منذ ساعتين" instead of
 * "BTC تجميع — الآن". A small badge bubble in the popup announces
 * how many backlog items were merged so the user knows the sync ran.
 *
 * The VPS URL is user-configurable: paste your Cloudflare Tunnel URL
 * into the sidebar's "VPS Sync URL" field once and it persists. No
 * URL, no sync — the rest of the app keeps working.
 *
 * Optional shared secret (NEXUS_SIGNAL_SECRET on the server) is sent
 * as the X-Signal-Secret header for environments where the tunnel
 * URL leaks.
 */

(function () {
  'use strict';

  var STORAGE_VPS_URL = 'nx_vps_sync_url';
  var STORAGE_VPS_SECRET = 'nx_vps_sync_secret';
  var STORAGE_LAST_SYNC = 'nx_vps_last_sync';
  /* Anything older than 24h on cold start is dropped — past that point
     a signal is not actionable, and we don't want to flood notifHist
     after a week-long absence. */
  var MAX_AGE_MS = 24 * 60 * 60 * 1000;
  /* Once initialised the first sync runs immediately, then we poll
     every 60 seconds while the platform is open so any signal the VPS
     emits while the user is staring at a different tab still surfaces
     within a minute. */
  var POLL_INTERVAL_MS = 60 * 1000;

  function _getCfg() {
    var url = '';
    var secret = '';
    try {
      url = (localStorage.getItem(STORAGE_VPS_URL) || '').trim();
      secret = (localStorage.getItem(STORAGE_VPS_SECRET) || '').trim();
    } catch (e) {
      /* private mode / disabled storage */
    }
    if (url && url.slice(-1) === '/') url = url.slice(0, -1);
    return { url: url, secret: secret };
  }

  function _setCfg(url, secret) {
    try {
      localStorage.setItem(STORAGE_VPS_URL, (url || '').trim());
      if (secret != null) {
        localStorage.setItem(STORAGE_VPS_SECRET, (secret || '').trim());
      }
    } catch (e) {
      /* swallow */
    }
  }

  function _readLastSync() {
    try {
      var v = localStorage.getItem(STORAGE_LAST_SYNC);
      return v ? Math.max(0, parseInt(v, 10) || 0) : 0;
    } catch (e) {
      return 0;
    }
  }

  function _writeLastSync(ms) {
    try {
      localStorage.setItem(STORAGE_LAST_SYNC, String(ms));
    } catch (e) {
      /* swallow */
    }
  }

  /* Map a VPS signal record into the same {icon, sym, type, body, time}
     shape the existing notifHist consumer expects. The labels are
     localised at render time by t() — keep them as plain keys here. */
  function _toHistEntry(rec) {
    if (!rec || !rec.sym || !rec.kind) return null;
    var icon = '🔔';
    var type = rec.kind;
    if (rec.kind === 'ULTRA') icon = '⭐';
    else if (rec.kind === 'GEM') icon = '💎';
    else if (rec.kind === 'WHALE_ACCUM') icon = '🐋';
    else if (rec.kind === 'BREAKOUT') icon = '🚀';
    else if (rec.kind === 'SCANNER_PICK') icon = '📡';
    else if (rec.kind === 'PRICE_ALERT') icon = '💰';
    var body = '';
    var p = rec.payload || {};
    if (p.tier) body += p.tier;
    if (p.reason) body += (body ? ' · ' : '') + p.reason;
    if (p.price) body += (body ? ' · ' : '') + '$' + p.price;
    if (rec.score) body += (body ? ' · ' : '') + 'score ' + rec.score;
    return {
      icon: icon,
      sym: String(rec.sym).toUpperCase(),
      type: type,
      body: body || '—',
      time: +rec.t || Date.now(),
      _vps: true /* marker so the renderer can show the "synced" badge */,
    };
  }

  /* Merge a batch of VPS records into notifHist without duplicating
     anything that's already present (matched by sym+kind+time). */
  function _merge(records) {
    if (typeof notifHist === 'undefined' || !Array.isArray(notifHist)) return 0;
    if (!records || !records.length) return 0;
    var existing = {};
    for (var i = 0; i < notifHist.length; i++) {
      var n = notifHist[i];
      if (n && n.sym && n.type && n.time) {
        existing[n.sym + '|' + n.type + '|' + n.time] = true;
      }
    }
    var added = 0;
    var now = Date.now();
    for (var j = 0; j < records.length; j++) {
      var entry = _toHistEntry(records[j]);
      if (!entry) continue;
      if (now - entry.time > MAX_AGE_MS) continue;
      var key = entry.sym + '|' + entry.type + '|' + entry.time;
      if (existing[key]) continue;
      notifHist.unshift(entry);
      existing[key] = true;
      added++;
    }
    if (added) {
      /* Keep the same 50-item cap notifications.js enforces. */
      if (notifHist.length > 50) notifHist.length = 50;
      try {
        localStorage.setItem('nxnh10', JSON.stringify(notifHist));
      } catch (e) {
        /* quota / disabled — non-fatal */
      }
      if (typeof renderNotifHist === 'function') {
        try {
          renderNotifHist();
        } catch (e) {
          /* ignore */
        }
      }
    }
    return added;
  }

  function _toast(msg) {
    /* The existing notification popup is the cleanest place to surface
       sync results — re-uses the role=status / aria-live region the
       app already has wired up for screen readers. */
    var titleEl = document.getElementById('npTitle');
    var bodyEl = document.getElementById('npBody');
    var iconEl = document.getElementById('npIcon');
    var pop = document.getElementById('notifPopup');
    if (!titleEl || !bodyEl || !pop) return;
    iconEl && (iconEl.textContent = '🔄');
    titleEl.textContent = typeof t === 'function' ? t('vps_sync_done') : 'مزامنة VPS';
    bodyEl.textContent = msg;
    pop.style.top = '20px';
    setTimeout(function () {
      pop.style.top = '-80px';
    }, 3500);
  }

  function syncOnce(opts) {
    opts = opts || {};
    var cfg = _getCfg();
    if (!cfg.url) return Promise.resolve({ added: 0, skipped: 'no_url' });
    var since = _readLastSync();
    var url = cfg.url + '/signals?since=' + encodeURIComponent(since);
    var headers = {};
    if (cfg.secret) headers['X-Signal-Secret'] = cfg.secret;
    return fetch(url, { method: 'GET', cache: 'no-store', headers: headers })
      .then(function (r) {
        if (!r || !r.ok) throw new Error('http_' + (r ? r.status : 'fail'));
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.signals) return { added: 0, skipped: 'no_signals' };
        var added = _merge(j.signals);
        if (j.signals.length) {
          /* Track the newest record we've seen so the next call
             only pulls deltas. */
          var newestT = 0;
          for (var i = 0; i < j.signals.length; i++) {
            if (j.signals[i].t > newestT) newestT = j.signals[i].t;
          }
          if (newestT) _writeLastSync(newestT);
        }
        if (added && opts.toast !== false) {
          _toast(
            typeof lang !== 'undefined' && lang === 'en'
              ? added + ' new signal(s) synced from VPS'
              : 'تمت مزامنة ' + added + ' إشارة جديدة من VPS'
          );
        }
        return { added: added };
      })
      .catch(function (err) {
        return { added: 0, error: String((err && err.message) || err) };
      });
  }

  /* Periodic poller — runs only when at least one VPS URL is set. */
  var pollTimer = null;
  function startPolling() {
    stopPolling();
    var cfg = _getCfg();
    if (!cfg.url) return;
    var schedule =
      typeof bgInterval === 'function'
        ? bgInterval
        : function (fn, ms) {
            return setInterval(fn, ms);
          };
    pollTimer = schedule(function () {
      syncOnce({ toast: true });
    }, POLL_INTERVAL_MS);
  }
  function stopPolling() {
    if (pollTimer && typeof clearInterval === 'function') {
      clearInterval(pollTimer);
    }
    pollTimer = null;
  }

  function configure(url, secret) {
    _setCfg(url, secret);
    /* Reset the watermark so the next call grabs the last 24h on
       the new endpoint. */
    _writeLastSync(0);
    syncOnce({ toast: false });
    startPolling();
  }

  /* Hydrate the sidebar inputs from localStorage and wire up the save
     button. Runs once after the DOM is ready. */
  function _wireSidebar() {
    var urlInp = document.getElementById('vpsSyncUrl');
    var secInp = document.getElementById('vpsSyncSecret');
    var saveBtn = document.getElementById('vpsSyncSave');
    var statusEl = document.getElementById('vpsSyncStatus');
    if (!urlInp || !saveBtn) return;
    var cur = _getCfg();
    urlInp.value = cur.url || '';
    if (secInp) secInp.value = cur.secret || '';

    function setStatus(msg, ok) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.style.color = ok ? 'var(--up)' : 'var(--dn)';
    }

    saveBtn.addEventListener('click', function () {
      var url = (urlInp.value || '').trim();
      var sec = secInp ? (secInp.value || '').trim() : '';
      if (!url) {
        configure('', '');
        stopPolling();
        setStatus(lang === 'en' ? 'Cleared' : 'تم المسح', true);
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        setStatus(
          lang === 'en' ? 'URL must start with https://' : 'يجب أن يبدأ الرابط بـ https://',
          false
        );
        return;
      }
      configure(url, sec);
      setStatus(lang === 'en' ? 'Syncing…' : 'جارٍ المزامنة…', true);
      syncOnce({ toast: false }).then(function (r) {
        if (r && r.error) {
          setStatus((lang === 'en' ? 'Failed: ' : 'فشل: ') + r.error, false);
        } else {
          setStatus(
            (lang === 'en' ? 'Synced ' : 'تمت — ') +
              (r && r.added ? r.added : 0) +
              (lang === 'en' ? ' new' : ' جديد'),
            true
          );
        }
      });
    });
  }

  /* Auto-bootstrap once the rest of the app has finished init. We
     wait two seconds so notifHist + bgInterval are ready in scope. */
  function _autoBoot() {
    _wireSidebar();
    syncOnce({ toast: true });
    startPolling();
  }

  if (typeof window !== 'undefined') {
    window.SignalSync = {
      configure: configure,
      syncOnce: syncOnce,
      startPolling: startPolling,
      stopPolling: stopPolling,
      getConfig: _getCfg,
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(_autoBoot, 2000);
      });
    } else {
      setTimeout(_autoBoot, 2000);
    }
  }
})();
