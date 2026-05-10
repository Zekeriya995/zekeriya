/* NEXUS PRO — user-defined custom alerts engine.

   Pure rule evaluator. The user crafts an alert through the PWA
   ("ping me when BTC hits $100K", "ping me when ETH RSI > 80") and
   the proxy persists it on data/user-alerts.json. Every minute the
   server runs evaluateAlert against the warm cache and fires a push
   for whichever rules matched, then either deletes them (one-shot)
   or refreshes their lastFiredAt for repeat alerts.

   Supported predicates — keyed off either the live cache.tickers
   row, the indicator engine output, or the scanner pass:
     price>=X, price<=X        — spot price thresholds
     change>=X, change<=X      — 24-hour change in percent
     rsi>=X,   rsi<=X          — 15m RSI from indicator-engine
     score>=X                  — server-side scanner score
   The grammar is deliberately minimal so the rule cannot ship code
   that runs on the proxy. */

'use strict';

const ALLOWED_FIELDS = new Set(['price', 'change', 'rsi', 'score']);
const ALLOWED_OPS = new Set(['>=', '<=']);
const MAX_PER_USER = 20;

/* parseRule(spec) → { field, op, value } | null. Pure parser; the
   caller decides what to do with a malformed string. */
function parseRule(spec) {
  if (typeof spec !== 'string') return null;
  const m = spec.replace(/\s+/g, '').match(/^([a-z]+)(>=|<=)(-?\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const field = m[1].toLowerCase();
  const op = m[2];
  const value = parseFloat(m[3]);
  if (!ALLOWED_FIELDS.has(field)) return null;
  if (!ALLOWED_OPS.has(op)) return null;
  if (!isFinite(value)) return null;
  return { field, op, value };
}

/* Validate a freshly-submitted alert before persisting. Returns
   `null` on success, an Arabic error message string on failure so
   the PWA can surface it directly. */
function validateAlertInput(input, existingCount) {
  if (!input || typeof input !== 'object') return 'invalid';
  if (typeof input.sym !== 'string' || !input.sym) return 'sym_required';
  if (input.sym.length > 12) return 'sym_too_long';
  if (typeof input.rule !== 'string' || !input.rule) return 'rule_required';
  if (!parseRule(input.rule)) return 'rule_invalid';
  if (existingCount >= MAX_PER_USER) return 'limit_reached';
  return null;
}

/* Read the relevant field for `rule.field` from the server's caches.
   Returns null when the input isn't there yet (e.g. no indicator pass
   has run for this symbol) so evaluateAlert treats it as "not fired"
   instead of throwing. */
function readField(rule, sym, cache) {
  const t = cache.tickers && cache.tickers[sym];
  switch (rule.field) {
    case 'price':
      return t && typeof t.price === 'number' ? t.price : null;
    case 'change':
      return t && typeof t.change === 'number' ? t.change : null;
    case 'rsi': {
      const ind = cache.indicators && cache.indicators[sym];
      return ind && typeof ind.rsi === 'number' ? ind.rsi : null;
    }
    case 'score': {
      const sig = (cache.signals || []).find((s) => s.s === sym);
      return sig && typeof sig.score === 'number' ? sig.score : null;
    }
    default:
      return null;
  }
}

/* evaluateAlert(alert, cache) → boolean. Returns true when the rule
   currently holds, false otherwise (including missing data). */
function evaluateAlert(alert, cache) {
  if (!alert || !alert.sym || !alert.rule) return false;
  const rule = parseRule(alert.rule);
  if (!rule) return false;
  const value = readField(rule, alert.sym, cache);
  if (value === null) return false;
  if (rule.op === '>=') return value >= rule.value;
  if (rule.op === '<=') return value <= rule.value;
  return false;
}

/* runAlertsCheck(alerts, cache, now) → { fired, kept, removed }
   - fired: alerts whose rule matched this tick (caller pushes them)
   - kept:  alerts that should remain in storage (one-shot=false, or
            still cooling down)
   - removed: alerts the caller should drop from storage
   Pure function: doesn't mutate inputs, doesn't talk to push.
   The caller adds a `lastFiredAt` to repeat alerts so we can apply
   the cooldown without persisting it inside this module. */
function runAlertsCheck(alerts, cache, now) {
  now = now || Date.now();
  const fired = [];
  const kept = [];
  const removed = [];
  if (!Array.isArray(alerts)) return { fired, kept, removed };
  for (const a of alerts) {
    if (!evaluateAlert(a, cache)) {
      kept.push(a);
      continue;
    }
    /* Repeat alerts respect a 30-minute cooldown so a price hovering
       at the threshold doesn't fire every minute. One-shots never
       cool down — they fire once and disappear. */
    if (!a.repeat) {
      fired.push(a);
      removed.push(a.id);
      continue;
    }
    /* Distinguish "never fired" (lastFiredAt missing) from "fired
       recently" (lastFiredAt is a real timestamp, even 0). A repeat
       alert that has never matched fires on first match regardless
       of cooldown; the cooldown only applies once lastFiredAt has
       been stamped. */
    if (a.lastFiredAt != null && now - a.lastFiredAt < 30 * 60 * 1000) {
      kept.push(a);
      continue;
    }
    fired.push(a);
    kept.push({ ...a, lastFiredAt: now });
  }
  return { fired, kept, removed };
}

module.exports = {
  ALLOWED_FIELDS,
  ALLOWED_OPS,
  MAX_PER_USER,
  parseRule,
  validateAlertInput,
  readField,
  evaluateAlert,
  runAlertsCheck,
};
