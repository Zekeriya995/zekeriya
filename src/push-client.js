/* NEXUS PRO — Web Push client.

   Owns the browser side of Web Push end-to-end: feature detection,
   permission prompt, public-key fetch, PushManager.subscribe(), the
   handshake with /api/push/subscribe, and unsubscribe. The rest of
   the app calls the small `nxPush.*` global below; the SW (sw.js)
   handles `push` and `notificationclick` once a subscription exists.

   Subscriptions live forever on the browser side until the user
   explicitly unsubscribes or clears site data — re-running
   nxPush.subscribe() on a registered tab is a no-op. */

'use strict';

(function () {
  /* The VAPID public key is stable per server so we cache it in
     localStorage once we've fetched it; refreshes hit the network
     only when the cached value is missing. */
  var PROXY_BASE = typeof PROXY === 'string' ? PROXY : '';
  var KEY_STORAGE = 'nxPushVapidKey';

  function _urlBase64ToUint8Array(b64) {
    var padding = '='.repeat((4 - (b64.length % 4)) % 4);
    var base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function isSupported() {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      typeof Notification !== 'undefined'
    );
  }

  async function _fetchVapidKey() {
    try {
      var cached = localStorage.getItem(KEY_STORAGE);
      if (cached) return cached;
    } catch (e) {
      /* localStorage may throw in private mode — fall through to network */
    }
    var r = await fetch(PROXY_BASE + '/api/push/public-key');
    if (!r.ok) throw new Error('vapid_unavailable');
    var data = await r.json();
    if (!data || !data.key) throw new Error('vapid_missing');
    try {
      localStorage.setItem(KEY_STORAGE, data.key);
    } catch (e) {
      /* ignore quota / private-mode */
    }
    return data.key;
  }

  async function _getRegistration() {
    var reg = await navigator.serviceWorker.ready;
    if (!reg) throw new Error('sw_not_ready');
    return reg;
  }

  async function getStatus() {
    if (!isSupported()) return { supported: false, subscribed: false, permission: 'unsupported' };
    var permission = Notification.permission;
    var subscribed = false;
    try {
      var reg = await _getRegistration();
      var sub = await reg.pushManager.getSubscription();
      subscribed = !!sub;
    } catch (e) {
      /* SW not yet registered — treat as not subscribed, not an error */
    }
    return { supported: true, subscribed: subscribed, permission: permission };
  }

  /* subscribe(): full opt-in flow.
     1. requestPermission     (user-visible prompt; iOS PWAs require
                               the call to be in a user-gesture handler)
     2. fetch VAPID key
     3. pushManager.subscribe
     4. POST the subscription to /api/push/subscribe
     Returns { ok: true } on success or throws with a stable error
     code so the UI can render a useful message. */
  async function subscribe() {
    if (!isSupported()) {
      var err = new Error('not_supported');
      err.code = 'not_supported';
      throw err;
    }
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      var e2 = new Error('permission_denied');
      e2.code = 'permission_denied';
      throw e2;
    }
    var reg = await _getRegistration();
    var existing = await reg.pushManager.getSubscription();
    var sub = existing;
    if (!sub) {
      var key = await _fetchVapidKey();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(key),
      });
    }
    var r = await fetch(PROXY_BASE + '/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub }),
    });
    if (!r.ok) {
      var e3 = new Error('server_rejected');
      e3.code = 'server_rejected';
      e3.status = r.status;
      throw e3;
    }
    return { ok: true };
  }

  async function unsubscribe() {
    if (!isSupported()) return { ok: true, removed: 0 };
    var reg = await _getRegistration();
    var sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true, removed: 0 };
    /* Tell the server first so a network failure doesn't leave us with
       an active SW subscription the user thinks they cancelled. */
    try {
      await fetch(PROXY_BASE + '/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } catch (e) {
      /* server might be unreachable; the unsubscribe below still
         frees up the SW slot client-side */
    }
    var ok = await sub.unsubscribe();
    return { ok: ok, removed: ok ? 1 : 0 };
  }

  async function sendTest() {
    var r = await fetch(PROXY_BASE + '/api/push/test', { method: 'POST' });
    return r.ok ? r.json() : { ok: false, status: r.status };
  }

  /* ─── Per-category preferences ─────────────────────────────────
     Four toggles the user controls from the Alerts page; defaults
     are all-on so a fresh subscribe receives every category until
     the user opts out. We store both client-side (localStorage —
     the source of truth, used by shouldRelay below) and server-side
     (so a user who subscribes from a second device inherits their
     last toggle state). */
  var PREFS_STORAGE = 'nxPushPrefs';
  var DEFAULT_PREFS = { whales: true, scanTrades: true, top3: true, news: true };

  function getPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_STORAGE);
      if (raw) {
        var parsed = JSON.parse(raw);
        return Object.assign({}, DEFAULT_PREFS, parsed || {});
      }
    } catch (e) {
      /* fall through to defaults */
    }
    return Object.assign({}, DEFAULT_PREFS);
  }

  async function setPrefs(next) {
    var merged = Object.assign({}, getPrefs(), next || {});
    try {
      localStorage.setItem(PREFS_STORAGE, JSON.stringify(merged));
    } catch (e) {
      /* private mode — local toggle still takes effect for this tab */
    }
    /* Sync to server so a per-subscription filter can drop categories
       the user disabled, even when the trigger fires server-side. */
    try {
      if (!isSupported()) return merged;
      var reg = await _getRegistration();
      var sub = await reg.pushManager.getSubscription();
      if (!sub) return merged;
      await fetch(PROXY_BASE + '/api/push/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint, prefs: merged }),
      });
    } catch (e) {
      /* server may be unreachable — local prefs already saved */
    }
    return merged;
  }

  /* ─── Bridge from in-page notify() → server relay ──────────────
     notifications.js calls nxPush.shouldRelay({sym,type,score,extra})
     for every signal it surfaces locally. We map the legacy "type"
     vocabulary onto our four categories, drop anything the user
     disabled, and forward the rest to /api/push/relay. The server
     decides which subscriptions to fan out to (its own per-sub prefs
     filter applies on top, so a user's most recent toggles always
     win). */
  var TYPE_TO_CATEGORY = {
    whale: 'whales',
    ultra: 'scanTrades' /* "ULTRA Signal!" is the scanner's strongest verdict */,
    top3: 'top3',
    news: 'news',
  };

  function _composePayload(p) {
    var sym = String(p.sym || '').toUpperCase();
    var type = p.type;
    var score = p.score;
    if (type === 'whale') {
      return {
        title: '🐋 ' + sym + ' — تجميع حيتان',
        body: 'تم رصد موجة شراء قوية',
        tag: 'whale-' + sym,
        url: '/?coin=' + sym,
      };
    }
    if (type === 'ultra') {
      return {
        title: '⭐ ' + sym + ' — صفقة جديدة',
        body: 'سكور: ' + (score || '?') + ' — ادخل الآن',
        tag: 'scan-' + sym,
        url: '/?coin=' + sym,
      };
    }
    if (type === 'top3') {
      return {
        title: '🎯 أفضل 3 صفقات تحدّثت',
        body: sym ? sym + ' دخل القائمة' : 'القائمة الجديدة',
        tag: 'top3',
        url: '/',
      };
    }
    if (type === 'news') {
      return {
        title: '📰 خبر مهم',
        body: (p.extra && p.extra.title) || sym || 'تم نشر خبر جديد',
        tag: 'news',
        url: '/?news=1',
      };
    }
    return null;
  }

  async function shouldRelay(p) {
    if (!p || !p.type) return;
    var category = TYPE_TO_CATEGORY[p.type];
    if (!category) return;
    var prefs = getPrefs();
    if (prefs[category] === false) return;
    var payload = _composePayload(p);
    if (!payload) return;
    payload.type = category;
    try {
      await fetch(PROXY_BASE + '/api/push/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      /* relay is best-effort */
    }
  }

  /* ─── Custom alerts ─────────────────────────────────────────────
     Thin proxies over /api/alerts/* — the server stores rules per
     subscription endpoint so a user who unsubscribes leaves no
     dangling alerts behind. The PWA renders the list inline on the
     alerts page; createAlert / deleteAlert refresh it. */

  async function _currentEndpoint() {
    if (!isSupported()) return null;
    try {
      const reg = await _getRegistration();
      const sub = await reg.pushManager.getSubscription();
      return sub ? sub.endpoint : null;
    } catch (e) {
      return null;
    }
  }

  async function listAlerts() {
    const endpoint = await _currentEndpoint();
    if (!endpoint) return { alerts: [], max: 0 };
    const r = await fetch(PROXY_BASE + '/api/alerts?endpoint=' + encodeURIComponent(endpoint));
    if (!r.ok) return { alerts: [], max: 0 };
    return r.json();
  }

  async function createAlert(spec) {
    const endpoint = await _currentEndpoint();
    if (!endpoint) {
      const e = new Error('not_subscribed');
      e.code = 'not_subscribed';
      throw e;
    }
    const r = await fetch(PROXY_BASE + '/api/alerts/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: endpoint,
        sym: spec.sym,
        rule: spec.rule,
        repeat: !!spec.repeat,
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const e = new Error(body.error || 'create_failed');
      e.code = body.error || 'create_failed';
      throw e;
    }
    return r.json();
  }

  async function deleteAlert(id) {
    const endpoint = await _currentEndpoint();
    if (!endpoint) return { ok: false };
    const r = await fetch(
      PROXY_BASE +
        '/api/alerts/' +
        encodeURIComponent(id) +
        '?endpoint=' +
        encodeURIComponent(endpoint),
      { method: 'DELETE' }
    );
    return r.ok ? r.json() : { ok: false, status: r.status };
  }

  /* Expose under a single global so other modules and inline UI
     handlers can call nxPush.subscribe() / nxPush.unsubscribe() /
     nxPush.getStatus() / nxPush.getPrefs() / nxPush.setPrefs() /
     nxPush.shouldRelay() / nxPush.listAlerts / .createAlert /
     .deleteAlert without dragging the rest of the file in. */
  if (typeof window !== 'undefined') {
    window.nxPush = {
      isSupported: isSupported,
      getStatus: getStatus,
      subscribe: subscribe,
      unsubscribe: unsubscribe,
      sendTest: sendTest,
      getPrefs: getPrefs,
      setPrefs: setPrefs,
      shouldRelay: shouldRelay,
      listAlerts: listAlerts,
      createAlert: createAlert,
      deleteAlert: deleteAlert,
    };
  }
})();
