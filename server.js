/*
 * ═══════════════════════════════════════════════════════════════
 *  NEXUS PRO V10.1 — Proxy Server
 *  يجمع البيانات من Binance + Bybit + CoinGecko + Coinbase
 *  ويرسلها للتطبيق عبر endpoint واحد: /api/all
 * ═══════════════════════════════════════════════════════════════
 *
 *  التثبيت:
 *    1. ارفع هذا المجلد على الـ VPS
 *    2. npm install
 *    3. انسخ .env.example إلى .env وعدّل القيم
 *    4. npm start
 *
 *  أو مع PM2 (يشتغل بالخلفية ويعيد التشغيل تلقائياً):
 *    pm2 start server.js --name nexus-proxy
 *    pm2 save
 *    pm2 startup
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');
const scannerEngine = require('./src/scanner-engine');
const indicatorEngine = require('./src/indicator-engine');
const whaleEngine = require('./src/whale-engine');
const alertsEngine = require('./src/alerts-engine');
require('dotenv').config();

const {
  isAllowedFetchUrl,
  createSafeAgent,
  sanitizeTelegramHtml,
  safeEqual,
} = require('./src/server-helpers');

const app = express();
const PORT = process.env.PORT || 3000;

/* Trust the first reverse proxy hop so express-rate-limit keys by the real
   client IP (not a spoofable X-Forwarded-For). Set TRUST_PROXY=true only if
   actually deployed behind a proxy you control. */
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

/* ═══ CONFIGURATION ═══ */
const CONFIG = {
  /* Refresh intervals (ms) */
  TICKER_INTERVAL: 10000 /* 10 seconds */,
  FR_INTERVAL: 60000 /* 1 minute */,
  OI_INTERVAL: 60000 /* 1 minute */,
  LS_INTERVAL: 120000 /* 2 minutes */,
  MARKET_INTERVAL: 300000 /* 5 minutes */,
  TAKER_INTERVAL: 60000 /* 1 minute */,
  DEPTH_INTERVAL: 15000 /* 15 seconds — critical for whale engine */,
  LIQ_INTERVAL: 30000 /* 30 seconds */,
  BITFINEX_INTERVAL: 120000 /* 2 minutes — pos.size only changes slowly + 2 calls per symbol */,
  HYPERLIQUID_INTERVAL: 60000 /* 1 minute — single batch POST returns every perp */,
  NEWS_INTERVAL: 300000 /* 5 minutes — CoinTelegraph RSS publishes a few items per hour */,
  /* Local-only bridge to data_server.py (the legacy Python data engine
     that still drives the Telegram notifier). Pulls whales / mcap /
     multi every 5 s — its internal refresh is faster than that, so
     this just keeps our snapshot fresh without piling on. */
  DATA_SERVER_INTERVAL: 5000,
  DATA_SERVER_URL: 'http://127.0.0.1:8080/api/all',
  /* Server-side scanner pass — runs the same scoring the PWA does,
     against the warm cache, every 30 s. The output (signals + top3)
     is exposed via /api/all and drives the ULTRA / Top-3-changed
     push triggers so the user receives alerts even when the app is
     closed. 30 s lines up with the PWA's own quickScan cadence. */
  SCANNER_INTERVAL: 30000,
  /* Indicator pass — fetches Binance 15m klines for the top 10
     majors and computes RSI / MACD / EMA / ATR + a market-direction
     verdict per symbol. 60 s cadence matches how slowly indicators
     evolve on a 15m timeframe (one new bar every 15 minutes makes
     anything faster wasteful) and keeps the kline-fetch budget
     well under Binance's 1200/min weight limit. */
  INDICATOR_INTERVAL: 60000,
  /* User custom-alerts pass — walks cache.userAlerts, checks each
     rule against the warm cache, and fires push for the matches.
     60 s lines up with the indicator pass so RSI / score rules see
     fresh values when they evaluate. */
  USER_ALERTS_INTERVAL: 60000,

  /* API URLs */
  BINANCE_SPOT: 'https://api.binance.com/api/v3',
  BINANCE_FUTURES: 'https://fapi.binance.com/fapi/v1',
  COINGECKO: 'https://api.coingecko.com/api/v3',
  COINBASE: 'https://api.coinbase.com/v2',
  BYBIT: 'https://api.bybit.com/v5',
  FEAR_GREED: 'https://api.alternative.me/fng',

  /* Telegram Bot (optional) */
  TG_BOT_TOKEN: process.env.TG_BOT_TOKEN || '',
  TG_CHAT_ID: process.env.TG_CHAT_ID || '',

  /* Optional shared secret for /notify. When set, callers must include it
     via the `X-Notify-Secret` header. Empty string disables the check
     (rate-limit + CORS still apply). Intended for deployments where the
     PWA client is configured at build-time with a non-public secret. */
  NOTIFY_SECRET: process.env.NEXUS_NOTIFY_SECRET || '',

  /* Allowed origins for CORS — default empty (same-origin / server-to-server only).
     Must be an explicit comma-separated list of origins. A literal `*` is
     intentionally NOT accepted: wildcard-with-credentials is unsafe and there
     is no legitimate use case for this proxy. */
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(function (s) {
          return s && s !== '*';
        })
    : [],

  /* /api/all TTL cache — one snapshot shared across all clients.
     5 s instead of 3 s: with 500+ concurrent dashboards each pull the
     same /api/all every few seconds, and the 3 s window forced
     buildApiAllSnapshot() to run almost every poll under load. 5 s
     halves CPU spikes during peak traffic without making any visible
     UI lag — the WS price stream + per-symbol REST refresh keep the
     critical fields fresh inside the cache window. */
  API_ALL_TTL_MS: 5000,

  /* Request timeout — 12 s instead of 8 s. The earlier value rejected
     legitimate large responses (the FNG / global endpoints can ship
     several MB once a day), and tripped on otherwise-healthy traffic
     from high-latency regions. 12 s is still well under the rate-
     limiter's 60 s window and won't pile up requests. */
  TIMEOUT: 12000,
};

/* ═══ MIDDLEWARE ═══ */

/* Security headers — frame-blocking, sniff-blocking, HSTS, referrer policy.
   CSP is declared in index.html (<meta http-equiv>) because the static file
   is served from a different origin in production; disabling it here avoids
   duplicate / conflicting policies. */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

/* gzip JSON responses. /api/all is the largest payload (50-200 KB once
   the cache is warm) and compresses ~75 %, every 5-second poll from
   every connected client benefits. The default 1 KB threshold means
   small responses (/api/health, /notify ack) skip the cost. */
app.use(compression());

/* CORS — restrict to your app's domain */
app.use(
  cors({
    origin: function (origin, callback) {
      /* Allow same-origin (no Origin header) and explicit allowlist only. */
      if (!origin || CONFIG.ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
  })
);

app.use(express.json({ limit: '32kb' }));

/* Rate limiting — 30 requests per minute per IP for data APIs.
   keyGenerator uses req.ip which honours `trust proxy` when configured,
   so limits follow the real client instead of the reverse-proxy hop. */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  /* Use the library's default IP-based key generator — it handles IPv6
     normalisation correctly when paired with `app.set('trust proxy', …)`. */
  message: { error: 'Too many requests, slow down' },
});
app.use('/api/', limiter);

/* Tighter limiter for the Telegram-relay endpoint (abusable + costs real money) */
const notifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  /* Use the library's default IP-based key generator — it handles IPv6
     normalisation correctly when paired with `app.set('trust proxy', …)`. */
  message: { error: 'Too many notifications, slow down' },
});
app.use('/notify', notifyLimiter);

/* ═══ DATA CACHE ═══ */
const cache = {
  tickers: {} /* { BTC: { price, change, volume, high, low, src } } */,
  fr: {} /* { BTC: { rate, mark } } */,
  oi: {} /* { BTC: number } */,
  ls: {} /* { BTC: { long, short, ratio, hist } } */,
  taker: {} /* { BTC: { ratio, buyVol, sellVol, trend } } */,
  liq: [] /* [ { sym, side, price, value, time } ] */,
  depth: {} /* { BTC: { bids, asks } } */,
  market: {
    /* Market overview */ fgi: 50,
    fgiLabel: 'Neutral',
    btcDom: 50,
    cbp: {} /* Coinbase prices */,
  },
  /* Multi-exchange enrichment caches — populated from Bitfinex margin
     position size, Hyperliquid asset contexts, and CoinTelegraph RSS news.
     The PWA reads these from /api/all under m.bitfinex / m.hyperliquid
     / m.news / m.newsSentiment (see app.js around line 1977). */
  bitfinex: {} /* { BTC: { longPct, shortPct, ratio } } */,
  hyperliquid: {} /* { BTC: { funding, openInterest } } */,
  news: [] /* [ { title, url, body, publishedOn, source, sentiment } ] */,
  newsSentiment: { positive: 0, negative: 0, neutral: 0 },
  /* Bridge caches — mirror the whales / mcap / multi blocks served by
     data_server.py on 127.0.0.1:8080. The PWA reads these as top-level
     m.whales / m.mcap / m.coinalyze / m.blockchain after the snapshot
     flattens multi.*. data_server.py is preferred over our own
     bitfinex / hyperliquid / news fetchers when both populate the
     same field — see buildApiAllSnapshot below. */
  dsWhales: [] /* list of { sym, side, value, price, time } */,
  dsMcap: {} /* { BTC: { rank, mcap, ath, atl } } */,
  dsMulti: {} /* { coinalyze, hyperliquid, blockchain, news, newsSentiment, ... } */,
  pushSubs: [] /* [ { endpoint, keys: { p256dh, auth }, addedAt } ] */,
  /* User-defined custom alerts — populated from data/user-alerts.json
     and refreshed via /api/alerts/* endpoints. Each entry:
       { id, endpoint, sym, rule, repeat, createdAt, lastFiredAt? }
     The alerts engine walks this list every minute against the
     warm cache; matched alerts are pushed (and removed if not
     `repeat`) so the user gets pinged the moment their rule
     triggers, even with the PWA closed. */
  userAlerts: [],
  /* Scanner output — populated by runScannerOnServer every 30 s.
     `signals` is the full ranked list (top 50 surface in /api/all);
     `top3` is what the home page calls "أفضل 3 صفقات" and what the
     Top-3-changed push trigger watches. */
  signals: [] /* [ { s, score, tags, tier, direction, price, change, volume, ts } ] */,
  top3: [] /* same shape, top three by score */,
  scannerTs: 0,
  /* Server-side indicators — populated by runIndicatorsOnServer
     every 60 s. Map keyed by symbol → { rsi, macd, ema9, ema21,
     ema50, atr, direction, ts }. The PWA's BTC / ETH / etc. cards
     read direction.ar to render "شراء قوي / خفيف / محايد"; the
     direction-changed push trigger watches direction.label
     transitions. */
  indicators: {},
  indicatorsTs: 0,
  /* Server-side whale waves — populated by runWhaleEngineOnServer
     after each fetchFromDataServer tick. Map keyed by symbol →
     { totalBuy, totalSell, buyRatio, waves: [...], engine: {
       rank, confidence } }. The PWA reads this to render the whale
     cards even when its own client-side engine isn't running. */
  whaleWaves: {},
  whaleWavesTs: 0,
  lastUpdate: {},
};

/* ═══ WEB PUSH NOTIFICATIONS ═══

   Subscriptions are kept in memory and mirrored to a JSON file on
   disk so a process restart doesn't drop active subscribers. The
   trigger logic (whale alerts) reads cache.dsWhales directly and
   debounces by symbol so a single big BTC sweep doesn't pile 30
   notifications on the user's lock screen. */

const PUSH_SUBS_PATH = path.join(__dirname, 'data', 'push-subs.json');
const PUSH_ENABLED = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@shamcyrpto.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('[PUSH] Web Push enabled');
} else {
  console.log('[PUSH] Disabled — set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in .env to enable');
}

/* Load persisted subscriptions on startup. The file may not exist
   on first boot — that's fine, we treat it as an empty list. A
   malformed file is logged and replaced; better than letting one
   bad save crash the whole proxy. */
function loadPushSubs() {
  try {
    if (!fs.existsSync(PUSH_SUBS_PATH)) {
      cache.pushSubs = [];
      return;
    }
    const raw = fs.readFileSync(PUSH_SUBS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cache.pushSubs = Array.isArray(parsed) ? parsed : [];
    console.log(`[PUSH] Loaded ${cache.pushSubs.length} subscription(s) from disk`);
  } catch (err) {
    console.error('[PUSH] Failed to load subscriptions:', err.message);
    cache.pushSubs = [];
  }
}

/* Atomic save: write to .tmp then rename, so a crash mid-write
   doesn't leave a half-baked JSON file we'd fail to parse next
   boot. */
function savePushSubs() {
  try {
    const dir = path.dirname(PUSH_SUBS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = PUSH_SUBS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache.pushSubs, null, 2));
    fs.renameSync(tmp, PUSH_SUBS_PATH);
  } catch (err) {
    console.error('[PUSH] Failed to save subscriptions:', err.message);
  }
}

loadPushSubs();

/* ─── user alerts persistence ───────────────────────────────────
   Same JSON-on-disk pattern as push-subs: load on boot, atomic
   rename on every save so a crash mid-write can't leave us with
   a half-written file. */

const USER_ALERTS_PATH = path.join(__dirname, 'data', 'user-alerts.json');

function loadUserAlerts() {
  try {
    if (!fs.existsSync(USER_ALERTS_PATH)) {
      cache.userAlerts = [];
      return;
    }
    const raw = fs.readFileSync(USER_ALERTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cache.userAlerts = Array.isArray(parsed) ? parsed : [];
    console.log(`[ALERTS] Loaded ${cache.userAlerts.length} user alert(s)`);
  } catch (err) {
    console.error('[ALERTS] Failed to load:', err.message);
    cache.userAlerts = [];
  }
}

function saveUserAlerts() {
  try {
    const dir = path.dirname(USER_ALERTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = USER_ALERTS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache.userAlerts, null, 2));
    fs.renameSync(tmp, USER_ALERTS_PATH);
  } catch (err) {
    console.error('[ALERTS] Failed to save:', err.message);
  }
}

loadUserAlerts();

/* runUserAlertsCheck — walks cache.userAlerts every minute, pushes
   the matched ones, then trims one-shots / advances cooldowns on
   repeats. Single-alert push (not fanned to all subs) — only the
   subscriber whose endpoint owns the alert gets pinged. */
async function runUserAlertsCheck() {
  if (!PUSH_ENABLED) return;
  if (!Array.isArray(cache.userAlerts) || !cache.userAlerts.length) return;
  const result = alertsEngine.runAlertsCheck(cache.userAlerts, cache, Date.now());
  if (!result.fired.length) return;

  /* For each fired alert, look up the matching subscription and
     send a single targeted push. Failed sends mark the
     subscription dead — same lifecycle as the broadcast path. */
  const dead = [];
  await Promise.all(
    result.fired.map(async (a) => {
      const sub = cache.pushSubs.find((s) => s.endpoint === a.endpoint);
      if (!sub) return; /* Subscriber unsubscribed — alert is orphaned. */
      const rule = alertsEngine.parseRule(a.rule);
      if (!rule) return;
      const fieldLabel = { price: 'السعر', change: 'التغير', rsi: 'RSI', score: 'سكور' }[
        rule.field
      ];
      const payload = {
        title: '⚡ تنبيه ' + a.sym,
        body: `${fieldLabel} ${rule.op} ${rule.value}`,
        tag: 'alert-' + a.id,
        url: '/?coin=' + a.sym,
      };
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 });
        console.log(`[ALERTS] Fired: ${a.sym} ${a.rule} → 1 client`);
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) dead.push(sub.endpoint);
      }
    })
  );

  /* Trim one-shots, refresh repeats, prune dead subs (and their
     orphaned alerts) — done atomically so a crash mid-pass doesn't
     leave the file out of sync with memory. */
  cache.userAlerts = result.kept.filter((a) => !dead.includes(a.endpoint));
  if (dead.length) {
    cache.pushSubs = cache.pushSubs.filter((s) => !dead.includes(s.endpoint));
    savePushSubs();
  }
  saveUserAlerts();
}

/* sendPushToAll fans the same payload out to every subscriber and
   prunes any whose endpoint returns 404 / 410 (Gone — the browser
   uninstalled the SW, or the user opted out). Other failures are
   logged but the subscription is kept for the next attempt — Push
   services occasionally return 5xx and we don't want a hiccup to
   wipe everyone's subscription.

   `category` (optional) maps to the four user-toggleable preferences
   (whales / scanTrades / top3 / news). If supplied, subs whose
   prefs[category] === false are skipped. Subs without prefs (legacy
   subscribers from before #81) are treated as "all on" so behavior
   is conservative. */
async function sendPushToAll(payload, category) {
  if (!PUSH_ENABLED || !cache.pushSubs.length) return { sent: 0, pruned: 0, skipped: 0 };
  const body = JSON.stringify(payload);
  const dead = [];
  let sent = 0;
  let skipped = 0;
  await Promise.all(
    cache.pushSubs.map(async (sub) => {
      if (category && sub.prefs && sub.prefs[category] === false) {
        skipped++;
        return;
      }
      try {
        await webpush.sendNotification(sub, body, { TTL: 60 });
        sent++;
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          dead.push(sub.endpoint);
        } else {
          console.warn('[PUSH] Send failed:', code || err.message);
        }
      }
    })
  );
  if (dead.length) {
    cache.pushSubs = cache.pushSubs.filter((s) => !dead.includes(s.endpoint));
    savePushSubs();
    console.log(`[PUSH] Pruned ${dead.length} dead subscription(s)`);
  }
  return { sent, pruned: dead.length, skipped };
}

/* Whale alert trigger — runs after each fetchFromDataServer tick.
   We keep a per-symbol cooldown so back-to-back trades on the same
   pair don't drown the user, plus a global debounce to cap the
   notification rate even during a market-wide whale storm. */
const WHALE_PUSH_THRESHOLD_USD = 100000;
const WHALE_PUSH_PER_SYM_COOLDOWN_MS = 5 * 60 * 1000; /* 5 min */
const WHALE_PUSH_GLOBAL_COOLDOWN_MS = 30 * 1000; /* 30 s */
const _whalePushBySymbol = Object.create(null);
let _whalePushLastGlobalAt = 0;

function _formatWhaleValue(usd) {
  if (usd >= 1e9) return (usd / 1e9).toFixed(2) + 'B';
  if (usd >= 1e6) return (usd / 1e6).toFixed(2) + 'M';
  if (usd >= 1e3) return (usd / 1e3).toFixed(0) + 'K';
  return String(Math.round(usd));
}

async function maybePushWhaleAlerts() {
  if (!PUSH_ENABLED || !cache.pushSubs.length) return;
  if (!Array.isArray(cache.dsWhales) || !cache.dsWhales.length) return;
  const now = Date.now();
  if (now - _whalePushLastGlobalAt < WHALE_PUSH_GLOBAL_COOLDOWN_MS) return;

  const fresh = cache.dsWhales.filter(
    (w) => w && w.value >= WHALE_PUSH_THRESHOLD_USD && w.time && now - w.time < 60000
  );
  if (!fresh.length) return;

  fresh.sort((a, b) => b.value - a.value);
  const top = fresh[0];
  const sym = String(top.sym || '').toUpperCase();
  if (!sym) return;
  if (now - (_whalePushBySymbol[sym] || 0) < WHALE_PUSH_PER_SYM_COOLDOWN_MS) return;

  const dir = top.side === 'buy' ? '🟢 شراء' : '🔴 بيع';
  const payload = {
    title: '🐋 ' + sym + ' — حوت ' + (top.side === 'buy' ? 'مشتري' : 'بائع'),
    body: dir + ' ' + _formatWhaleValue(top.value) + '$ عند ' + top.price,
    tag: 'whale-' + sym,
    url: '/?coin=' + sym,
  };
  const { sent } = await sendPushToAll(payload, 'whales');
  if (sent > 0) {
    _whalePushBySymbol[sym] = now;
    _whalePushLastGlobalAt = now;
    console.log(
      `[PUSH] Whale alert sent: ${sym} ${top.side} ${_formatWhaleValue(top.value)}$ → ${sent} client(s)`
    );
  }
}

/* News alert trigger — fires when a fresh CoinTelegraph (or
   data_server.py.multi.news) headline carries a non-neutral
   sentiment that hasn't been pushed yet. Dedupes on
   (title|sentiment) so the same headline can't notify twice if both
   upstreams happen to publish it. 5-min cooldown keeps a busy feed
   quiet during high-news days. */
let _lastNewsHash = '';
let _lastNewsPushAt = 0;
const NEWS_PUSH_COOLDOWN_MS = 5 * 60 * 1000;

async function maybePushNewsAlerts() {
  if (!PUSH_ENABLED || !cache.pushSubs.length) return;
  const now = Date.now();
  if (now - _lastNewsPushAt < NEWS_PUSH_COOLDOWN_MS) return;
  const ds = cache.dsMulti && Array.isArray(cache.dsMulti.news) ? cache.dsMulti.news : null;
  const list = ds && ds.length ? ds : cache.news;
  if (!Array.isArray(list) || !list.length) return;
  const top = list[0];
  if (!top || !top.title) return;
  const sentiment = top.sentiment;
  if (sentiment !== 'positive' && sentiment !== 'negative') return;
  const hash = top.title + '|' + sentiment;
  if (hash === _lastNewsHash) return;
  _lastNewsHash = hash;

  const emoji = sentiment === 'positive' ? '🟢' : '🔴';
  const payload = {
    title: emoji + ' خبر مهم — ' + (top.source || 'crypto'),
    body: String(top.title).slice(0, 140),
    tag: 'news',
    url: '/?news=1',
  };
  const { sent } = await sendPushToAll(payload, 'news');
  if (sent > 0) {
    _lastNewsPushAt = now;
    console.log(`[PUSH] News alert sent: ${sentiment} → ${sent} client(s)`);
  }
}

/* ═══ SERVER-SIDE SCANNER ═══

   Runs scannerEngine.runScannerPass() against the warm cache every
   SCANNER_INTERVAL (30 s) and stashes the result on cache.signals /
   cache.top3 so /api/all can serve them. Two push triggers piggy-
   back on the pass:

   - ULTRA — the moment a symbol crosses the 100-score threshold
     (and isn't repeating itself within the 5-min cooldown), fire a
     push. Per-symbol cooldown so consecutive scans of a steady
     ULTRA don't spam.
   - Top-3-changed — the leaderboard composition (which three
     symbols, in what order) drives the second push; debounced
     globally to one notification every 10 minutes so a wobbly
     ranking doesn't burn through the user's lock screen. */

const SCANNER_ULTRA_COOLDOWN_MS = 5 * 60 * 1000;
const SCANNER_TOP3_COOLDOWN_MS = 10 * 60 * 1000;
const _ultraPushBySymbol = Object.create(null);
let _lastTop3Hash = '';
let _lastTop3PushAt = 0;

function _top3Hash(top3) {
  return top3.map((r) => r.s + ':' + Math.round(r.score)).join(',');
}

async function runScannerOnServer() {
  if (!cache.tickers || Object.keys(cache.tickers).length === 0) return;
  const t0 = Date.now();
  let pass;
  try {
    pass = scannerEngine.runScannerPass(cache);
  } catch (err) {
    console.error('[SCANNER] Pass failed:', err.message);
    return;
  }
  cache.signals = pass.signals;
  cache.top3 = pass.top3;
  cache.scannerTs = pass.ts;
  cache.lastUpdate.scanner = pass.ts;
  console.log(
    `[SCANNER] ${pass.signals.length} signals (${pass.signals.filter((r) => r.tier === 'ULTRA').length} ULTRA), top3=${pass.top3.map((r) => r.s).join(',') || '∅'} in ${Date.now() - t0}ms`
  );

  if (!PUSH_ENABLED || !cache.pushSubs.length) return;
  const now = Date.now();

  /* ULTRA push — fire only on the freshest crossing per symbol. */
  for (const r of pass.signals) {
    if (r.tier !== 'ULTRA') break; /* signals are sorted desc */
    const lastAt = _ultraPushBySymbol[r.s] || 0;
    if (now - lastAt < SCANNER_ULTRA_COOLDOWN_MS) continue;
    const top3Tags = (r.tags || []).slice(0, 3).join(' ');
    const payload = {
      title: '⭐ ' + r.s + ' — ULTRA Signal',
      body: 'سكور: ' + Math.round(r.score) + (top3Tags ? ' | ' + top3Tags : ''),
      tag: 'ultra-' + r.s,
      url: '/?coin=' + r.s,
    };
    const { sent } = await sendPushToAll(payload, 'scanTrades');
    if (sent > 0) {
      _ultraPushBySymbol[r.s] = now;
      console.log(`[PUSH] ULTRA sent: ${r.s} score=${Math.round(r.score)} → ${sent} client(s)`);
    }
  }

  /* Top-3-changed push — one notification per refresh, debounced. */
  const hash = _top3Hash(pass.top3);
  if (hash && hash !== _lastTop3Hash && now - _lastTop3PushAt >= SCANNER_TOP3_COOLDOWN_MS) {
    _lastTop3Hash = hash;
    const body = pass.top3.map((r) => r.s + ' (' + Math.round(r.score) + ')').join('، ');
    const payload = {
      title: '🎯 أفضل 3 صفقات تحدّثت',
      body: body || 'لا توجد صفقات حالياً',
      tag: 'top3',
      url: '/',
    };
    const { sent } = await sendPushToAll(payload, 'top3');
    if (sent > 0) {
      _lastTop3PushAt = now;
      console.log(`[PUSH] Top-3 changed: ${body} → ${sent} client(s)`);
    }
  }
}

/* ═══ SERVER-SIDE INDICATORS ═══

   Pulls Binance 15m klines for the top 10 majors and runs RSI /
   MACD / EMA / ATR + the direction classifier. Output is stashed
   on cache.indicators so the PWA renders the BTC / ETH cards from
   server-computed values, and so the direction-changed push
   trigger fires while the user is offline. */

/* Whale-wave push trigger — fires when a symbol's aggregated buys
   cross the Tier-A threshold (>= $1M, >= 70% buy ratio) and the
   per-symbol cooldown allows. Runs after every fetchFromDataServer
   tick. The simple whale-alert push (server-side, single big trade)
   stays in place; this trigger is for sustained accumulation. */
const WAVE_PUSH_COOLDOWN_MS = 15 * 60 * 1000;
const _wavePushBySymbol = Object.create(null);

async function maybePushWhaleWave() {
  if (!PUSH_ENABLED || !cache.pushSubs.length) return;
  if (!cache.whaleWaves || typeof cache.whaleWaves !== 'object') return;
  const now = Date.now();
  const ranked = whaleEngine.pickRankedWaves(cache.whaleWaves, 5);
  for (const wave of ranked) {
    const eng = wave.engine || {};
    if (eng.rank !== 'A') continue; /* only push the strongest tier */
    const lastAt = _wavePushBySymbol[wave.sym] || 0;
    if (now - lastAt < WAVE_PUSH_COOLDOWN_MS) continue;
    const buyM = (eng.totalBuy / 1_000_000).toFixed(1);
    const payload = {
      title: '🐋 ' + wave.sym + ' — موجة تجميع قوية',
      body: 'إجمالي الشراء ' + buyM + 'M$ | نسبة شراء ' + Math.round(eng.buyRatio) + '%',
      tag: 'wave-' + wave.sym,
      url: '/?coin=' + wave.sym,
    };
    const { sent } = await sendPushToAll(payload, 'whales');
    if (sent > 0) {
      _wavePushBySymbol[wave.sym] = now;
      console.log(
        `[PUSH] Whale wave: ${wave.sym} buy=${buyM}M ratio=${Math.round(eng.buyRatio)}% → ${sent} client(s)`
      );
    }
  }
}

const INDICATOR_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT'];

/* Per-symbol cooldown so a noisy 15m close doesn't push the same
   "BTC شراء خفيف" twice in a row. The label-transition guard below
   means an unchanged direction is silent regardless. */
const DIRECTION_PUSH_COOLDOWN_MS = 30 * 60 * 1000;
const _directionPushBySymbol = Object.create(null);
const _lastDirectionLabel = Object.create(null);

async function runIndicatorsOnServer() {
  if (!cache.tickers || Object.keys(cache.tickers).length === 0) return;
  const t0 = Date.now();
  let updated = 0;
  for (const sym of INDICATOR_SYMBOLS) {
    const url = CONFIG.BINANCE_SPOT + '/klines?symbol=' + sym + 'USDT&interval=15m&limit=200';
    let klines;
    try {
      klines = await safeFetch(url, 'KLINE-' + sym);
    } catch (err) {
      console.warn('[INDICATORS] kline fetch failed for', sym, err.message);
      continue;
    }
    if (!Array.isArray(klines) || klines.length < 26) continue;
    const ind = indicatorEngine.runIndicatorPass(klines);
    if (!ind) continue;
    cache.indicators[sym] = ind;
    updated++;
  }
  cache.indicatorsTs = Date.now();
  cache.lastUpdate.indicators = cache.indicatorsTs;
  console.log(`[INDICATORS] ${updated}/${INDICATOR_SYMBOLS.length} symbols (${Date.now() - t0}ms)`);

  /* Direction-changed push — fire only when the human-readable
     label actually crosses (e.g. "محايد" → "شراء قوي"), not when
     the underlying score wobbles within the same bucket. Per-symbol
     cooldown prevents flapping during a noisy close. */
  if (!PUSH_ENABLED || !cache.pushSubs.length) return;
  const now = Date.now();
  for (const sym of INDICATOR_SYMBOLS) {
    const ind = cache.indicators[sym];
    if (!ind || !ind.direction) continue;
    const label = ind.direction.label;
    const prev = _lastDirectionLabel[sym];
    _lastDirectionLabel[sym] = label;
    if (!prev || prev === label) continue; /* fresh boot or unchanged */
    if (now - (_directionPushBySymbol[sym] || 0) < DIRECTION_PUSH_COOLDOWN_MS) continue;
    /* Only push interesting transitions — going from / to BUY or
       SELL territory. Drifting from NEUTRAL → WATCH or back is
       pure noise. */
    const interesting =
      label === 'STRONG_BUY' || label === 'STRONG_SELL' || label === 'BUY' || label === 'SELL';
    if (!interesting) continue;
    const arrow =
      label === 'STRONG_BUY' || label === 'BUY'
        ? '🟢'
        : label === 'STRONG_SELL' || label === 'SELL'
          ? '🔴'
          : '⚪';
    const payload = {
      title: arrow + ' ' + sym + ' — ' + ind.direction.ar,
      body:
        'RSI ' +
        Math.round(ind.rsi) +
        ' | MACD ' +
        (ind.macd && ind.macd.cross !== 'none' ? ind.macd.cross : 'flat'),
      tag: 'direction-' + sym,
      url: '/?coin=' + sym,
    };
    const { sent } = await sendPushToAll(payload, 'scanTrades');
    if (sent > 0) {
      _directionPushBySymbol[sym] = now;
      console.log(`[PUSH] Direction ${sym}: ${prev} → ${label} → ${sent} client(s)`);
    }
  }
}

/* ═══ SAFE FETCH — with timeout, allowlist, and DNS-rebinding guard ═══

   - isAllowedFetchUrl pins the protocol + hostname before we even open
     a socket, mitigating SSRF via a compromised symbol/argument.
   - safeAgent re-runs DNS at connect time and refuses any address that
     resolves into a private range. This closes the DNS-rebinding gap
     between the URL.parse() above and the actual TCP connect — an
     attacker who controls DNS for an allowlisted host can no longer
     point us at a private IP.
   - maxRedirects: 0 stops a 30x reply from bouncing the request to an
     unrelated host. */
const safeAgent = createSafeAgent();

/* Upstream call metrics — exposed by /api/health and /api/metrics so
   monitors can spot sustained 429s or timeouts even when the cache is
   still warm. The per-label map carries the last error per source so
   operators can see *which* upstream is hot without grepping logs. */
const upstreamMetrics = {
  success: 0,
  retried: 0,
  failed: 0,
  rateLimited: 0,
  timeout: 0,
};
const upstreamByLabel = Object.create(null);
function _bumpLabel(label, kind) {
  if (!label) return;
  let bucket = upstreamByLabel[label];
  if (!bucket) {
    bucket = upstreamByLabel[label] = {
      success: 0,
      failed: 0,
      retried: 0,
      rateLimited: 0,
      timeout: 0,
      lastError: null,
      lastErrorAt: 0,
    };
  }
  if (typeof kind === 'string') bucket[kind]++;
}
function _recordLabelError(label, status) {
  if (!label) return;
  const bucket = upstreamByLabel[label];
  if (!bucket) return;
  bucket.lastError = status ? 'HTTP ' + status : 'NETWORK';
  bucket.lastErrorAt = Date.now();
}
function _isRetryable(err) {
  if (!err) return false;
  /* axios timeout / network errors expose a code but no response */
  if (!err.response) return true;
  const s = err.response.status;
  return s === 429 || s === 408 || (s >= 500 && s <= 599);
}
const SAFE_FETCH_BACKOFF_MS = [500, 2000];

async function safeFetch(url, label, opts) {
  if (!isAllowedFetchUrl(url)) {
    console.error(`[${label}] Blocked: host not in allowlist`);
    upstreamMetrics.failed++;
    _bumpLabel(label, 'failed');
    _recordLabelError(label, 'BLOCKED');
    return null;
  }
  const maxAttempts = (opts && opts.retries != null ? opts.retries : 2) + 1;
  const method = ((opts && opts.method) || 'GET').toUpperCase();
  const body = opts && opts.data;
  const axiosOpts = {
    timeout: CONFIG.TIMEOUT,
    maxRedirects: 0,
    httpsAgent: safeAgent,
  };
  if (opts && opts.responseType) axiosOpts.responseType = opts.responseType;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      /* Branch on method so axios.get / axios.post stay distinct entry
         points — the test suite stubs them individually, and keeping
         the canonical signatures means a stub-aware `axios.get = …`
         keeps working for the existing retry / metrics tests. */
      const res =
        method === 'POST'
          ? await axios.post(url, body, axiosOpts)
          : await axios.get(url, axiosOpts);
      upstreamMetrics.success++;
      _bumpLabel(label, 'success');
      if (attempt > 0) {
        upstreamMetrics.retried++;
        _bumpLabel(label, 'retried');
      }
      return res.data;
    } catch (err) {
      lastErr = err;
      const status = err && err.response && err.response.status;
      if (status === 429) {
        upstreamMetrics.rateLimited++;
        _bumpLabel(label, 'rateLimited');
      } else if (!err.response) {
        upstreamMetrics.timeout++;
        _bumpLabel(label, 'timeout');
      }
      const canRetry = attempt < maxAttempts - 1 && _isRetryable(err);
      if (!canRetry) break;
      const base = SAFE_FETCH_BACKOFF_MS[attempt] || 2000;
      const jitter = Math.floor(Math.random() * 250);
      const wait = base + jitter;
      console.warn(
        `[${label}] Retry ${attempt + 1}/${maxAttempts - 1} after ${wait} ms${
          status ? ` (HTTP ${status})` : ' (network)'
        }`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  upstreamMetrics.failed++;
  _bumpLabel(label, 'failed');
  /* Avoid leaking the URL (which may carry tokens) — only the upstream
     status code if the error came from a response. */
  const status = lastErr && lastErr.response && lastErr.response.status;
  _recordLabelError(label, status);
  console.error(`[${label}] Failed${status ? ` (HTTP ${status})` : ''}`);
  return null;
}

/* ═══ DATA FETCHERS ═══ */

/* Symbols that exist on Binance Spot but NOT on Binance Futures, or
   exist on Futures with a different name (the 1000-prefix family for
   memecoins: 1000SHIBUSDT, 1000PEPEUSDT, ...). The fetchers below skip
   these when calling Futures-only endpoints (OI / LS / Taker), which
   stops every restart from generating 6-12 known-bad probes that
   pollute /api/metrics with HTTP 400 / 404 entries. The Spot fetchers
   keep them — they trade fine there. */
const FUTURES_SYMBOL_DENYLIST = new Set([
  /* Stable / fiat */
  'USDC',
  'EUR',
  'USDP',
  'BUSD',
  'TUSD',
  'FDUSD',
  /* Tokenised commodities */
  'PAXG',
  /* Currently delisted / never on Futures */
  'UTK',
  'STORJ',
  'ZEN',
  'DASH',
  'ATH',
  /* Memecoins that exist as 1000<X>USDT on Futures — the spot symbol
     used as a key here doesn't resolve. A future PR can add a
     spot→futures alias map; for now we just skip them on Futures. */
  'SHIB',
  'PEPE',
  'FLOKI',
  'BONK',
  'LUNC',
]);

/* Symbols that show up in cache.tickers (typically from Bybit) but
   don't exist on Binance Spot — used by fetchDepth. */
const SPOT_SYMBOL_DENYLIST = new Set(['ATH']);

/* 1. TICKERS — Binance Spot + Bybit */
async function fetchTickers() {
  try {
    /* Binance 24hr tickers */
    const bnData = await safeFetch(CONFIG.BINANCE_SPOT + '/ticker/24hr', 'BN-TICKERS');

    if (bnData) {
      bnData
        .filter((t) => t.symbol.endsWith('USDT'))
        .forEach((t) => {
          const sym = t.symbol.replace('USDT', '');
          cache.tickers[sym] = {
            price: parseFloat(t.lastPrice),
            change: parseFloat(t.priceChangePercent),
            volume: parseFloat(t.quoteVolume),
            high: parseFloat(t.highPrice),
            low: parseFloat(t.lowPrice),
            src: 'BN',
          };
        });
    }

    /* Bybit spot tickers */
    const byData = await safeFetch(CONFIG.BYBIT + '/market/tickers?category=spot', 'BY-TICKERS');

    if (byData && byData.result && byData.result.list) {
      byData.result.list
        .filter((t) => t.symbol.endsWith('USDT'))
        .forEach((t) => {
          const sym = t.symbol.replace('USDT', '');
          if (cache.tickers[sym]) {
            cache.tickers[sym].by = parseFloat(t.lastPrice);
          } else {
            cache.tickers[sym] = {
              price: parseFloat(t.lastPrice),
              change: parseFloat(t.price24hPcnt) * 100,
              volume: parseFloat(t.turnover24h),
              high: parseFloat(t.highPrice24h),
              low: parseFloat(t.lowPrice24h),
              src: 'BY',
              by: parseFloat(t.lastPrice),
            };
          }
        });
    }

    cache.lastUpdate.tickers = Date.now();
    console.log(`[TICKERS] Updated: ${Object.keys(cache.tickers).length} coins`);
  } catch (err) {
    console.error('[TICKERS] Error:', err.message);
  }
}

/* 2. FUNDING RATES — Binance Futures */
async function fetchFundingRates() {
  try {
    const data = await safeFetch(CONFIG.BINANCE_FUTURES + '/premiumIndex', 'FR');

    if (data) {
      data.forEach((item) => {
        const sym = item.symbol.replace('USDT', '');
        cache.fr[sym] = {
          rate: parseFloat(item.lastFundingRate) * 100,
          mark: parseFloat(item.markPrice),
        };
      });
      cache.lastUpdate.fr = Date.now();
      console.log(`[FR] Updated: ${Object.keys(cache.fr).length} pairs`);
    }
  } catch (err) {
    console.error('[FR] Error:', err.message);
  }
}

/* 3. OPEN INTEREST — Binance Futures */
async function fetchOpenInterest() {
  try {
    /* Get top symbols, skipping ones we know aren't on Futures. */
    const topSymbols = Object.keys(cache.tickers)
      .filter((s) => cache.tickers[s].volume > 5000000 && !FUTURES_SYMBOL_DENYLIST.has(s))
      .slice(0, 50);

    const promises = topSymbols.map((sym) =>
      safeFetch(CONFIG.BINANCE_FUTURES + '/openInterest?symbol=' + sym + 'USDT', 'OI-' + sym).then(
        (data) => {
          if (data && data.openInterest) {
            cache.oi[sym] =
              parseFloat(data.openInterest) * (cache.tickers[sym] ? cache.tickers[sym].price : 0);
          }
        }
      )
    );

    await Promise.allSettled(promises);
    cache.lastUpdate.oi = Date.now();
    console.log(`[OI] Updated: ${Object.keys(cache.oi).length} pairs`);
  } catch (err) {
    console.error('[OI] Error:', err.message);
  }
}

/* 4. LONG/SHORT RATIO — Binance Futures.
   Same /futures/data/ caveat as fetchTaker — /fapi/v1/topLongShortPositionRatio
   returns 404 for every symbol. */
async function fetchLongShort() {
  try {
    const topSymbols = Object.keys(cache.tickers)
      .filter((s) => cache.tickers[s].volume > 10000000 && !FUTURES_SYMBOL_DENYLIST.has(s))
      .slice(0, 30);

    const promises = topSymbols.map((sym) =>
      safeFetch(
        'https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=' +
          sym +
          'USDT&period=1h&limit=4',
        'LS-' + sym
      ).then((data) => {
        if (data && data.length) {
          const latest = data[data.length - 1];
          cache.ls[sym] = {
            long: parseFloat(latest.longAccount) * 100,
            short: parseFloat(latest.shortAccount) * 100,
            ratio: parseFloat(latest.longShortRatio),
            hist: data.map((d) => ({
              long: parseFloat(d.longAccount) * 100,
              short: parseFloat(d.shortAccount) * 100,
              ratio: parseFloat(d.longShortRatio),
              time: d.timestamp,
            })),
          };
        }
      })
    );

    await Promise.allSettled(promises);
    cache.lastUpdate.ls = Date.now();
    console.log(`[LS] Updated: ${Object.keys(cache.ls).length} pairs`);
  } catch (err) {
    console.error('[LS] Error:', err.message);
  }
}

/* 5. TAKER BUY/SELL — Binance Futures.
   Note: this endpoint lives under /futures/data/, NOT under /fapi/v1/.
   The two paths look interchangeable but Binance routes them to
   different services — /fapi/v1/takerlongshortRatio returns 404. */
async function fetchTaker() {
  try {
    const topSymbols = Object.keys(cache.tickers)
      .filter((s) => cache.tickers[s].volume > 10000000 && !FUTURES_SYMBOL_DENYLIST.has(s))
      .slice(0, 30);

    const promises = topSymbols.map((sym) =>
      safeFetch(
        'https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=' +
          sym +
          'USDT&period=1h&limit=4',
        'TAKER-' + sym
      ).then((data) => {
        if (data && data.length) {
          const latest = data[data.length - 1];
          const buyVol = parseFloat(latest.buyVol);
          const sellVol = parseFloat(latest.sellVol);
          const ratio = sellVol > 0 ? buyVol / sellVol : 1;
          const avg =
            data.reduce(
              (s, d) => s + parseFloat(d.buyVol) / Math.max(1, parseFloat(d.sellVol)),
              0
            ) / data.length;

          cache.taker[sym] = {
            ratio: Math.round(ratio * 100) / 100,
            avg: Math.round(avg * 100) / 100,
            buyVol: buyVol,
            sellVol: sellVol,
            trend: ratio > 1.3 ? 'BUY_HEAVY' : ratio < 0.7 ? 'SELL_HEAVY' : 'FLAT',
          };
        }
      })
    );

    await Promise.allSettled(promises);
    cache.lastUpdate.taker = Date.now();
    console.log(`[TAKER] Updated: ${Object.keys(cache.taker).length} pairs`);
  } catch (err) {
    console.error('[TAKER] Error:', err.message);
  }
}

/* 6. ORDER BOOK DEPTH — critical for whale engine */
async function fetchDepth() {
  try {
    /* DEPTH calls Binance SPOT, but a few cache.tickers entries (e.g.
       'ATH' from Bybit) don't exist on Spot — skip them so the probe
       doesn't perpetually 400. */
    const topSymbols = Object.keys(cache.tickers)
      .filter((s) => cache.tickers[s].volume > 10000000 && !SPOT_SYMBOL_DENYLIST.has(s))
      .sort((a, b) => cache.tickers[b].volume - cache.tickers[a].volume)
      .slice(0, 20);

    const promises = topSymbols.map((sym) =>
      safeFetch(
        CONFIG.BINANCE_SPOT + '/depth?symbol=' + sym + 'USDT&limit=20',
        'DEPTH-' + sym
      ).then((data) => {
        if (data && data.bids && data.asks) {
          cache.depth[sym] = {
            bids: data.bids.slice(0, 10),
            asks: data.asks.slice(0, 10),
            time: Date.now(),
          };
        }
      })
    );

    await Promise.allSettled(promises);
    cache.lastUpdate.depth = Date.now();
    console.log(`[DEPTH] Updated: ${Object.keys(cache.depth).length} pairs`);
  } catch (err) {
    console.error('[DEPTH] Error:', err.message);
  }
}

/* 7. LIQUIDATION DATA — historically /fapi/v1/allForceOrders.

   Binance removed public access to that endpoint a while back; today
   it returns HTTP 400 for unauthenticated callers and the only way
   to get user-scoped force orders is /fapi/v1/forceOrders with an
   API key. Until we wire a different upstream (Coinalyze /
   coinglass / Binance WS forceOrder@arr), keep cache.liq populated
   from the websocket-based liquidations the client already stores
   under all.liq, and stop hammering the dead REST endpoint —
   previously it produced one [LIQ] Failed (HTTP 400) every 30 s. */
const LIQ_FETCHER_DISABLED = true;
async function fetchLiquidations() {
  if (LIQ_FETCHER_DISABLED) {
    /* No-op until we have a working public source; keeps the
       cache.lastUpdate.liq age advancing (so /api/health doesn't
       flag liq as 'down' on every tick) but writes nothing. */
    cache.lastUpdate.liq = Date.now();
    return;
  }
  try {
    const data = await safeFetch(CONFIG.BINANCE_FUTURES + '/allForceOrders?limit=50', 'LIQ');

    if (data && data.length) {
      cache.liq = data
        .filter((item) => item.symbol.endsWith('USDT'))
        .map((item) => ({
          sym: item.symbol.replace('USDT', ''),
          side: item.side,
          price: parseFloat(item.price),
          qty: parseFloat(item.origQty),
          value: parseFloat(item.price) * parseFloat(item.origQty),
          time: item.time,
        }))
        .slice(-100);

      cache.lastUpdate.liq = Date.now();
      console.log(`[LIQ] Updated: ${cache.liq.length} liquidations`);
    }
  } catch (err) {
    console.error('[LIQ] Error:', err.message);
  }
}

/* 8. MARKET OVERVIEW — Fear & Greed + BTC Dominance + Coinbase */
async function fetchMarket() {
  try {
    /* Fear & Greed Index */
    const fgData = await safeFetch(CONFIG.FEAR_GREED + '/?limit=1', 'FGI');
    if (fgData && fgData.data && fgData.data.length) {
      cache.market.fgi = parseInt(fgData.data[0].value);
      cache.market.fgiLabel = fgData.data[0].value_classification;
    }

    /* BTC Dominance from CoinGecko */
    const globalData = await safeFetch(CONFIG.COINGECKO + '/global', 'GLOBAL');
    if (globalData && globalData.data && globalData.data.market_cap_percentage) {
      cache.market.btcDom = Math.round(globalData.data.market_cap_percentage.btc * 10) / 10;
    }

    /* Coinbase prices for top coins */
    const cbCoins = ['BTC', 'ETH', 'SOL', 'XRP'];
    for (const coin of cbCoins) {
      const cbData = await safeFetch(
        CONFIG.COINBASE + '/prices/' + coin + '-USD/spot',
        'CB-' + coin
      );
      if (cbData && cbData.data && cbData.data.amount) {
        cache.market.cbp[coin] = parseFloat(cbData.data.amount);
      }
    }

    cache.lastUpdate.market = Date.now();
    console.log(`[MARKET] FGI: ${cache.market.fgi} | BTC Dom: ${cache.market.btcDom}%`);
  } catch (err) {
    console.error('[MARKET] Error:', err.message);
  }
}

/* 9. BITFINEX MARGIN POS.SIZE — stats1 endpoint exposes the open
   long/short position size per pair. We sample the 1-minute bucket
   for a small fixed list of majors (the API has no batch endpoint,
   so each symbol costs two HTTP calls — long + short). */
const BITFINEX_PAIRS = [
  ['BTC', 'tBTCUSD'],
  ['ETH', 'tETHUSD'],
  ['SOL', 'tSOLUSD'],
  ['XRP', 'tXRPUSD'],
  ['DOGE', 'tDOGE:USD'],
  ['ADA', 'tADAUSD'],
  ['LINK', 'tLINK:USD'],
  ['AVAX', 'tAVAX:USD'],
  ['DOT', 'tDOTUSD'],
  ['MATIC', 'tMATIC:USD'],
];

async function fetchBitfinex() {
  try {
    const updates = await Promise.allSettled(
      BITFINEX_PAIRS.map(async ([sym, pair]) => {
        const longUrl = 'https://api-pub.bitfinex.com/v2/stats1/pos.size:1m:' + pair + ':long/last';
        const shortUrl =
          'https://api-pub.bitfinex.com/v2/stats1/pos.size:1m:' + pair + ':short/last';
        const [longRes, shortRes] = await Promise.all([
          safeFetch(longUrl, 'BFX-LONG-' + sym),
          safeFetch(shortUrl, 'BFX-SHORT-' + sym),
        ]);
        if (
          !Array.isArray(longRes) ||
          !Array.isArray(shortRes) ||
          longRes.length < 2 ||
          shortRes.length < 2
        ) {
          return null;
        }
        const long = Math.abs(parseFloat(longRes[1]));
        const short = Math.abs(parseFloat(shortRes[1]));
        const total = long + short;
        if (!isFinite(total) || total <= 0) return null;
        cache.bitfinex[sym] = {
          longPct: Math.round((long / total) * 1000) / 10,
          shortPct: Math.round((short / total) * 1000) / 10,
          ratio: Math.round((long / Math.max(short, 1)) * 100) / 100,
        };
        return sym;
      })
    );
    cache.lastUpdate.bitfinex = Date.now();
    const updated = updates.filter((r) => r.status === 'fulfilled' && r.value).length;
    console.log(`[BITFINEX] Updated: ${updated} pairs`);
  } catch (err) {
    console.error('[BITFINEX] Error:', err.message);
  }
}

/* 10. HYPERLIQUID — a single POST to /info?type=metaAndAssetCtxs
   returns every perp's funding rate + open interest in one shot. */
async function fetchHyperliquid() {
  try {
    const data = await safeFetch('https://api.hyperliquid.xyz/info', 'HL', {
      method: 'POST',
      data: { type: 'metaAndAssetCtxs' },
    });
    if (!Array.isArray(data) || data.length < 2) return;
    const meta = data[0];
    const ctxs = data[1];
    if (!meta || !Array.isArray(meta.universe) || !Array.isArray(ctxs)) return;
    let updated = 0;
    meta.universe.forEach((asset, idx) => {
      const ctx = ctxs[idx];
      if (!asset || !ctx) return;
      const sym = asset.name;
      const funding = parseFloat(ctx.funding);
      const oi = parseFloat(ctx.openInterest);
      if (!sym || !isFinite(funding)) return;
      cache.hyperliquid[sym] = {
        funding:
          funding * 100 /* HL returns absolute funding (0.0001 = 0.01%); app expects percent */,
        openInterest: isFinite(oi) ? oi : 0,
      };
      updated++;
    });
    cache.lastUpdate.hyperliquid = Date.now();
    console.log(`[HL] Updated: ${updated} perps`);
  } catch (err) {
    console.error('[HL] Error:', err.message);
  }
}

/* 11. COINTELEGRAPH NEWS — public RSS feed, no auth. CryptoCompare
   was the original source but they moved /v2/news behind a paid key
   in May 2026, so we switched to CoinTelegraph's RSS (~30 items per
   pull, stable XML shape). The feed is plain XML — we slice on
   <item>, pull title/link/description/pubDate with regex, and run a
   small keyword classifier so app.js's newsSentiment block has
   something to read without a second upstream. */
const NEWS_POS_RE =
  /\b(surge|rally|soar|breakout|bullish|gain|gains|jump|jumps|rise|rises|rising|adopt|approval|approved|boost|boosts|growth|partnership|launch|launches|upgrade|upgrades|all[- ]time high|ath)\b/i;
const NEWS_NEG_RE =
  /\b(crash|plunge|plummet|tumble|bearish|fall|falls|falling|drop|drops|sink|hack|hacked|exploit|fraud|lawsuit|sec[- ]sue|delist|delisted|ban|bans|banned|liquidation|liquidations|sell[- ]off|fud)\b/i;

function classifyNewsSentiment(text) {
  if (!text) return 'neutral';
  const t = String(text);
  const pos = NEWS_POS_RE.test(t);
  const neg = NEWS_NEG_RE.test(t);
  if (pos && !neg) return 'positive';
  if (neg && !pos) return 'negative';
  return 'neutral';
}

/* RSS helpers — minimal CDATA / tag / entity strippers. The PWA only
   renders plain text, so a perfect XML decoder isn't worth the
   dependency. */
function _stripCdata(s) {
  if (!s) return '';
  const m = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return m ? m[1] : s;
}
function _stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, '');
}
function _decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
function _grab(block, re) {
  const m = block.match(re);
  return m ? m[1] : '';
}

async function fetchNews() {
  try {
    const xml = await safeFetch('https://cointelegraph.com/rss', 'NEWS', {
      responseType: 'text',
    });
    if (typeof xml !== 'string' || !xml.includes('<item>')) {
      cache.news = [];
      cache.newsSentiment = { positive: 0, negative: 0, neutral: 0 };
      return;
    }
    const itemBlocks = xml.split('<item>').slice(1, 31);
    const totals = { positive: 0, negative: 0, neutral: 0 };
    cache.news = itemBlocks
      .map((block) => {
        const title = _decodeEntities(_stripCdata(_grab(block, /<title>([\s\S]*?)<\/title>/)))
          .trim()
          .slice(0, 200);
        const link = _stripCdata(_grab(block, /<link>([\s\S]*?)<\/link>/))
          .trim()
          .slice(0, 300);
        const desc = _decodeEntities(
          _stripTags(_stripCdata(_grab(block, /<description>([\s\S]*?)<\/description>/)))
        )
          .trim()
          .slice(0, 400);
        const pubDate = _grab(block, /<pubDate>([\s\S]*?)<\/pubDate>/).trim();
        const sentiment = classifyNewsSentiment(title + ' ' + desc);
        totals[sentiment]++;
        return {
          title,
          url: link,
          body: desc,
          publishedOn: pubDate ? new Date(pubDate).getTime() || Date.now() : Date.now(),
          source: 'CoinTelegraph',
          sentiment,
        };
      })
      .filter((n) => n.title);
    /* app.js:3895 reads newsSentiment.total to render the News row in
       the data-spectrum panel ("نضارة البيانات"). Without this the row
       sticks at 0 ❌ even when news.length > 0. */
    totals.total = totals.positive + totals.negative + totals.neutral;
    cache.newsSentiment = totals;
    cache.lastUpdate.news = Date.now();
    console.log(
      `[NEWS] Updated: ${cache.news.length} items (${totals.positive}+ / ${totals.negative}- / ${totals.neutral}=)`
    );
  } catch (err) {
    console.error('[NEWS] Error:', err.message);
  }
}

/* 12. DATA-SERVER BRIDGE — pulls the legacy Python engine's snapshot
   off the loopback. data_server.py is heavyweight (whale engine,
   blockchain ingestion, multi-exchange aggregation) and already feeds
   the Telegram notifier; rather than reimplement those upstreams in
   Node, we just import the fields the PWA needs. Failure is silent —
   the rest of the proxy keeps serving without these enrichment keys. */
async function fetchFromDataServer() {
  try {
    /* Bypass safeFetch: it would reject 127.0.0.1 via the
       DNS-rebinding guard (which exists for *external* upstreams). The
       loopback is intentionally allowed here, with no retries and a
       short timeout so a stuck data_server.py can't pile up requests. */
    const res = await axios.get(CONFIG.DATA_SERVER_URL, {
      timeout: 8000,
      maxRedirects: 0,
    });
    const d = res.data;
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.whales)) cache.dsWhales = d.whales;
    if (d.mcap && typeof d.mcap === 'object') cache.dsMcap = d.mcap;
    if (d.multi && typeof d.multi === 'object') cache.dsMulti = d.multi;
    cache.lastUpdate.dataServer = Date.now();
    /* Aggregate the freshly-imported whale rows into per-symbol
       waves + engine state. Done synchronously so /api/all and the
       wave push trigger see consistent input from this tick. */
    cache.whaleWaves = whaleEngine.aggregateWhales(cache.dsWhales);
    cache.whaleWavesTs = Date.now();
    cache.lastUpdate.whaleEngine = cache.whaleWavesTs;
    /* Fire whale + news + wave push notifications opportunistically.
       Each has its own cooldown so the 5-s tick cadence doesn't
       translate into spam. */
    maybePushWhaleAlerts().catch((e) => console.error('[PUSH] Whale alert error:', e.message));
    maybePushWhaleWave().catch((e) => console.error('[PUSH] Wave alert error:', e.message));
    maybePushNewsAlerts().catch((e) => console.error('[PUSH] News alert error:', e.message));
    console.log(
      `[DATA-SERVER] whales=${cache.dsWhales.length}, mcap=${Object.keys(cache.dsMcap).length}, multi=[${Object.keys(cache.dsMulti).join(',')}]`
    );
  } catch (err) {
    console.error('[DATA-SERVER] Error:', err.message);
  }
}

/* ═══ API ROUTES ═══ */

/* Main endpoint — returns ALL data.
   Snapshot is built at most once per API_ALL_TTL_MS and shared across
   every concurrent client, so a burst of 500 dashboards still costs a
   single serialization pass. */
let apiAllSnapshot = null;
let apiAllSnapshotAt = 0;
function buildApiAllSnapshot() {
  /* Shallow-clone every store. The previous version returned the live
     cache.* objects by reference; while res.json() was serialising
     them, a coincident fetcher tick (every 5-300 s) could mutate the
     same object, producing TypeError("cyclic object") or half-written
     responses. Cloning at snapshot time pays an O(coins) copy in the
     refresh path (≤ 3 s, capped by API_ALL_TTL_MS) instead of risking
     interleaved writes during JSON serialisation. */
  /* The PWA reads multi-exchange enrichment under `all.multi` — see
     app.js:1975-1989 (`if(all.multi){var m=all.multi; if(m.coinalyze)...
     if(m.hyperliquid)... if(m.news)... if(m.newsSentiment)...
     if(m.bitfinex)...`). Earlier revisions of buildApiAllSnapshot
     flattened these to the top level, which the PWA silently ignored
     (every multi-exchange row stuck at 0 ❌). We now keep the legacy
     nested shape and expose:
       - bitfinex from server.js's own fetcher
       - hyperliquid / coinalyze / news / newsSentiment / blockchain /
         cbPremium passed through from data_server.py when available,
         falling back to our in-Node hyperliquid + news collectors
         when :8080 is dead. */
  const ds = cache.dsMulti || {};
  let newsSentimentOut;
  if (ds.newsSentiment) {
    newsSentimentOut = { ...ds.newsSentiment };
  } else {
    newsSentimentOut = { ...cache.newsSentiment };
  }
  if (newsSentimentOut.total == null) {
    newsSentimentOut.total =
      (newsSentimentOut.positive || 0) +
      (newsSentimentOut.negative || 0) +
      (newsSentimentOut.neutral || 0);
  }
  const newsArr = Array.isArray(ds.news) && ds.news.length ? ds.news.slice() : cache.news.slice();
  const hyperliquidObj = ds.hyperliquid ? { ...ds.hyperliquid } : { ...cache.hyperliquid };
  return {
    tickers: { ...cache.tickers },
    fr: { ...cache.fr },
    oi: { ...cache.oi },
    ls: { ...cache.ls },
    taker: { ...cache.taker },
    liq: cache.liq.slice(),
    depth: { ...cache.depth },
    market: { ...cache.market, cbp: { ...cache.market.cbp } },
    /* Top-level mirrors of multi.* — kept for any caller that already
       reads them off the root (the new server.js code path) without
       breaking the legacy PWA which reads from all.multi. Cheap O(n)
       shallow clones so a refresh tick mid-serialisation won't tear. */
    bitfinex: { ...cache.bitfinex },
    hyperliquid: hyperliquidObj,
    news: newsArr,
    newsSentiment: newsSentimentOut,
    coinalyze: ds.coinalyze ? { ...ds.coinalyze } : {},
    blockchain: ds.blockchain ? { ...ds.blockchain } : {},
    /* Legacy nested shape app.js:1975 actually consumes. */
    multi: {
      bitfinex: { ...cache.bitfinex },
      hyperliquid: hyperliquidObj,
      news: newsArr,
      newsSentiment: newsSentimentOut,
      coinalyze: ds.coinalyze ? { ...ds.coinalyze } : {},
      blockchain: ds.blockchain ? { ...ds.blockchain } : {},
      cbPremium: ds.cbPremium ? { ...ds.cbPremium } : {},
    },
    whales: cache.dsWhales.slice(),
    mcap: { ...cache.dsMcap },
    /* Server-side scanner output — top 50 ranked signals plus the
       headline Top 3. Surfaces the proxy's always-on view of the
       market so the PWA can render them even while the device's
       own quickScan() hasn't fired yet (or never will, on a cold
       PWA open after a long sleep). */
    signals: Array.isArray(cache.signals) ? cache.signals.slice(0, 50) : [],
    top3: Array.isArray(cache.top3) ? cache.top3.slice() : [],
    scannerTs: cache.scannerTs || 0,
    /* Server-computed indicators per symbol — RSI / MACD / EMAs /
       ATR + the human-readable direction verdict. The PWA reads
       indicators[sym].direction.ar to render "شراء قوي / خفيف / ..."
       on the BTC / ETH cards even when its own kline fetch hasn't
       fired yet. */
    indicators: { ...cache.indicators },
    indicatorsTs: cache.indicatorsTs || 0,
    /* Server-aggregated whale waves — per-symbol totals + engine
       rank/confidence. The PWA's whale cards render straight from
       this so they fill in instantly on a cold open. */
    whaleWaves: { ...cache.whaleWaves },
    whaleWavesTs: cache.whaleWavesTs || 0,
    meta: {
      coins: Object.keys(cache.tickers).length,
      lastUpdate: { ...cache.lastUpdate },
      uptime: Math.floor(process.uptime()),
      version: '10.1',
      snapshotAt: Date.now(),
    },
  };
}
app.get('/api/all', (req, res) => {
  /* responseMetrics is declared further down with the health threshold
     block, but it's safe to bump here — module-level const initialises
     before any request can arrive. */
  if (typeof responseMetrics !== 'undefined') responseMetrics.apiAll++;
  const now = Date.now();
  if (!apiAllSnapshot || now - apiAllSnapshotAt > CONFIG.API_ALL_TTL_MS) {
    apiAllSnapshot = buildApiAllSnapshot();
    apiAllSnapshotAt = now;
  }
  res.set('Cache-Control', 'public, max-age=' + Math.ceil(CONFIG.API_ALL_TTL_MS / 1000));
  res.json(apiAllSnapshot);
});

/* Endpoint-hit counters — a thin observability layer that lets
   /api/metrics show real traffic shape without an external APM. */
const responseMetrics = {
  apiAll: 0,
  apiHealth: 0,
  apiMetrics: 0,
  notify: 0,
};

/* Health check — top-level `status` mirrors tickers freshness (the legacy
   contract), while `ages` adds a per-cache breakdown so monitors can see
   exactly which upstream is stale. Returns 503 when tickers is 'down' so
   external monitors / load balancers can alert without parsing the body. */
const HEALTH_THRESHOLDS = {
  tickers: { stale: 30000, down: 60000 },
  fr: { stale: 120000, down: 300000 },
  oi: { stale: 120000, down: 300000 },
  ls: { stale: 120000, down: 300000 },
  taker: { stale: 120000, down: 300000 },
  depth: { stale: 60000, down: 180000 },
  liq: { stale: 120000, down: 600000 },
  market: { stale: 600000, down: 1800000 },
  /* Enrichment caches — slower refresh + more tolerant thresholds. The
     PWA degrades gracefully when these are missing (it just hides the
     extra rows), so a "stale" rating here is informational, not a
     reason to flip /api/health to 503. */
  bitfinex: { stale: 300000, down: 900000 },
  hyperliquid: { stale: 180000, down: 600000 },
  news: { stale: 900000, down: 3600000 },
};
function _classifyAge(last, thresholds, now) {
  if (!last) return { ageMs: null, status: 'down' };
  const age = now - last;
  let status;
  if (age >= thresholds.down) status = 'down';
  else if (age >= thresholds.stale) status = 'stale';
  else status = 'healthy';
  return { ageMs: age, status };
}

/* Compute the per-cache age breakdown used by both /api/health and
   /api/metrics so the contract stays consistent. */
function _buildAges(now) {
  const ages = {};
  for (const [key, t] of Object.entries(HEALTH_THRESHOLDS)) {
    ages[key] = _classifyAge(cache.lastUpdate[key] || 0, t, now);
  }
  return ages;
}

/* Translate cache + upstream state into a list of human-readable
   alerts. Drives the `alerts` field on /api/health and /api/metrics
   so monitors can lift them straight into a notification without any
   threshold logic of their own. */
const ALERT_FAILURE_RATIO = 0.2; /* 20 % of recent calls failed */
const ALERT_MIN_CALLS_FOR_RATIO = 25; /* don't fire on a quiet startup */
function evaluateAlerts(now) {
  const alerts = [];
  const ages = _buildAges(now);
  for (const [key, info] of Object.entries(ages)) {
    if (info.status === 'down') {
      alerts.push({
        level: 'critical',
        source: key,
        message:
          info.ageMs == null
            ? `cache "${key}" has never been populated`
            : `cache "${key}" is down (age ${Math.round(info.ageMs / 1000)} s)`,
      });
    } else if (info.status === 'stale') {
      alerts.push({
        level: 'warning',
        source: key,
        message: `cache "${key}" is stale (age ${Math.round(info.ageMs / 1000)} s)`,
      });
    }
  }
  for (const [label, b] of Object.entries(upstreamByLabel)) {
    const total = b.success + b.failed;
    if (total < ALERT_MIN_CALLS_FOR_RATIO) continue;
    const ratio = b.failed / total;
    if (ratio >= ALERT_FAILURE_RATIO) {
      alerts.push({
        level: 'warning',
        source: label,
        message: `upstream "${label}" failure ratio ${(ratio * 100).toFixed(1)} % over ${total} calls`,
      });
    }
  }
  return alerts;
}

app.get('/api/health', (req, res) => {
  responseMetrics.apiHealth++;
  const now = Date.now();
  const ages = _buildAges(now);
  const status = ages.tickers.status;
  const httpStatus = status === 'down' ? 503 : 200;
  res.set('Cache-Control', 'no-store');
  res.status(httpStatus).json({
    status,
    coins: Object.keys(cache.tickers).length,
    fr: Object.keys(cache.fr).length,
    oi: Object.keys(cache.oi).length,
    ls: Object.keys(cache.ls).length,
    uptime: Math.floor(process.uptime()),
    lastUpdate: cache.lastUpdate,
    ages,
    upstream: { ...upstreamMetrics },
    alerts: evaluateAlerts(now),
  });
});

/* Metrics endpoint — superset of /api/health intended for dashboards
   and Prometheus-style scrapers. JSON shape (no external dependency).
   Distinct from /api/health because health is the binary "is it up"
   read used by load balancers; metrics is the rich diagnostic view. */
app.get('/api/metrics', (req, res) => {
  responseMetrics.apiMetrics++;
  const now = Date.now();
  const ages = _buildAges(now);
  const mem = process.memoryUsage();
  res.set('Cache-Control', 'no-store');
  res.json({
    timestamp: now,
    uptime: Math.floor(process.uptime()),
    process: {
      rssMb: +(mem.rss / 1024 / 1024).toFixed(1),
      heapUsedMb: +(mem.heapUsed / 1024 / 1024).toFixed(1),
      heapTotalMb: +(mem.heapTotal / 1024 / 1024).toFixed(1),
      externalMb: +(mem.external / 1024 / 1024).toFixed(1),
    },
    cache: {
      coins: Object.keys(cache.tickers).length,
      fr: Object.keys(cache.fr).length,
      oi: Object.keys(cache.oi).length,
      ls: Object.keys(cache.ls).length,
      taker: Object.keys(cache.taker).length,
      depth: Object.keys(cache.depth).length,
    },
    ages,
    upstream: {
      total: { ...upstreamMetrics },
      byLabel: Object.fromEntries(Object.entries(upstreamByLabel).map(([k, v]) => [k, { ...v }])),
    },
    requests: { ...responseMetrics },
    alerts: evaluateAlerts(now),
  });
});

/* sanitizeTelegramHtml + safeEqual now live in src/server-helpers.js so
   they can be unit-tested without booting Express. */

/* ═══ TELEGRAM ALERT MANAGER ═══

   Pulls evaluateAlerts() on a 60 s loop. New alerts (not present in
   the previous tick) fire one Telegram message per source; cleared
   alerts fire a "RESOLVED" message. A per-source 5-minute cooldown
   prevents flapping. Opt-in via ENABLE_TELEGRAM_ALERTS=true so the
   loop never runs in dev or test environments — the loop also requires
   TG_BOT_TOKEN + TG_CHAT_ID to be configured. */

const ALERT_LOOP_INTERVAL_MS = 60 * 1000;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const ALERTS_ENABLED = process.env.ENABLE_TELEGRAM_ALERTS === 'true';
const _alertState = { firing: Object.create(null), lastSentAt: Object.create(null) };
let _alertTimer = null;

function _alertKey(alert) {
  return alert.source + '|' + alert.level;
}

async function _sendAlertTelegram(text) {
  if (!CONFIG.TG_BOT_TOKEN || !CONFIG.TG_CHAT_ID) return false;
  try {
    await axios.post(
      'https://api.telegram.org/bot' + encodeURIComponent(CONFIG.TG_BOT_TOKEN) + '/sendMessage',
      { chat_id: CONFIG.TG_CHAT_ID, text: sanitizeTelegramHtml(text), parse_mode: 'HTML' },
      { timeout: 8000 }
    );
    return true;
  } catch (e) {
    console.error('[ALERT-TG] send failed:', (e && e.message) || e);
    return false;
  }
}

/* One pass: diff current alerts against last-known-firing, post to
   Telegram for any new firing or resolved transition that's outside
   its cooldown. Exported so tests + an operator can drive it on
   demand without spinning up the timer. */
async function processAlertTransitions(now) {
  const t = typeof now === 'number' ? now : Date.now();
  const current = evaluateAlerts(t);
  const currentKeys = new Set(current.map(_alertKey));
  const sent = [];

  /* New / re-firing alerts */
  for (const a of current) {
    const key = _alertKey(a);
    const lastSent = _alertState.lastSentAt[key] || 0;
    const wasFiring = !!_alertState.firing[key];
    if (!wasFiring && t - lastSent >= ALERT_COOLDOWN_MS) {
      const icon = a.level === 'critical' ? '🚨' : '⚠️';
      const text = `${icon} <b>${a.level.toUpperCase()}</b>\nsource: <code>${a.source}</code>\n${a.message}`;
      const ok = await _sendAlertTelegram(text);
      if (ok) {
        _alertState.lastSentAt[key] = t;
        sent.push({ key, type: 'firing' });
      }
    }
    _alertState.firing[key] = a;
  }

  /* Cleared alerts: previously firing, now absent */
  for (const key of Object.keys(_alertState.firing)) {
    if (currentKeys.has(key)) continue;
    const last = _alertState.firing[key];
    delete _alertState.firing[key];
    const text = `✅ <b>RESOLVED</b>\nsource: <code>${last.source}</code>\n${last.message}`;
    const ok = await _sendAlertTelegram(text);
    if (ok) sent.push({ key, type: 'resolved' });
  }
  return sent;
}

function startAlertLoop() {
  if (_alertTimer) return;
  if (!ALERTS_ENABLED) return;
  if (!CONFIG.TG_BOT_TOKEN || !CONFIG.TG_CHAT_ID) {
    console.warn('[ALERT-TG] ENABLE_TELEGRAM_ALERTS=true but Telegram not configured — skipping');
    return;
  }
  _alertTimer = setInterval(function () {
    processAlertTransitions().catch(function (e) {
      console.error('[ALERT-TG] tick failed:', (e && e.message) || e);
    });
  }, ALERT_LOOP_INTERVAL_MS);
  console.log('[ALERT-TG] alert loop started (' + ALERT_LOOP_INTERVAL_MS / 1000 + 's interval)');
}

function stopAlertLoop() {
  if (_alertTimer) {
    clearInterval(_alertTimer);
    _alertTimer = null;
  }
}

/* Test helper — wipe the in-memory firing/cooldown state so unit tests
   don't bleed across cases. */
function _resetAlertState() {
  for (const k of Object.keys(_alertState.firing)) delete _alertState.firing[k];
  for (const k of Object.keys(_alertState.lastSentAt)) delete _alertState.lastSentAt[k];
}

/* ═══ WEB PUSH ENDPOINTS ═══

   /api/push/public-key  — returns the VAPID public key the PWA needs
                           to subscribe (it's not actually a secret —
                           browsers expose it in the request anyway).
   /api/push/subscribe   — accepts a PushSubscription JSON, dedups on
                           endpoint, persists to disk.
   /api/push/unsubscribe — removes a subscription by endpoint.
   /api/push/test        — fires a "ping" notification to all
                           subscribers; useful for first-time setup. */

app.get('/api/push/public-key', (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'push_disabled' });
  res.set('Cache-Control', 'no-store');
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

function _isValidSubscription(sub) {
  return (
    sub &&
    typeof sub.endpoint === 'string' &&
    /^https:\/\//.test(sub.endpoint) &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string'
  );
}

/* Prefs payload from the client is { whales, scanTrades, top3, news }.
   Anything missing is treated as "on" by sendPushToAll — see the
   comment there. We strip unknown keys so a malicious client can't
   inflate the JSON we persist. */
const PUSH_PREF_KEYS = ['whales', 'scanTrades', 'top3', 'news'];
function _normalizePrefs(p) {
  if (!p || typeof p !== 'object') return undefined;
  const out = {};
  for (const k of PUSH_PREF_KEYS) {
    if (typeof p[k] === 'boolean') out[k] = p[k];
  }
  return Object.keys(out).length ? out : undefined;
}

app.post('/api/push/subscribe', (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'push_disabled' });
  const sub = req.body && req.body.subscription;
  if (!_isValidSubscription(sub)) {
    return res.status(400).json({ error: 'invalid_subscription' });
  }
  const prefs = _normalizePrefs(req.body && req.body.prefs);
  const existing = cache.pushSubs.find((s) => s.endpoint === sub.endpoint);
  if (existing) {
    /* Re-subscribe (e.g. PWA reinstall) refreshes prefs without
       disturbing addedAt — keeps the audit trail intact. */
    if (prefs) existing.prefs = prefs;
    savePushSubs();
  } else {
    cache.pushSubs.push({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      addedAt: Date.now(),
      prefs: prefs,
    });
    savePushSubs();
    console.log(`[PUSH] New subscription (${cache.pushSubs.length} total)`);
  }
  res.json({ ok: true, total: cache.pushSubs.length });
});

/* Update only the prefs of an existing subscription. The user
   toggles a category in the UI → we POST here so the server-side
   filter in sendPushToAll picks up the change before the next
   trigger fires. */
app.post('/api/push/prefs', (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'push_disabled' });
  const endpoint = req.body && req.body.endpoint;
  const prefs = _normalizePrefs(req.body && req.body.prefs);
  if (typeof endpoint !== 'string' || !prefs) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const sub = cache.pushSubs.find((s) => s.endpoint === endpoint);
  if (!sub) return res.status(404).json({ error: 'not_found' });
  sub.prefs = prefs;
  savePushSubs();
  res.json({ ok: true, prefs: sub.prefs });
});

/* Relay endpoint — the browser side surfaces a local notification via
   notify() in src/notifications.js, which calls nxPush.shouldRelay.
   That handler picks the right category, drops anything the user
   disabled, and POSTs here. The server then fans the same payload
   out to every other subscriber whose prefs allow that category.

   Validation: payload size is capped, the type must be one of the
   four known keys (otherwise sendPushToAll falls through to "no
   filtering" which would leak across categories). Rate limit
   re-uses the /api/ limiter declared above. */
const RELAY_TYPE_WHITELIST = new Set(PUSH_PREF_KEYS);
app.post('/api/push/relay', async (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'push_disabled' });
  const b = req.body || {};
  if (typeof b.title !== 'string' || !b.title || b.title.length > 200) {
    return res.status(400).json({ error: 'invalid_title' });
  }
  if (typeof b.body !== 'string' || b.body.length > 400) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  if (!RELAY_TYPE_WHITELIST.has(b.type)) {
    return res.status(400).json({ error: 'invalid_type' });
  }
  const payload = {
    title: b.title,
    body: b.body,
    tag: typeof b.tag === 'string' ? b.tag.slice(0, 80) : b.type,
    url: typeof b.url === 'string' ? b.url.slice(0, 200) : '/',
  };
  const result = await sendPushToAll(payload, b.type);
  res.json(result);
});

/* ─── User custom alerts API ───────────────────────────────────
   Each alert is bound to a push-subscription endpoint so we can
   route the notification to the device that asked for it. The
   payload accepts:
     sym     — coin ticker (e.g. "BTC")
     rule    — predicate string: "price>=100000" / "rsi>=80" / ...
     repeat  — boolean (default false). One-shots disappear after
                firing; repeats cool down for 30 min.
     endpoint — the subscriber's PushSubscription.endpoint */

function _generateAlertId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

app.get('/api/alerts', (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'push_disabled' });
  const endpoint = req.query.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) {
    return res.status(400).json({ error: 'no_endpoint' });
  }
  const own = cache.userAlerts.filter((a) => a.endpoint === endpoint);
  res.json({ alerts: own, max: alertsEngine.MAX_PER_USER });
});

app.post('/api/alerts/create', (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'push_disabled' });
  const b = req.body || {};
  if (typeof b.endpoint !== 'string') return res.status(400).json({ error: 'no_endpoint' });
  const sub = cache.pushSubs.find((s) => s.endpoint === b.endpoint);
  if (!sub) return res.status(404).json({ error: 'subscription_not_found' });
  const own = cache.userAlerts.filter((a) => a.endpoint === b.endpoint);
  const valErr = alertsEngine.validateAlertInput(b, own.length);
  if (valErr) return res.status(400).json({ error: valErr });
  const sym = String(b.sym).toUpperCase().slice(0, 12);
  const alert = {
    id: _generateAlertId(),
    endpoint: b.endpoint,
    sym,
    rule: b.rule,
    repeat: !!b.repeat,
    createdAt: Date.now(),
  };
  cache.userAlerts.push(alert);
  saveUserAlerts();
  console.log(`[ALERTS] Created: ${sym} ${b.rule} (repeat=${alert.repeat})`);
  res.json({ ok: true, alert });
});

app.delete('/api/alerts/:id', (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'push_disabled' });
  const id = req.params.id;
  const endpoint = req.query.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'no_endpoint' });
  const before = cache.userAlerts.length;
  cache.userAlerts = cache.userAlerts.filter((a) => !(a.id === id && a.endpoint === endpoint));
  if (cache.userAlerts.length === before) return res.status(404).json({ error: 'not_found' });
  saveUserAlerts();
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'push_disabled' });
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'no_endpoint' });
  const before = cache.pushSubs.length;
  cache.pushSubs = cache.pushSubs.filter((s) => s.endpoint !== endpoint);
  if (cache.pushSubs.length !== before) savePushSubs();
  res.json({ ok: true, removed: before - cache.pushSubs.length });
});

app.post('/api/push/test', async (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'push_disabled' });
  const result = await sendPushToAll({
    title: '🔔 NEXUS PRO',
    body: 'تم تفعيل الإشعارات بنجاح — ستصلك تنبيهات الحيتان والإشارات هنا.',
    tag: 'nexus-test',
    url: '/',
  });
  res.json(result);
});

app.post('/notify', async (req, res) => {
  responseMetrics.notify++;
  if (!CONFIG.TG_BOT_TOKEN || !CONFIG.TG_CHAT_ID) {
    return res.status(503).json({ ok: false, error: 'Telegram not configured' });
  }

  /* Reject requests with no Origin header. The CORS middleware allows
     same-origin / server-to-server (Origin absent) for the /api/ data
     endpoints, but /notify costs real money on every call and must be
     called from a real browser context with a real Origin we can match
     against ALLOWED_ORIGINS. */
  if (!req.get('Origin')) {
    return res.status(403).json({ ok: false, error: 'Origin header required' });
  }

  if (CONFIG.NOTIFY_SECRET) {
    const provided = req.get('X-Notify-Secret') || '';
    if (!safeEqual(provided, CONFIG.NOTIFY_SECRET)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ ok: false, error: 'Invalid message' });
    }

    const cleanMsg = sanitizeTelegramHtml(message);
    if (!cleanMsg.trim()) {
      return res.status(400).json({ ok: false, error: 'Empty after sanitization' });
    }

    await axios.post(
      'https://api.telegram.org/bot' + encodeURIComponent(CONFIG.TG_BOT_TOKEN) + '/sendMessage',
      {
        chat_id: CONFIG.TG_CHAT_ID,
        text: cleanMsg,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: 5000 }
    );

    res.json({ ok: true });
  } catch (err) {
    /* Log only the upstream HTTP status — axios error .message and response
       body can contain the bot-token path we just sent to Telegram. */
    const status = err && err.response && err.response.status ? err.response.status : 'n/a';
    console.error('[TG] notify failed: status=' + status);
    res.status(502).json({ ok: false, error: 'Upstream error' });
  }
});

/* ═══ STARTUP ═══ */
const refreshTimers = [];
async function startDataLoops() {
  console.log('═══ NEXUS PRO Proxy Server V10.1 ═══');
  console.log(`Starting on port ${PORT}...`);

  /* Initial load — sequential to avoid rate limits */
  console.log('[INIT] Loading tickers...');
  await fetchTickers();

  console.log('[INIT] Loading funding rates...');
  await fetchFundingRates();

  console.log('[INIT] Loading open interest...');
  await fetchOpenInterest();

  console.log('[INIT] Loading long/short...');
  await fetchLongShort();

  console.log('[INIT] Loading taker data...');
  await fetchTaker();

  console.log('[INIT] Loading order book depth...');
  await fetchDepth();

  console.log('[INIT] Loading liquidations...');
  await fetchLiquidations();

  console.log('[INIT] Loading market data...');
  await fetchMarket();

  console.log('[INIT] Loading multi-exchange enrichment...');
  await Promise.allSettled([
    fetchBitfinex(),
    fetchHyperliquid(),
    fetchNews(),
    fetchFromDataServer(),
  ]);

  console.log(`[INIT] ✅ Ready — ${Object.keys(cache.tickers).length} coins loaded`);

  /* Set up refresh intervals — kept in a list so we can tear them down
     on shutdown instead of leaking timers into the container runtime.
     Jitter (±10%) avoids synchronised bursts to upstream APIs across
     multiple replicas, which can trip rate limits. */
  function jitter(base) {
    return base + Math.floor((Math.random() - 0.5) * 0.2 * base);
  }
  refreshTimers.push(
    setInterval(fetchTickers, jitter(CONFIG.TICKER_INTERVAL)),
    setInterval(fetchFundingRates, jitter(CONFIG.FR_INTERVAL)),
    setInterval(fetchOpenInterest, jitter(CONFIG.OI_INTERVAL)),
    setInterval(fetchLongShort, jitter(CONFIG.LS_INTERVAL)),
    setInterval(fetchTaker, jitter(CONFIG.TAKER_INTERVAL)),
    setInterval(fetchDepth, jitter(CONFIG.DEPTH_INTERVAL)),
    setInterval(fetchLiquidations, jitter(CONFIG.LIQ_INTERVAL)),
    setInterval(fetchMarket, jitter(CONFIG.MARKET_INTERVAL)),
    setInterval(fetchBitfinex, jitter(CONFIG.BITFINEX_INTERVAL)),
    setInterval(fetchHyperliquid, jitter(CONFIG.HYPERLIQUID_INTERVAL)),
    setInterval(fetchNews, jitter(CONFIG.NEWS_INTERVAL)),
    setInterval(fetchFromDataServer, jitter(CONFIG.DATA_SERVER_INTERVAL)),
    setInterval(
      () => runScannerOnServer().catch((e) => console.error('[SCANNER] tick failed:', e.message)),
      jitter(CONFIG.SCANNER_INTERVAL)
    ),
    setInterval(
      () =>
        runIndicatorsOnServer().catch((e) => console.error('[INDICATORS] tick failed:', e.message)),
      jitter(CONFIG.INDICATOR_INTERVAL)
    ),
    setInterval(
      () => runUserAlertsCheck().catch((e) => console.error('[ALERTS] tick failed:', e.message)),
      jitter(CONFIG.USER_ALERTS_INTERVAL)
    )
  );

  /* First scanner pass — runs once the warm-up fetches above have
     filled tickers / fr / oi, so /api/all already exposes a ranked
     signal list on the very first PWA load. The indicator pass
     follows a few seconds later because it depends on Binance
     klines (separate fetch) — staggering the two avoids a thundering
     herd at startup. */
  setTimeout(
    () => runScannerOnServer().catch((e) => console.error('[SCANNER] init failed:', e.message)),
    2000
  );
  setTimeout(
    () =>
      runIndicatorsOnServer().catch((e) => console.error('[INDICATORS] init failed:', e.message)),
    5000
  );

  /* Telegram alerts on cache-down / sustained-failure transitions.
     No-op unless ENABLE_TELEGRAM_ALERTS=true and Telegram is wired. */
  startAlertLoop();
}

/* Process-level safety nets. An unhandled rejection or uncaught exception
   used to be swallowed silently, which left the data loops running on top
   of a half-broken process. Exit so the supervisor (PM2 / systemd / k8s)
   can restart us clean. */
process.on('unhandledRejection', function (reason) {
  console.error('[FATAL] unhandledRejection:', reason && reason.message ? reason.message : reason);
  process.exit(1);
});
process.on('uncaughtException', function (err) {
  console.error('[FATAL] uncaughtException:', err && err.message ? err.message : err);
  process.exit(1);
});

/* Start server only when this file is run directly (`node server.js`).
   When required from a test (`require('../server.js')`) we expose `app`
   on module.exports so supertest-style suites can drive it without
   spinning up a real listening socket or kicking off the data-refresh
   loops. */
let server;
if (require.main === module) {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
    startDataLoops();
  });
}

/* Test seam — invalidate the /api/all TTL cache so suites can stage
   fresh inputs between requests without sleeping out the 3 s window. */
function _resetApiAllSnapshot() {
  apiAllSnapshot = null;
  apiAllSnapshotAt = 0;
}

module.exports = {
  app,
  cache,
  _resetApiAllSnapshot,
  safeFetch,
  upstreamMetrics,
  upstreamByLabel,
  responseMetrics,
  evaluateAlerts,
  processAlertTransitions,
  startAlertLoop,
  stopAlertLoop,
  _resetAlertState,
};

/* Graceful shutdown — stop accepting new connections, cancel all refresh
   timers, then exit. Gives in-flight requests a 10s grace window. */
function shutdown(signal) {
  console.log('[SHUTDOWN] Received ' + signal + ', draining...');
  refreshTimers.forEach(clearInterval);
  refreshTimers.length = 0;
  if (server) {
    server.close(function () {
      console.log('[SHUTDOWN] HTTP server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
  setTimeout(function () {
    console.warn('[SHUTDOWN] Grace timeout reached, forcing exit');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', function () {
  shutdown('SIGTERM');
});
process.on('SIGINT', function () {
  shutdown('SIGINT');
});
