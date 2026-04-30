/* NEXUS PRO — UI bridge for the source-health monitor.

   Pure data lives in src/source-health.js. This file owns the
   rendering of the "Data Sources" side panel: the row-per-source
   list, the click handler for the "Check now" button, and the
   summary line at the bottom.

   Kept in its own module so source-health.js stays testable without
   a DOM (Node tests load it directly). The catalogue (NEXUS_SOURCES)
   and pingAllSources() are read from the global scope at call time. */

'use strict';

/* Initial render — one neutral row per source, before any probe.
   Re-render on every probe completion. */
function renderSourceHealth() {
  if (typeof document === 'undefined') return;
  var listEl = document.getElementById('srcHealthList');
  if (!listEl || typeof NEXUS_SOURCES === 'undefined') return;

  listEl.innerHTML = NEXUS_SOURCES.map(function (s) {
    var stat = (typeof sourceHealth !== 'undefined' && sourceHealth[s.id]) || null;
    var icon = '⚪';
    var label = '—';
    var color = 'var(--t3)';
    if (stat && stat.lastSuccessAt && (!stat.lastFailAt || stat.lastSuccessAt > stat.lastFailAt)) {
      icon = '✅';
      label = stat.lastLatencyMs + ' ms';
      color = 'var(--up)';
    } else if (stat && stat.lastFailAt) {
      icon = '❌';
      label = stat.lastError || 'fail';
      color = 'var(--dn)';
    }
    var critTag = s.critical ? ' <span style="font-size:8px;color:var(--warn)">●</span>' : '';
    return (
      '<div class="src-health-row" role="listitem" data-src="' +
      esc(s.id) +
      '" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--bdr);font-size:10px">' +
      '<span style="color:var(--t1)">' +
      icon +
      ' ' +
      esc(s.name) +
      critTag +
      '</span>' +
      '<span style="font-family:var(--fm);font-size:9px;color:' +
      color +
      '">' +
      esc(label) +
      '</span>' +
      '</div>'
    );
  }).join('');
}

/* Run the probe, render twice (once with the existing state, once
   after results land), and update the summary line + button label. */
async function runSourceHealthCheck() {
  if (typeof document === 'undefined' || typeof pingAllSources !== 'function') return;
  var btn = document.getElementById('srcHealthRunBtn');
  var listEl = document.getElementById('srcHealthList');
  var sumEl = document.getElementById('srcHealthSummary');
  if (btn) {
    btn.disabled = true;
    /* Don't translate the button label — it's transient; just signal busy. */
    btn.dataset.origLabel = btn.dataset.origLabel || btn.innerHTML;
    btn.innerHTML = '⏳ ' + (typeof t === 'function' ? t('checking') : 'جاري الفحص...');
  }
  if (listEl) listEl.setAttribute('aria-busy', 'true');

  var results;
  try {
    results = await pingAllSources();
  } catch (e) {
    results = [];
  }
  renderSourceHealth();

  if (sumEl) {
    var ok = results.filter(function (r) {
      return r.ok;
    }).length;
    var total = results.length;
    var failedCritical = results.filter(function (r) {
      var spec = NEXUS_SOURCES.find(function (s) {
        return s.id === r.id;
      });
      return !r.ok && spec && spec.critical;
    });
    if (failedCritical.length > 0) {
      sumEl.style.color = 'var(--dn)';
      sumEl.textContent =
        '🚨 ' +
        (typeof t === 'function' ? t('critical_down') : 'مصدر حرج معطّل') +
        ': ' +
        failedCritical
          .map(function (f) {
            return f.name;
          })
          .join(', ');
    } else if (ok === total) {
      sumEl.style.color = 'var(--up)';
      sumEl.textContent =
        '✅ ' +
        (typeof t === 'function' ? t('all_sources_ok') : 'كل المصادر متصلة') +
        ' (' +
        ok +
        '/' +
        total +
        ')';
    } else {
      sumEl.style.color = 'var(--warn)';
      sumEl.textContent =
        '⚠️ ' +
        ok +
        '/' +
        total +
        ' ' +
        (typeof t === 'function' ? t('sources_reachable') : 'متاح');
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.origLabel || '🔍 فحص المصادر الآن';
  }
  if (listEl) listEl.setAttribute('aria-busy', 'false');
}

/* Wire the button on script load. The script tag is `defer` so the
   DOM is parsed by the time this runs. The button + list ids are
   declared in index.html. */
function _wireSourceHealthUI() {
  if (typeof document === 'undefined') return;
  var btn = document.getElementById('srcHealthRunBtn');
  if (btn && !btn._nxBound) {
    btn._nxBound = true;
    btn.addEventListener('click', function () {
      runSourceHealthCheck();
    });
  }
  /* First render — neutral state until the operator clicks. */
  renderSourceHealth();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wireSourceHealthUI);
  } else {
    _wireSourceHealthUI();
  }
}

if (typeof window !== 'undefined') {
  window.renderSourceHealth = renderSourceHealth;
  window.runSourceHealthCheck = runSourceHealthCheck;
}
