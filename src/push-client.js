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

  /* Expose under a single global so other modules and inline UI
     handlers can call nxPush.subscribe() / nxPush.unsubscribe() /
     nxPush.getStatus() without dragging the rest of the file in. */
  if (typeof window !== 'undefined') {
    window.nxPush = {
      isSupported: isSupported,
      getStatus: getStatus,
      subscribe: subscribe,
      unsubscribe: unsubscribe,
      sendTest: sendTest,
    };
  }
})();
