/* NEXUS PRO — portfolio, predictions, and signal-history storage.
   Owns four persisted stores plus a small set of read/write helpers
   that don't depend on the rest of app.js logic.

   Stores
     - portfolio    (key: 'nxp10')     — manual holdings { sym, amt, bp }
     - predictions  (key: 'nxpred10')  — saved scoring predictions, scored
                                          12 h after creation by getAcc()
     - activeTrades (key: 'nxTrades')  — live + closed trades, written to
                                          by openTrade / closeTrade in app.js
     - sigHist      (key: 'nxsig10')   — first-seen / last-seen / count per
                                          sym+type signal, used to age signals

   The trade lifecycle (openTrade / closeTrade / monitorTrades) lives in
   app.js because it pulls in too many cross-cutting deps (factor
   snapshots, whale profit-taking, Telegram exit alerts, processTradeOutcome
   from the monitor). This module is the boundary between *state* and
   *logic*: app.js writes; this module reads + persists.

   Cross-file deps resolved at call time:
     - storage:  safeGetJSON, safeSetJSON  (src/storage.js)
     - utils:    fmt, fP, esc, t           (src/utils.js, src/translations.js)
     - app.js:   T (price ticker), COL (colors), closeMo (modal helper) */

/* ─── persisted stores ─────────────────────────────────────────── */
var portfolio = safeGetJSON('nxp10', []);
var predictions = safeGetJSON('nxpred10', []);
var activeTrades = safeGetJSON('nxTrades', []);
var sigHist = safeGetJSON('nxsig10', {});

/* ─── signal history ───────────────────────────────────────────── */

/* Record a sighting of (sym, type) at the given price. Accepts legacy
   numeric entries (just the firstSeen timestamp) and migrates them to
   the richer { firstSeen, lastSeen, priceAtDetection, count } shape on
   first touch. Resets the entry if it's been quiet for more than an
   hour (treat as a new signal). */
function recSig(sym, type, price) {
  var k = sym + '_' + type;
  var now = Date.now();
  var existing = sigHist[k];
  if (typeof existing === 'number') {
    existing = { firstSeen: existing, lastSeen: now, priceAtDetection: price || 0, count: 1 };
    sigHist[k] = existing;
  }
  if (!existing || now - existing.lastSeen > 3600000) {
    sigHist[k] = { firstSeen: now, lastSeen: now, priceAtDetection: price || 0, count: 1 };
  } else {
    existing.lastSeen = now;
    existing.count++;
  }
  safeSetJSON('nxsig10', sigHist);
  return sigHist[k];
}

/* Return the firstSeen timestamp for a (sym, type) signal, falling
   back to "now" if the entry doesn't exist. Handles legacy entries. */
function getSigTime(sym, type) {
  var v = sigHist[sym + '_' + type];
  if (!v) return Date.now();
  if (typeof v === 'number') return v;
  return v.firstSeen || Date.now();
}

/* ─── predictions / accuracy ───────────────────────────────────── */

/* Save a prediction snapshot. Capped at the most recent 100 entries
   so the journal can't grow unbounded. */
function savePred(sym, p, tgt, sc) {
  predictions.push({
    sym: sym,
    price: p,
    target: tgt,
    score: sc,
    time: Date.now(),
    checked: false,
    hit: false,
    partial: false,
  });
  if (predictions.length > 100) predictions = predictions.slice(-100);
  safeSetJSON('nxpred10', predictions);
}

/* Resolve all unchecked predictions older than 12 h, then return
   { total, hits, partials, rate } across the resolved set.
   Hit:  >= 5 % gain.   Partial:  2-5 % gain.   Otherwise: miss.
   Partials count as 0.5 of a hit in the rate calculation. */
function getAcc() {
  var changed = false;
  predictions.forEach(function (p) {
    if (!p.checked && Date.now() - p.time > 12 * 3600 * 1000) {
      var cur = T[p.sym];
      if (cur) {
        p.checked = true;
        var gain = ((cur.p - p.price) / p.price) * 100;
        p.hit = gain >= 5;
        p.partial = gain >= 2 && gain < 5;
        p.finalPrice = cur.p;
        p.pnl = gain;
        changed = true;
      }
    }
  });
  if (changed) safeSetJSON('nxpred10', predictions);
  var c = predictions.filter(function (p) {
    return p.checked;
  });
  var hits = c.filter(function (p) {
    return p.hit;
  }).length;
  var partials = c.filter(function (p) {
    return p.partial;
  }).length;
  return {
    total: c.length,
    hits: hits,
    partials: partials,
    rate: c.length > 0 ? Math.round(((hits + partials * 0.5) / c.length) * 100) : 0,
  };
}

/* ─── portfolio CRUD ───────────────────────────────────────────── */

function sP() {
  safeSetJSON('nxp10', portfolio);
}

function addPort() {
  var raw = document.getElementById('aSym').value.toUpperCase().trim();
  /* Whitelist symbol: A-Z and 0-9 only, max 10 chars (largest real
     ticker is ~6, so 10 is generous; rules out HTML / quotes). */
  var sym = raw.replace(/[^A-Z0-9]/g, '').slice(0, 10);
  var amt = +document.getElementById('aAmt').value;
  var pr = +document.getElementById('aPr').value;
  if (!sym || !amt || amt <= 0 || !isFinite(amt)) return;
  if (pr && (pr < 0 || !isFinite(pr))) return;
  portfolio.push({ sym: sym, amt: amt, bp: pr });
  sP();
  closeMo('addMo');
  renderPort();
}

function rmPort(i) {
  portfolio.splice(i, 1);
  sP();
  renderPort();
}

/* Render the portfolio list. Numbers go through fmt()/fP(); the user-
   supplied symbol is escaped through esc() even though addPort()
   already restricts the alphabet — defense in depth. */
function renderPort() {
  var tV = 0;
  var tC = 0;
  portfolio.forEach(function (p) {
    var d = T[p.sym];
    if (d) {
      tV += d.p * p.amt;
      tC += p.bp * p.amt;
    }
  });
  var pnl = tC > 0 ? ((tV - tC) / tC) * 100 : 0;
  document.getElementById('pVal').textContent = tV > 0 ? fmt(tV) : '$0';
  var pE = document.getElementById('pCh');
  if (tC > 0) {
    pE.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + '%';
    pE.style.color = pnl >= 0 ? 'var(--up)' : 'var(--dn)';
  } else {
    pE.textContent = t('add_coins');
    pE.style.color = 'var(--t3)';
  }
  document.getElementById('pList').innerHTML = portfolio.length
    ? portfolio
        .map(function (p, i) {
          var d = T[p.sym];
          var cp = d ? d.p : 0;
          var v = cp * p.amt;
          var rowPnl = p.bp > 0 ? ((cp - p.bp) / p.bp) * 100 : 0;
          var bg = COL[p.sym] || '#444';
          return (
            '<div class="port-i"><div style="display:flex;align-items:center;gap:8px"><div class="cr-ic" style="background:' +
            bg +
            '0a;color:' +
            bg +
            ';border:1px solid ' +
            bg +
            '22;width:26px;height:26px;font-size:9px">' +
            esc(p.sym.slice(0, 2)) +
            '</div><div><div class="cr-n">' +
            esc(p.sym) +
            '</div><div class="cr-sub">' +
            p.amt +
            ' × ' +
            fP(cp) +
            '</div></div></div><div style="text-align:left"><div class="cr-p">' +
            fmt(v) +
            '</div><div style="font-family:var(--fm);font-size:9px;font-weight:700;color:' +
            (rowPnl >= 0 ? 'var(--up)' : 'var(--dn)') +
            '">' +
            (p.bp > 0 ? (rowPnl >= 0 ? '+' : '') + rowPnl.toFixed(1) + '%' : '--') +
            '</div><div style="font-size:7px;color:var(--t3);cursor:pointer" onclick="rmPort(' +
            i +
            ')">🗑</div></div></div>'
          );
        })
        .join('')
    : '<div class="empty"><div class="empty-ic">💼</div><div class="empty-tx">' +
      t('empty_port') +
      '</div></div>';
}
