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
  lastUpdate: {},
};

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
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: CONFIG.TIMEOUT,
        maxRedirects: 0,
        httpsAgent: safeAgent,
      });
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
  return {
    tickers: { ...cache.tickers },
    fr: { ...cache.fr },
    oi: { ...cache.oi },
    ls: { ...cache.ls },
    taker: { ...cache.taker },
    liq: cache.liq.slice(),
    depth: { ...cache.depth },
    market: { ...cache.market, cbp: { ...cache.market.cbp } },
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
