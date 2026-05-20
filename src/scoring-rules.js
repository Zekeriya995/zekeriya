/* NEXUS PRO — unified scoring rules registry.
 *
 * Single source of truth for scanner scoring rules consumed by BOTH
 * the server (src/scanner-engine.js) and the client (app.js
 * quickScan, future PR). The parity ratchet: every rule migrated
 * here becomes structurally impossible to drift between the two
 * sides — the test runner imports this file and pins the contract.
 *
 * Phase 2.A.1 PR A (this file's first incarnation) ships 5
 * representative simple rules to prove the loader pattern + the
 * server-side wiring. Subsequent PRs migrate the remaining ~40
 * rules in small batches (per docs/SCANNER_UNIFIED_RULES_REGISTRY_DESIGN.md
 * §4 "parity ratchet").
 *
 * Loader pattern (UMD-lite, matches src/utils.js) at file bottom:
 * works as CommonJS on Node AND as a window global in the browser.
 * Zero build step — same convention the rest of the codebase uses.
 *
 * Rule shape:
 *   {
 *     id:        string  — stable identifier (matches inline comment
 *                          tag in the migrating files for traceability)
 *     weight:    number  — added to the running score when the rule fires
 *     tag:       string  — pushed to the signal's tag list (use null if
 *                          a rule contributes score with no UI tag)
 *     condition: (ctx) => bool — pure predicate. MUST NOT mutate ctx,
 *                                 MUST NOT close over external state.
 *   }
 *
 * Expected `ctx` shape (built by the consumer before iterating rules):
 *   {
 *     isTier1:  boolean
 *     volume:   number  — 24h quote volume in USD
 *     change:   number  — 24h percentage change
 *   }
 *
 * Adding a new rule: append to RULES. Adding a new field to ctx:
 * coordinate with src/scanner-engine.js's buildRuleCtx() AND the
 * eventual client-side equivalent. Same constraint applies to
 * THRESHOLDS — every consumer must agree on the same numbers, which
 * is the whole point.
 */

'use strict';

const THRESHOLDS = Object.freeze({
  ULTRA: 100,
  STRONG: 70,
  MEDIUM: 50,
  WEAK_MIN: 30, // below this → rejected by qualityFilter / runScannerPass
  /* Wash-trading guard — moved here from scanner-engine.js constants
     to make it discoverable when reviewing thresholds. The actual
     reject still lives in scoreSymbol because it returns early
     before any rule evaluates. */
  WASH_VOLUME_FLOOR: 500_000_000,
  WASH_OI_FLOOR: 100_000,
});

const RULES = Object.freeze([
  {
    id: 'TIER1_BONUS',
    weight: 10,
    tag: '🏆TOP100',
    condition: (ctx) => ctx.isTier1 === true,
  },
  {
    id: 'NEW_BONUS',
    weight: 2,
    tag: '🔍NEW',
    condition: (ctx) => ctx.isTier1 === false,
  },
  {
    id: 'SILENT_ACCUMULATION',
    weight: 25,
    tag: '🐋ACC',
    condition: (ctx) => ctx.volume > 5e7 && Math.abs(ctx.change) < 2,
  },
  {
    id: 'EARLY_ENTRY',
    weight: 20,
    tag: '🔍EARLY',
    condition: (ctx) => ctx.volume > 3e7 && ctx.change >= 0.3 && ctx.change < 2,
  },
  {
    id: 'STEALTH',
    weight: 15,
    tag: '🔍STEALTH',
    condition: (ctx) => ctx.volume > 8e7 && ctx.change >= 0.5 && ctx.change < 3,
  },
]);

/* applyRules(ctx) — pure function. Runs every rule against the ctx
   and returns { scoreDelta, tagsDelta }. The consumer adds the
   deltas to its running score / tags. Rules are evaluated in array
   order, but since each rule's condition is independent, order
   doesn't affect the result (so long as the tag list is later
   sorted or its insertion order is treated as canonical). */
function applyRules(ctx) {
  let scoreDelta = 0;
  const tagsDelta = [];
  for (const rule of RULES) {
    if (rule.condition(ctx)) {
      scoreDelta += rule.weight;
      if (rule.tag) tagsDelta.push(rule.tag);
    }
  }
  return { scoreDelta, tagsDelta };
}

/* UMD-lite loader. Server (`require('./scoring-rules')`) gets the
   module exports; browser (`<script src=".../scoring-rules.js">`)
   gets a `window.SCORING_RULES` global with the same shape. The
   module check goes first because the server's `require` runtime
   does NOT define `window`. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RULES, THRESHOLDS, applyRules };
} else if (typeof window !== 'undefined') {
  window.SCORING_RULES = { RULES, THRESHOLDS, applyRules };
}
