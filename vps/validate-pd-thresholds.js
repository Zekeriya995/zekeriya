#!/usr/bin/env node
/* NEXUS PRO — P&D threshold quantitative validator.
 *
 * The deliverable promised in Phase 1.0 (SCANNER_AUDIT_2026_05_15.md §6).
 * Reads data/scanner-history.json, aggregates per-tag outcomes via the
 * shared src/scanner-tag-stats module, and prints a focused report on
 * the P&D / MANIP family of suppression tags so the engineering team
 * can answer "are these tags actually predicting losses?".
 *
 * Reportable when ≥ 7 days of post-Phase-1.0b data exist (entries
 * persisted before P1.0b have no `tags` field and are excluded). On
 * a fresh deploy, expect mostly empty output — the script becomes
 * meaningful as evaluated entries accumulate.
 *
 * Usage:
 *   node vps/validate-pd-thresholds.js                # default 30-day window
 *   node vps/validate-pd-thresholds.js --days 7       # narrower window
 *   node vps/validate-pd-thresholds.js --json         # machine-readable
 *   node vps/validate-pd-thresholds.js --history PATH # override file path
 *
 * Exit codes:
 *   0  — report rendered (even if empty)
 *   1  — history file missing or unparseable
 *   2  — bad CLI argument
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { computeTagStats } = require('../src/scanner-tag-stats');

const DEFAULT_HISTORY = path.join(__dirname, '..', 'data', 'scanner-history.json');

/* Defensive size cap on the history file. MAX_HISTORY in
   scanner-history.js is 1000 entries, ~200 KB realistically. A 10 MB
   file means something has gone wrong (corrupted write, operator
   hand-edit, attack). Surfaced by pre-merge SRE review. */
const MAX_HISTORY_FILE_SIZE = 10 * 1024 * 1024;

/* JSON output schema version. Bump when the shape of `--json` output
   changes in a breaking way so downstream jq pipelines can detect
   the migration. Surfaced by pre-merge SRE review. */
const JSON_SCHEMA_VERSION = 1;

/* Tag families we care about. Each entry is a regex against the tag
   string. The boundary anchors `(?::|$)` ensure `P&D_RISK` doesn't
   accidentally match a future `P&D_RISK_OVERRIDDEN` tag, and the
   plain-suffix tags (MANIP_*, ATR_ZONES) are anchored at end-of-string.
   Surfaced by pre-merge correctness review (NIT B3). */
const TAG_FAMILIES = [
  { name: 'P&D_RISK', re: /P&D_RISK(?::|$)/, description: '3+ flags — kill threshold' },
  { name: 'P&D_WARN', re: /P&D_WARN(?::|$)/, description: '2 flags — soft penalty -25' },
  { name: 'MANIP_CAP', re: /MANIP_CAP$/, description: 'Phase 1.2 tier cap (HIGH → STRONG)' },
  { name: 'MANIP_HIGH', re: /MANIP_HIGH$/, description: 'Manipulation HIGH verdict' },
  { name: 'MANIP_MED', re: /MANIP_MED$/, description: 'Manipulation MEDIUM verdict' },
  { name: 'ATR_ZONES', re: /ATR_ZONES$/, description: 'Phase 2.A.4 — ATR-aware SL/TP' },
];

function parseArgs(argv) {
  const opts = { days: 30, json: false, historyPath: DEFAULT_HISTORY };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') {
      const v = parseInt(argv[++i], 10);
      if (!Number.isFinite(v) || v < 1 || v > 365) {
        console.error('--days must be 1..365');
        process.exit(2);
      }
      opts.days = v;
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--history') {
      const v = argv[++i];
      if (typeof v !== 'string' || v.length === 0) {
        console.error('--history requires a path');
        process.exit(2);
      }
      opts.historyPath = v;
    } else if (a === '--help' || a === '-h') {
      console.log('usage: node vps/validate-pd-thresholds.js [--days N] [--json] [--history PATH]');
      process.exit(0);
    } else {
      console.error('unknown argument:', a);
      process.exit(2);
    }
  }
  return opts;
}

function loadHistory(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error('history file not found:', filePath);
    console.error('(this is expected on a fresh deploy — try again after a few hours)');
    process.exit(1);
  }
  /* Size cap — refuse to load a file larger than the audit's worst-case
     bound (MAX_HISTORY = 1000 entries × ~200 bytes = ~200 KB, with
     50x headroom). A 10 MB+ file is symptomatic of corruption or a
     hand-edit and shouldn't be silently parsed into RAM. */
  try {
    const sz = fs.statSync(filePath).size;
    if (sz > MAX_HISTORY_FILE_SIZE) {
      console.error(
        'history file too large:',
        sz,
        'bytes (limit',
        MAX_HISTORY_FILE_SIZE,
        '). investigate.'
      );
      process.exit(1);
    }
  } catch (err) {
    console.error('stat failed on history file:', err.message);
    process.exit(1);
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      console.error('history file is not a JSON array');
      process.exit(1);
    }
    return data;
  } catch (err) {
    console.error('failed to parse history file:', err.message);
    process.exit(1);
  }
}

/* Compute baseline (all evaluated entries) and family-specific stats
   (entries that carried at least one tag matching the family regex). */
function computeFamilyStats(history, days, now) {
  const allStats = computeTagStats(history, { daysBack: days, minSamples: 1, now });
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const baseline = history.filter(
    (h) => h && h.evaluated && Array.isArray(h.tags) && h.tags.length > 0 && h.recordedAt >= cutoff
  );

  const baselineStats = aggregate(baseline);
  const families = TAG_FAMILIES.map((fam) => {
    const matching = baseline.filter((h) => h.tags.some((t) => fam.re.test(t)));
    return {
      name: fam.name,
      description: fam.description,
      stats: aggregate(matching),
    };
  });

  return { allStats, baselineStats, families, baselineCount: baseline.length };
}

function aggregate(entries) {
  if (!entries.length) {
    return { count: 0, wins: 0, losses: 0, winRate: null, avgGain: null };
  }
  const wins = entries.filter((h) => h.outcome === 'win').length;
  const losses = entries.filter((h) => h.outcome === 'loss').length;
  const sumPct = entries.reduce((s, h) => s + (h.pctChange || 0), 0);
  return {
    count: entries.length,
    wins,
    losses,
    winRate: Math.round((wins / entries.length) * 100),
    avgGain: Math.round((sumPct / entries.length) * 100) / 100,
  };
}

function renderTextReport(report, days) {
  const lines = [];
  lines.push('');
  lines.push('═════════════════════════════════════════════════════════════════════');
  lines.push(`  P&D / MANIP THRESHOLD VALIDATOR — last ${days} days`);
  lines.push('═════════════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Total tagged signals in window:  ${report.baselineCount}`);
  lines.push(`Pre-1.0b entries excluded:       ${report.allStats.totalWithoutTags}`);
  lines.push('');

  if (report.baselineCount === 0) {
    lines.push('No tagged signals yet — nothing to validate.');
    lines.push('(Phase 1.0b started persisting tags on 2026-05-16.');
    lines.push(' Wait at least 24h post-deploy before re-running.)');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('────────────────────  BASELINE  ────────────────────');
  lines.push(
    `  count=${report.baselineStats.count}  wins=${report.baselineStats.wins}` +
      `  losses=${report.baselineStats.losses}  winRate=${report.baselineStats.winRate}%` +
      `  avgGain=${report.baselineStats.avgGain}%`
  );
  lines.push('');
  lines.push('────────────────────  BY TAG FAMILY  ───────────────');
  lines.push('Family       Count  Wins  Losses  WinRate  AvgGain  vs Baseline');
  for (const fam of report.families) {
    if (fam.stats.count === 0) {
      lines.push(`${fam.name.padEnd(12)} 0      —     —       —        —        (no firings yet)`);
      continue;
    }
    const delta =
      fam.stats.winRate !== null && report.baselineStats.winRate !== null
        ? fam.stats.winRate - report.baselineStats.winRate
        : null;
    const deltaStr = delta === null ? '—' : (delta > 0 ? '+' : '') + delta + 'pp';
    lines.push(
      `${fam.name.padEnd(12)} ` +
        `${String(fam.stats.count).padEnd(6)} ` +
        `${String(fam.stats.wins).padEnd(5)} ` +
        `${String(fam.stats.losses).padEnd(7)} ` +
        `${(fam.stats.winRate + '%').padEnd(8)} ` +
        `${(fam.stats.avgGain + '%').padEnd(8)} ` +
        deltaStr
    );
  }
  lines.push('');
  lines.push('────────────────────  INTERPRETATION  ──────────────');
  lines.push('A negative "vs Baseline" delta on a SUPPRESSION tag (P&D_*,');
  lines.push('MANIP_*) means the tag correctly identifies bad signals.');
  lines.push('A positive delta means the tag is currently picking BETTER');
  lines.push('signals than baseline — re-examine the threshold.');
  lines.push('');
  lines.push('Note: family counts may OVERLAP — a single signal carrying');
  lines.push('multiple suppression tags (e.g., P&D_WARN AND MANIP_CAP)');
  lines.push('contributes to BOTH family rows. Sum-of-counts ≥ baseline.');
  lines.push('');
  lines.push('Note: ATR_ZONES win-rate is biased downward by the legacy');
  lines.push('fixed-threshold outcome evaluator (see CHANGELOG Phase 2.A.4');
  lines.push('known limitation). Treat ATR_ZONES vs legacy comparisons as');
  lines.push('suggestive — proper fix is a Phase 4 deliverable.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const opts = parseArgs(process.argv);
  const now = Date.now();
  const history = loadHistory(opts.historyPath);
  const report = computeFamilyStats(history, opts.days, now);
  if (opts.json) {
    /* Schema-versioned JSON envelope. Downstream jq pipelines should
       gate on `schema` before parsing the body. Any breaking change
       to the family / aggregate shape bumps JSON_SCHEMA_VERSION so
       consumers fail loudly instead of silently parsing a new shape. */
    console.log(
      JSON.stringify(
        {
          schema: JSON_SCHEMA_VERSION,
          daysBack: opts.days,
          generatedAt: new Date(now).toISOString(),
          ...report,
        },
        null,
        2
      )
    );
  } else {
    console.log(renderTextReport(report, opts.days));
  }
}

if (require.main === module) {
  main();
}

module.exports = { TAG_FAMILIES, computeFamilyStats, aggregate };
