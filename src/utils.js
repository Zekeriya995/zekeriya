/* NEXUS PRO — pure helper functions.
   Nothing here depends on any app-level global: safe to load early. */

/* Compact money format: $1.2B / $34.5M / $678.0K / $123 */
function fmt(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

/* Price format — more precision for sub-dollar coins */
function fP(p) {
  if (!p || isNaN(p)) return '$0';
  if (p >= 1e3) return '$' + p.toLocaleString('en', { maximumFractionDigits: 2 });
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toFixed(6);
}

/* HTML escape — wrap API-derived strings that enter innerHTML */
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* Tagged template for safe HTML. Every `${value}` interpolation is passed
   through esc(), so user / API input can be dropped in without
   hand-escaping. The static template parts pass through untouched, so
   markup you literally wrote in the source is preserved.
   Usage:  el.innerHTML = h`<div>${user.name} bought ${coin}</div>`;
   For intentionally-raw HTML, wrap the value with rawHtml() (rarely needed). */
function h(strings) {
  var out = strings[0];
  for (var i = 1; i < arguments.length; i++) {
    var v = arguments[i];
    out += (v && v.__rawHtml ? v.value : esc(v)) + strings[i];
  }
  return out;
}

/* Escape hatch for the h tag — mark a string as already-safe HTML. */
function rawHtml(s) {
  return { __rawHtml: true, value: s == null ? '' : String(s) };
}

/* Tiny setter so every innerHTML-write in the app can be audited from one
   place. Accepts only strings; pairs naturally with h``. */
function setHtml(el, html) {
  if (el) el.innerHTML = typeof html === 'string' ? html : '';
}

/* NaN-safe change % — falls back to 0 for NaN/undefined/null */
function safeC(c) {
  return c && !isNaN(c) ? c : 0;
}

/* Relative Strength Index over `period` closes (default 14) */
function calcRSI(c, p) {
  p = p || 14;
  if (c.length < p + 1) return 50;
  var g = 0,
    l = 0;
  for (var i = c.length - p; i < c.length; i++) {
    var d = c[i] - c[i - 1];
    if (d > 0) g += d;
    else l += Math.abs(d);
  }
  return 100 - 100 / (1 + g / Math.max(l, 0.001));
}

/* MACD (12/26/9) — returns { h: macdLine, signal, cross } */
function calcMACD(c) {
  if (c.length < 26) return { h: 0, signal: 0, cross: 'none' };
  var ema = function (d, p) {
    var k = 2 / (p + 1),
      e = d[0];
    for (var i = 1; i < d.length; i++) e = d[i] * k + e * (1 - k);
    return e;
  };
  var macdLine = ema(c.slice(-12), 12) - ema(c, 26);
  var macdHist = [];
  for (var i = 26; i <= c.length; i++) {
    macdHist.push(ema(c.slice(i - 12, i), 12) - ema(c.slice(0, i), 26));
  }
  var signal = macdHist.length >= 9 ? ema(macdHist.slice(-9), 9) : macdLine;
  var prev = macdHist.length >= 2 ? macdHist[macdHist.length - 2] : 0;
  var cross =
    macdLine > signal && prev <= signal
      ? 'bull'
      : macdLine < signal && prev >= signal
        ? 'bear'
        : 'none';
  return { h: macdLine, signal: signal, cross: cross };
}

/* Exponential moving average over `period` values.
   Seeds with the SMA of the first `period` values, then applies the
   canonical EMA recurrence. Returns null when data is missing or
   shorter than `period`. */
function calcEMA(data, period) {
  if (!data || data.length < period) return null;
  var k = 2 / (period + 1);
  var ema =
    data.slice(0, period).reduce(function (a, b) {
      return a + b;
    }, 0) / period;
  for (var i = period; i < data.length; i++) {
    ema = (data[i] - ema) * k + ema;
  }
  return ema;
}
