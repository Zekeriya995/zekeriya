/* NEXUS PRO — unified scoring rules registry.
 *
 * Single source of truth for scanner scoring rules consumed by BOTH
 * the server (src/scanner-engine.js) and the client (app.js
 * quickScan, future PR). The parity ratchet: every rule migrated
 * here becomes structurally impossible to drift between the two
 * sides — the test runner imports this file and pins the contract.
 *
 * Migrated rules (20 total — Phase 2.A.1 PR A through PR E,
 * all merged 2026-05-20):
 *   PR A — TIER1_BONUS, NEW_BONUS, SILENT_ACCUMULATION,
 *          EARLY_ENTRY, STEALTH (server first; client followed
 *          in PR B for the accumulation rules)
 *   PR C — TIER2_BONUS; NEW_BONUS gate extended for 3-way
 *          mutual exclusion (precedence encoded in conditions)
 *   PR D — FR_VERY_NEG, FR_MILDLY_NEG, FR_OVEREXTENDED,
 *          LS_SHORTS, COINALYZE_FR_NEG
 *   PR E — MTF_BULL_FULL/PARTIAL, MTF_BEAR_FULL/PARTIAL,
 *          RSI_OS, RSI_OB, MACD_BULL_CROSS, MACD_BEAR_CROSS
 *
 * Plus FALLING_KNIFE (PR #108) — a defensive suppression rule
 * native to the registry (not a migration).
 *
 * Known un-expressible patterns remaining inline (out of scope
 * for the current registry shape):
 *   - Multi-tag tier rules (whaleWave A/B/C/D): would need a
 *     `tagFn(ctx)` field. Stays inline in app.js for now.
 *   - Non-additive scoring (P&D KILL → score floor at -100):
 *     `scoreFn(score, ctx)` field or a separate kind: 'modifier'.
 *     Stays inline.
 *   - Dynamic tag strings ('📗BID:Nx'): need `tagFn(ctx)` field.
 *   - Compound rules reading earlier rule outputs: no inter-rule
 *     state today; would need a two-pass evaluator.
 *   - MACD histogram tie-breaker (+3 / -3 with NO tag, fires
 *     when cross is neither 'bull' nor 'bear'): tagless score
 *     adjustment doesn't fit the current rule shape. Stays
 *     inline in src/scanner-engine.js gated on no-cross.
 *
 * Phase 2.A.1 PR A (this file's first incarnation) shipped 5
 * representative simple rules to prove the loader pattern + the
 * server-side wiring. Subsequent PRs (B/C/D/E) migrated the
 * full parity-ratchet sequence per
 * docs/SCANNER_UNIFIED_RULES_REGISTRY_DESIGN.md §4.
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
 *     isTier1:         boolean
 *     isTier2:         boolean (CLIENT-only — server omits this field;
 *                               TIER2_BONUS strict-checks `=== true` so
 *                               an absent isTier2 cleanly no-ops on the
 *                               server side. Added in PR C.)
 *     volume:          number — 24h quote volume in USD
 *     change:          number — 24h percentage change
 *     frRate:          number — futures funding rate as a decimal (e.g.
 *                               0.0001 = 0.01%). Both sides populate when
 *                               fr data is available; rules strict-check
 *                               typeof === 'number' so missing data
 *                               cleanly no-ops. (Added in PR D.)
 *     lsRatio:         number — long/short ratio (server: ctx.ls.ratio;
 *                               client: LS[s].ratio). Strict-checked too.
 *                               (Added in PR D.)
 *     coinalyzeFRRate: number — multi-exchange aggregated FR rate
 *                               (server: ctx.coinalyzeFR.rate;
 *                               client: coinalyzeFR[s].rate via
 *                               /api/all multi-exchange data — the SRE
 *                               review on PR #117 caught that the
 *                               client DOES populate this). Strict-check.
 *                               (Added in PR D.)
 *     mtfStrength:     'full' | 'partial' | undefined  — server-only
 *                      (client has no MTF computation in quickScan).
 *                      Added in PR E.
 *     mtfBias:         'bullish' | 'bearish' | undefined — server-only.
 *                      Added in PR E.
 *     rsi:             number | undefined — server-only (kline-derived
 *                      indicator). Added in PR E.
 *     macdCross:       'bull' | 'bear' | undefined — server-only;
 *                      MACD histogram crossing event. Added in PR E.
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

/* Deep-freeze: outer array AND each rule object. Without freezing
   the inner objects, `RULES[0].weight = 999` would silently mutate
   at runtime. Hardening surfaced by pre-merge correctness review.
   Note that `condition` (a function) cannot be frozen in any
   meaningful sense — but the closure captures no state, so it
   doesn't need to be. */
const RULES = Object.freeze([
  Object.freeze({
    id: 'TIER1_BONUS',
    weight: 10,
    tag: '🏆TOP100',
    /* Strict `=== true` — NOT just truthy. The client-side migration
       (PR B) MUST pass a real boolean for isTier1, not undefined or
       a Set membership result that could be missing. The companion
       NEW_BONUS rule below uses strict `=== false` for the same
       reason. */
    condition: (ctx) => ctx.isTier1 === true,
  }),
  Object.freeze({
    id: 'TIER2_BONUS',
    weight: 5,
    tag: '🥈T2',
    /* Phase 2.A.1 PR C — Option C from the CHANGELOG #109
       architectural-divergence table. The client (`app.js
       quickScan`) has a tier-2 list (`tier2Coins`) the server
       doesn't, so the historical `if(isTier1){...} else if(isTier2)
       {...} else {...}` chain split three ways. Modeling tier-2 as
       its own rule with `ctx.isTier2 === true` lets both sides
       converge on the registry without dragging the tier-2 list
       data into the server: the server passes no `isTier2` field
       (its applyRules ctx omits it), so the strict `=== true`
       check cleanly no-ops on the server side. Net behaviour:
       server unchanged, client now reads tier-2 from the registry.

       The `isTier1 !== true` half of the gate is REQUIRED to
       preserve the inline if/else if/else mutual exclusion. The
       client's `tier2Coins` list (populated from a ranked-by-vol
       slice at app.js:79-81) is NOT enforced disjoint from the
       hardcoded `TIER1` set, so a hot major (BTC, ETH, SOL …)
       can appear in BOTH. Without the tier-1 exclusion, BTC
       would silently start scoring +15 (TIER1 +10 + TIER2 +5)
       instead of +10 — a drift the SRE review of PR #114
       caught. Symmetric with the `isTier2 !== true` gate on
       NEW_BONUS: precedence is TIER1 > TIER2 > NEW. */
    condition: (ctx) => ctx.isTier2 === true && ctx.isTier1 !== true,
  }),
  Object.freeze({
    id: 'NEW_BONUS',
    weight: 2,
    tag: '🔍NEW',
    /* Strict `=== false`: the inline code this replaces was an
       `else` branch which would fire on undefined/null. The strict
       check is INTENTIONAL — both sides must pass a real boolean.
       If undefined isTier1 ever reaches the registry, NEITHER
       TIER1_BONUS nor NEW_BONUS fires, which is safer than silently
       firing NEW_BONUS for what might actually be a tier-1 symbol.

       Phase 2.A.1 PR C: also gate on `isTier2 !== true` so the
       three rules (TIER1, TIER2, NEW) stay mutually exclusive
       under the same combined ctx. `!== true` (not `=== false`)
       is intentional — the server side passes NO `isTier2` field,
       so `undefined !== true` is truthy and NEW_BONUS still fires
       for non-tier-1 server coins exactly as before (preserves
       the pre-PR-C server behaviour bit-for-bit). On the client,
       `isTier2: true/false` is always supplied, so the gate
       correctly excludes tier-2 coins from the NEW branch. */
    condition: (ctx) => ctx.isTier1 === false && ctx.isTier2 !== true,
  }),
  Object.freeze({
    id: 'SILENT_ACCUMULATION',
    weight: 25,
    tag: '🐋ACC',
    condition: (ctx) => ctx.volume > 5e7 && Math.abs(ctx.change) < 2,
  }),
  Object.freeze({
    id: 'EARLY_ENTRY',
    weight: 20,
    tag: '🔍EARLY',
    condition: (ctx) => ctx.volume > 3e7 && ctx.change >= 0.3 && ctx.change < 2,
  }),
  Object.freeze({
    id: 'STEALTH',
    weight: 15,
    tag: '🔍STEALTH',
    condition: (ctx) => ctx.volume > 8e7 && ctx.change >= 0.5 && ctx.change < 3,
  }),
  /* Phase 2.A.1 PR D — FR / LS / coinalyzeFR rules.
     All 5 rules below were inline on BOTH sides pre-PR-D (server's
     scoreSymbol and client's quickScan computed identical conditions).
     This migration is bit-for-bit equivalent on the server AND client.

     The three FR_* rules form a mutually-exclusive precedence chain
     (very-negative beats mildly-negative; positive-overextended is
     a separate range). Encoded directly in conditions so the
     order-independence invariant of the registry holds:

       (-∞, -0.01):  FR_VERY_NEG fires (+12)
       [-0.01, 0):   FR_MILDLY_NEG fires (+5)
       [0, 0.08]:    none fire (matches the inline else if drop-through)
       (0.08, ∞):    FR_OVEREXTENDED fires (-8)

     COINALYZE_FR_NEG is server-only data (the client has no
     coinalyzeFR feed). The strict `typeof === 'number'` gate
     ensures the rule cleanly no-ops on the client where
     `ctx.coinalyzeFRRate` is undefined — same Option-C pattern
     PR C used for TIER2_BONUS. */
  Object.freeze({
    id: 'FR_VERY_NEG',
    weight: 12,
    tag: 'FR⬇️',
    condition: (ctx) => typeof ctx.frRate === 'number' && ctx.frRate < -0.01,
  }),
  Object.freeze({
    id: 'FR_MILDLY_NEG',
    weight: 5,
    tag: 'FR-',
    condition: (ctx) => typeof ctx.frRate === 'number' && ctx.frRate < 0 && ctx.frRate >= -0.01,
  }),
  Object.freeze({
    id: 'FR_OVEREXTENDED',
    weight: -8,
    tag: 'FR⚠️',
    condition: (ctx) => typeof ctx.frRate === 'number' && ctx.frRate > 0.08,
  }),
  Object.freeze({
    id: 'LS_SHORTS',
    weight: 10,
    tag: '🩳SHORTS',
    condition: (ctx) => typeof ctx.lsRatio === 'number' && ctx.lsRatio < 0.8,
  }),
  Object.freeze({
    id: 'COINALYZE_FR_NEG',
    weight: 8,
    tag: '🌐FR_NEG',
    condition: (ctx) => typeof ctx.coinalyzeFRRate === 'number' && ctx.coinalyzeFRRate < -0.01,
  }),
  Object.freeze({
    /* FALLING_KNIFE — defensive suppression rule (NOT a migration).
       Triggered by the SAGA finding on 2026-05-20: three STRONG signals
       fired into a coin that had crashed -14% to -16% over its 24h
       window. The scanner saw enough volume + a tiny green tick to
       score 70-90, but the larger picture was clearly bearish.

       Penalty of -50 drops any rule-set total from 70-90 down to
       20-40, taking the signal out of MEDIUM/STRONG tier and below
       the qualityFilter gate at 30. The rule is INTENTIONALLY
       aggressive — a coin down >10% in 24h is statistically a tail
       event, and chasing it usually loses (verified against history).

       Edge case: legitimate reversals from -10% to flat will be
       suppressed too. The audit's stated philosophy is "prefer false
       negatives over false positives" — missing a recovery is less
       costly than chasing a continuation crash. If the tag-stats
       endpoint shows the rule over-suppresses real bounces, the
       threshold can widen from -10 to -15 in a single-line PR.

       No per-rule env flag — consistent with the other 5 rules in
       the registry. Rollback = revert this commit. */
    id: 'FALLING_KNIFE',
    weight: -50,
    tag: '🔪FALLING',
    condition: (ctx) => typeof ctx.change === 'number' && ctx.change < -10,
  }),
  /* Phase 2.A.1 PR E — MTF agreement + indicator rules.
     All 8 below are SERVER-ONLY data (client has no MTF / RSI /
     MACD computation in quickScan — those come from the server
     via /api/all when needed). Each rule strict-checks its ctx
     field so missing data — including the client's complete
     absence of these fields — cleanly no-ops the rule (same
     Option-C pattern as TIER2_BONUS in PR C and COINALYZE_FR_NEG
     in PR D).

     The four MTF_* rules are mutually exclusive by construction:
     `mtfStrength` is exactly one of 'full' / 'partial' /
     undefined, and `mtfBias` is exactly one of 'bullish' /
     'bearish' / undefined. So at most ONE of the four can fire
     per ctx — matching the inline if/else if behaviour. */
  Object.freeze({
    id: 'MTF_BULL_FULL',
    weight: 15,
    tag: '🎯MTF_BULL',
    condition: (ctx) => ctx.mtfStrength === 'full' && ctx.mtfBias === 'bullish',
  }),
  Object.freeze({
    id: 'MTF_BULL_PARTIAL',
    weight: 8,
    tag: '🎯MTF_BULL_2',
    condition: (ctx) => ctx.mtfStrength === 'partial' && ctx.mtfBias === 'bullish',
  }),
  Object.freeze({
    id: 'MTF_BEAR_FULL',
    weight: -10,
    tag: '🎯MTF_BEAR',
    condition: (ctx) => ctx.mtfStrength === 'full' && ctx.mtfBias === 'bearish',
  }),
  Object.freeze({
    id: 'MTF_BEAR_PARTIAL',
    weight: -5,
    tag: '🎯MTF_BEAR_2',
    condition: (ctx) => ctx.mtfStrength === 'partial' && ctx.mtfBias === 'bearish',
  }),
  Object.freeze({
    id: 'RSI_OS',
    weight: 10,
    tag: '📉RSI_OS',
    condition: (ctx) => typeof ctx.rsi === 'number' && ctx.rsi < 30,
  }),
  Object.freeze({
    id: 'RSI_OB',
    weight: -8,
    tag: '📈RSI_OB',
    condition: (ctx) => typeof ctx.rsi === 'number' && ctx.rsi > 70,
  }),
  Object.freeze({
    id: 'MACD_BULL_CROSS',
    weight: 12,
    tag: '📊MACD_BULL',
    condition: (ctx) => ctx.macdCross === 'bull',
  }),
  Object.freeze({
    id: 'MACD_BEAR_CROSS',
    weight: -8,
    tag: '📊MACD_BEAR',
    condition: (ctx) => ctx.macdCross === 'bear',
  }),
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
