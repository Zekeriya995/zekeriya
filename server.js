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
const axios = require('axios');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

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

  /* /api/all TTL cache — one snapshot shared across all clients */
  API_ALL_TTL_MS: 3000,

  /* Request timeout */
  TIMEOUT: 8000,
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
  lastUpdate: {},
};

/* ═══ SAFE FETCH — with timeout and error handling ═══ */

/* Allowlist of upstream hosts. Any URL we fetch must resolve to one of these
   so a compromised symbol/argument can't steer requests to internal IPs. */
const FETCH_HOST_ALLOWLIST = new Set([
  'api.binance.com',
  'fapi.binance.com',
  'api.bybit.com',
  'api.coingecko.com',
  'api.coinbase.com',
  'api.alternative.me',
]);

function isAllowedFetchUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && FETCH_HOST_ALLOWLIST.has(u.hostname);
  } catch {
    return false;
  }
}

async function safeFetch(url, label) {
  if (!isAllowedFetchUrl(url)) {
    console.error(`[${label}] Blocked: host not in allowlist`);
    return null;
  }
  try {
    const res = await axios.get(url, {
      timeout: CONFIG.TIMEOUT,
      /* Disable redirects so a 30x can't bounce us to an internal host. */
      maxRedirects: 0,
    });
    return res.data;
  } catch (err) {
    /* Avoid leaking the URL (which may carry tokens) — only the upstream
       status code if the error came from a response. */
    const status = err && err.response && err.response.status;
    console.error(`[${label}] Failed${status ? ` (HTTP ${status})` : ''}`);
    return null;
  }
}

/* ═══ DATA FETCHERS ═══ */

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
    /* Get top symbols */
    const topSymbols = Object.keys(cache.tickers)
      .filter((s) => cache.tickers[s].volume > 5000000)
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

/* 4. LONG/SHORT RATIO — Binance Futures */
async function fetchLongShort() {
  try {
    const topSymbols = Object.keys(cache.tickers)
      .filter((s) => cache.tickers[s].volume > 10000000)
      .slice(0, 30);

    const promises = topSymbols.map((sym) =>
      safeFetch(
        CONFIG.BINANCE_FUTURES +
          '/topLongShortPositionRatio?symbol=' +
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

/* 5. TAKER BUY/SELL — Binance Futures */
async function fetchTaker() {
  try {
    const topSymbols = Object.keys(cache.tickers)
      .filter((s) => cache.tickers[s].volume > 10000000)
      .slice(0, 30);

    const promises = topSymbols.map((sym) =>
      safeFetch(
        CONFIG.BINANCE_FUTURES + '/takerlongshortRatio?symbol=' + sym + 'USDT&period=1h&limit=4',
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
    const topSymbols = Object.keys(cache.tickers)
      .filter((s) => cache.tickers[s].volume > 10000000)
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

/* 7. LIQUIDATION DATA — from Binance Futures forceOrders */
async function fetchLiquidations() {
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

/* ═══ API ROUTES ═══ */

/* Main endpoint — returns ALL data.
   Snapshot is built at most once per API_ALL_TTL_MS and shared across
   every concurrent client, so a burst of 500 dashboards still costs a
   single serialization pass. */
let apiAllSnapshot = null;
let apiAllSnapshotAt = 0;
function buildApiAllSnapshot() {
  return {
    tickers: cache.tickers,
    fr: cache.fr,
    oi: cache.oi,
    ls: cache.ls,
    taker: cache.taker,
    liq: cache.liq,
    depth: cache.depth,
    market: cache.market,
    meta: {
      coins: Object.keys(cache.tickers).length,
      lastUpdate: cache.lastUpdate,
      uptime: Math.floor(process.uptime()),
      version: '10.1',
      snapshotAt: Date.now(),
    },
  };
}
app.get('/api/all', (req, res) => {
  const now = Date.now();
  if (!apiAllSnapshot || now - apiAllSnapshotAt > CONFIG.API_ALL_TTL_MS) {
    apiAllSnapshot = buildApiAllSnapshot();
    apiAllSnapshotAt = now;
  }
  res.set('Cache-Control', 'public, max-age=' + Math.ceil(CONFIG.API_ALL_TTL_MS / 1000));
  res.json(apiAllSnapshot);
});

/* Health check */
app.get('/api/health', (req, res) => {
  const age = Date.now() - (cache.lastUpdate.tickers || 0);
  res.json({
    status: age < 30000 ? 'healthy' : age < 60000 ? 'stale' : 'down',
    coins: Object.keys(cache.tickers).length,
    fr: Object.keys(cache.fr).length,
    oi: Object.keys(cache.oi).length,
    ls: Object.keys(cache.ls).length,
    uptime: Math.floor(process.uptime()),
    lastUpdate: cache.lastUpdate,
  });
});

/* Telegram notification proxy — allowlist-based HTML sanitization.
   Telegram accepts only a small HTML subset (b, strong, i, em, u, s, code, pre, a).
   We escape everything, then re-introduce a controlled set of tags. */
function sanitizeTelegramHtml(raw) {
  if (typeof raw !== 'string') return '';
  /* Cap length — Telegram's hard limit is 4096 */
  const input = raw.slice(0, 4000);
  /* 1. Escape all HTML-significant chars */
  const escaped = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  /* 2. Re-enable an allowlist of simple tags (no attributes accepted) */
  const simpleTags = ['b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre'];
  let out = escaped;
  simpleTags.forEach((tag) => {
    const open = new RegExp('&lt;' + tag + '&gt;', 'gi');
    const close = new RegExp('&lt;/' + tag + '&gt;', 'gi');
    out = out.replace(open, '<' + tag + '>').replace(close, '</' + tag + '>');
  });
  return out;
}

/* Constant-time string comparison to defeat timing oracles on the secret. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

app.post('/notify', async (req, res) => {
  if (!CONFIG.TG_BOT_TOKEN || !CONFIG.TG_CHAT_ID) {
    return res.status(503).json({ ok: false, error: 'Telegram not configured' });
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
    setInterval(fetchMarket, jitter(CONFIG.MARKET_INTERVAL))
  );
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

/* Start server */
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  startDataLoops();
});

/* Graceful shutdown — stop accepting new connections, cancel all refresh
   timers, then exit. Gives in-flight requests a 10s grace window. */
function shutdown(signal) {
  console.log('[SHUTDOWN] Received ' + signal + ', draining...');
  refreshTimers.forEach(clearInterval);
  refreshTimers.length = 0;
  server.close(function () {
    console.log('[SHUTDOWN] HTTP server closed');
    process.exit(0);
  });
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
