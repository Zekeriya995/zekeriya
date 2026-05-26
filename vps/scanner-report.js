#!/usr/bin/env node
/* NEXUS PRO — scanner monitoring report.

   One command for forward-monitoring: prints the market regime, the absolute
   + alpha win rates, and the legacy-vs-V2 A/B (net of fees) across several
   windows — so the operator can watch whether V2's edge holds on FORWARD data
   without hand-curling JSON. Run on the VPS (it hits the local proxy):

       npm run scanner-report
       SCANNER_REPORT_BASE=http://host:port npm run scanner-report   # override

   buildReport() is a pure function (no I/O) so it is unit-tested; main() does
   the fetching. Server-only (Node 18+ global fetch); plain CommonJS. */

'use strict';

const WINDOWS = [2, 7, 14, 30];
const BASE = process.env.SCANNER_REPORT_BASE || 'http://127.0.0.1:' + (process.env.PORT || 3000);
/* A challenger (V2) sample below this many surfaced signals is noise — the
   verdict ignores it and the row is flagged '(low)'. The 2-day window is
   almost always below this; the 7/30-day windows clear it. */
const MIN_MEANINGFUL = 20;

function _pct(n) {
  return typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : '—';
}
function _pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/* buildReport(all, abList) — pure. `all` is the /api/all payload (for regime +
   scannerStats); `abList` is the array of /api/scanner/ab results, one per
   window. Returns the formatted multi-line report string. */
function buildReport(all, abList) {
  const lines = ['═══ NEXUS PRO — Scanner Report ═══'];

  const rg = all && all.regime;
  if (rg && rg.regime) {
    const i = rg.inputs || {};
    lines.push(
      'Regime: ' +
        rg.regime +
        ' (score=' +
        rg.trendScore +
        ', btc=' +
        (i.btcStrength || '?') +
        ', breadth=' +
        (i.bullishPct != null ? i.bullishPct + '%' : '?') +
        ')'
    );
  } else {
    lines.push('Regime: (not available)');
  }

  const st = (all && all.scannerStats) || {};
  const alpha = st.alpha || {};
  lines.push('');
  lines.push('Overall win rates:');
  lines.push(
    '  absolute: ' +
      (st.winRate != null ? st.winRate + '%' : '—') +
      '   alpha: ' +
      (alpha.alphaWinRate != null ? alpha.alphaWinRate + '%' : '—') +
      '   evaluated: ' +
      (st.totalEvaluated != null ? st.totalEvaluated : '—')
  );
  const byTier = st.byTier || {};
  if (byTier.ULTRA || byTier.STRONG) {
    const u = byTier.ULTRA || {};
    const s = byTier.STRONG || {};
    lines.push(
      '  by tier: ULTRA ' +
        (u.winRate != null ? u.winRate + '%' : '—') +
        ' (' +
        (u.count || 0) +
        ')   STRONG ' +
        (s.winRate != null ? s.winRate + '%' : '—') +
        ' (' +
        (s.count || 0) +
        ')'
    );
  }

  lines.push('');
  lines.push('A/B — net of fees. champion=legacy; challengers=V2 & Trend:');
  lines.push(
    '  ' + _pad('window', 7) + _pad('legacy', 15) + _pad('V2', 15) + _pad('Trend', 15) + 'n V2/Tr'
  );
  const cell = (p) => (p ? _pct(p.avgNetGain) + '/' + (p.netWinRate || 0) + '%' : '—');
  let v2Better = 0;
  let v2Meaningful = 0;
  let trBeatsLegacy = 0;
  let trBeatsV2 = 0;
  let trMeaningful = 0;
  for (const ab of abList) {
    const label = ab && ab.windowDays ? ab.windowDays + 'd' : '?';
    if (!ab || !ab.champion || !ab.challenger) {
      lines.push('  ' + _pad(label, 7) + '(unavailable)');
      continue;
    }
    const c = ab.champion;
    const v = ab.challenger;
    const tr = ab.challengerTrend; /* absent on older API responses → '—' */
    const vN = v.surfaced || 0;
    const trN = tr ? tr.surfaced || 0 : 0;
    const lowFlag = vN >= MIN_MEANINGFUL && (!tr || trN >= MIN_MEANINGFUL) ? '' : ' (low)';
    lines.push(
      '  ' +
        _pad(label, 7) +
        _pad(cell(c), 15) +
        _pad(cell(v), 15) +
        _pad(cell(tr), 15) +
        vN +
        '/' +
        trN +
        lowFlag
    );
    if (vN >= MIN_MEANINGFUL) {
      v2Meaningful++;
      if (v.avgNetGain > c.avgNetGain) v2Better++;
    }
    if (tr && trN >= MIN_MEANINGFUL) {
      trMeaningful++;
      if (tr.avgNetGain > c.avgNetGain) trBeatsLegacy++;
      if (tr.avgNetGain > v.avgNetGain) trBeatsV2++;
    }
  }

  lines.push('');
  if (v2Meaningful > 0) {
    lines.push(
      'V2 vs legacy: beats on ' + v2Better + '/' + v2Meaningful + ' meaningful window(s).'
    );
  }
  if (trMeaningful > 0) {
    /* Trend is the LIVE profile in a trending regime — the key read now. */
    lines.push(
      'Trend (live in trends): beats V2 on ' +
        trBeatsV2 +
        '/' +
        trMeaningful +
        ', beats legacy on ' +
        trBeatsLegacy +
        '/' +
        trMeaningful +
        ' meaningful window(s).'
    );
  }
  if (v2Meaningful === 0 && trMeaningful === 0) {
    lines.push('Verdict: no window has a meaningful sample yet — keep accumulating.');
  }

  /* Forward (gold-standard): actual net performance of signals really surfaced
     under each profile, from the longest window that carries a `live` block.
     This is THE confirmation of the live trend profile — once its sample grows
     past the noise floor and beats V2, the trend profile is validated. */
  let liveSrc = null;
  for (const a of abList) if (a && a.live) liveSrc = a;
  if (liveSrc) {
    const L = liveSrc.live;
    const lc = (p, name) =>
      name + ' ' + _pct(p.avgNetGain) + '/' + (p.netWinRate || 0) + '% (' + (p.surfaced || 0) + ')';
    lines.push('');
    lines.push('Live (actual signals surfaced under each profile, ' + L.windowDays + 'd):');
    lines.push(
      '  ' + lc(L.legacy, 'legacy') + '   ' + lc(L.v2, 'V2') + '   ' + lc(L.trend, 'trend')
    );
    if ((L.trend.surfaced || 0) < MIN_MEANINGFUL) {
      lines.push(
        '  (trend sample < ' + MIN_MEANINGFUL + ' — not yet conclusive; keep accumulating.)'
      );
    }
  }

  lines.push(
    '(Small-sample windows are noise — weight the larger ones. Forward data is the judge.)'
  );
  return lines.join('\n');
}

async function _getJSON(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function main() {
  let all;
  try {
    all = await _getJSON('/api/all');
  } catch (e) {
    console.error('[scanner-report] cannot reach the proxy at ' + BASE + ' — run this on the VPS.');
    console.error('  (' + e.message + ')');
    process.exit(1);
    return;
  }
  const abList = [];
  for (const d of WINDOWS) {
    try {
      abList.push(await _getJSON('/api/scanner/ab?days=' + d + '&fee=0.2'));
    } catch (e) {
      abList.push({ windowDays: d, error: e.message });
    }
  }
  console.log(buildReport(all, abList));
}

if (require.main === module) main();

module.exports = { buildReport, MIN_MEANINGFUL };
