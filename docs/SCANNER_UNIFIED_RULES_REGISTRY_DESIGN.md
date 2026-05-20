# Phase 2.A.1 Design — Unified Scoring Rules Registry

> **Status:** Design proposal — awaiting Ziko's call on the 3
> decisions in §5 before implementation begins.
>
> **Date:** 2026-05-20
> **Phase:** 2.A.1 (per `SCANNER_AUDIT_2026_05_15.md` §6, Option A path)
> **Estimate:** 1.5-2 days post-decisions
> **Audit spec:** "Unify tier thresholds and scoring rules — single
> import. Drives Phase 2 path A (P2.A.1 through P2.A.5)."

---

## 1. The problem in one paragraph

Today the scanner has **two implementations of the same scoring
rules**: `src/scanner-engine.js scoreSymbol` (server, 745 lines, ~45
tag-emit points) and `app.js quickScan` (browser, embedded in 7,098
lines, ~41 tag-emit points). Phase 1 hand-aligned the most
critical rules (P&D, manipulation cap, retail LS) by editing both
sides for every change. That works for a sprint. It doesn't scale —
every future scorer addition is two edits, two reviews, two test
suites, and one inevitable drift bug. The audit's "Wasted Pipeline"
finding (server publishes signals the client never reads) is the
same disease in another form: separate engines drift, you eventually
stop trusting either.

Phase 2.A.1 fixes this once. A single source of truth for every
scoring rule, imported by both sides. Phase 2.A.2 (PWA reads server
signals) becomes a no-op verification step after 2.A.1 ships.
Phase 2.A.5 (contract test) becomes a one-pager. Phase 4 (backtest)
becomes possible because the rule registry can be replayed against
history.

---

## 2. Why this isn't trivial

The two code bases share NOTHING about runtime style:

| Aspect        | Server (`scanner-engine.js`)            | Client (`app.js`)                      |
| ------------- | --------------------------------------- | -------------------------------------- |
| Module system | CommonJS (`require` / `module.exports`) | Plain script (no module, globals only) |
| Test runner   | Node's `node:test`                      | None for `app.js` (browser-only)       |
| Data access   | Pure function: `scoreSymbol(sym, ctx)`  | Reads globals: `T[sym]`, `FR[sym]`, …  |
| State         | Stateless                               | Reads + writes `cache`, `monitorState` |
| Build         | None — `node server.js`                 | None — `<script src="app.js">`         |

A registry that "works on both sides" must:

- Express each rule as **pure data** (no functions that capture
  closures over `cache` / globals).
- Be loadable as a CommonJS module on the server AND as a global on
  the client (or as ES module via `<script type=module>`).
- Not require a build step (the project has never had one — adding
  webpack/rollup just for this is overkill).
- Preserve the existing behavior **bit-for-bit** during migration,
  so contract tests can pin parity.

---

## 3. Proposed registry shape

A single file `src/scoring-rules.js` that exports a `RULES` array
and a `THRESHOLDS` constant. Both server and client read from it.

```js
// src/scoring-rules.js — pure data, no closures, no I/O.

'use strict';

const THRESHOLDS = Object.freeze({
  ULTRA: 100,
  STRONG: 70,
  MEDIUM: 50,
  WEAK_MIN: 30, // below this → rejected by qualityFilter
  WASH_VOLUME_FLOOR: 500_000_000,
  WASH_OI_FLOOR: 100_000,
});

// Each rule is { id, weight, condition, tag }. `condition` is a
// pure predicate on a normalized `ctx` shape both sides build.
const RULES = Object.freeze([
  {
    id: 'TIER1_BONUS',
    weight: 10,
    tag: '🏆TOP100',
    condition: (ctx) => ctx.isTier1 === true,
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
  // … about 40 more, one per existing tag-emit point
]);

module.exports = { RULES, THRESHOLDS };
```

**Server consumer (`src/scanner-engine.js`):**

```js
const { RULES, THRESHOLDS } = require('./scoring-rules');

function scoreSymbol(sym, ctx) {
  // Build normalized ctx once
  const normalized = normalizeServerCtx(sym, ctx);
  let score = 0;
  const tags = [];
  for (const rule of RULES) {
    if (rule.condition(normalized)) {
      score += rule.weight;
      if (rule.tag) tags.push(rule.tag);
    }
  }
  // Tier resolution, P&D detector, manipulation cap, ATR zones —
  // these stay where they are (they're meta-rules that depend on
  // the score, not individual tag rules).
  return {
    /* … same shape as today … */
  };
}
```

**Client consumer (`app.js quickScan`):**

```js
// Loaded as a <script src="src/scoring-rules.js"> with a wrapper:
//   typeof module !== 'undefined' && module.exports
//     ? module.exports
//     : (window.SCORING_RULES = ...)
function quickScan() {
  // ... existing per-symbol loop ...
  const normalized = normalizeClientCtx(s, T[s], FR[s], LS[s], …);
  let sc = 0; const tags = [];
  for (const rule of window.SCORING_RULES.RULES) {
    if (rule.condition(normalized)) {
      sc += rule.weight;
      if (rule.tag) tags.push(rule.tag);
    }
  }
  // ... rest unchanged ...
}
```

The dual-module wrapper at the bottom of `src/scoring-rules.js`:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RULES, THRESHOLDS };
} else if (typeof window !== 'undefined') {
  window.SCORING_RULES = { RULES, THRESHOLDS };
}
```

This is the same UMD-lite pattern `src/utils.js` already uses to be
loadable in both contexts.

---

## 4. Migration strategy — incremental, parity-preserving

The 40+ rules can't all migrate in one PR safely. Proposal: a
**parity ratchet**.

1. **PR A — Create the registry, add ~5 representative rules.** Wire
   both sides to consume those 5 rules from the registry instead of
   inline. The other 35+ inline rules stay as-is. Server runs the
   merged result. Contract test pins parity on the 5 migrated rules.
2. **PR B — Migrate the next ~10 rules.** Each rule moves from
   inline-on-both-sides to registry-only. Contract test gains rows.
3. **PR C — Migrate the rest, in 3-rule batches.** Each batch is a
   tiny PR. After each, the contract test grows. Server and client
   slowly converge on the registry as the single source of truth.
4. **PR FINAL — Remove the duplicate normalisation helpers** once
   every rule has migrated. Cleanup PR.

The rationale: each PR is reviewable in ~10 min, and at every commit
the system is fully working (both sides produce identical signals).
A regression in any single rule's migration is isolated and easy to
revert.

**Anti-pattern to avoid:** a big-bang "migrate all 40 in one PR" —
review burden alone makes it unsafe, and any one rule's bug
contaminates the whole change.

---

## 5. Three decisions Ziko needs to make

### 5.1 Decision A — Loader pattern

| Option                       | Behavior                                                                                       | Pros                                                            | Cons                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **A1.** Dual-module wrapper  | `if (module.exports) ... else (window.SCORING_RULES = ...)` — same pattern `src/utils.js` uses | Zero build step. Matches the existing codebase style.           | Tiny boilerplate at file bottom. Server tests run via Node, client via browser only.       |
| **A2.** Build step (esbuild) | One ES module, esbuild emits both a CJS server bundle and a browser global                     | Modern, type-friendly (TS later).                               | Adds a dependency + build step the codebase has never had. Bigger change than the goal.    |
| **A3.** JSON-only data file  | `src/scoring-rules.json` — no `condition` functions, ids reference predicates defined per-side | Truly portable; can be version-controlled, audited line-by-line | The `condition` predicates are the point — splitting them out re-creates the drift problem |

**Recommendation: A1.** It matches `src/utils.js`'s existing pattern
and adds zero build infrastructure. The codebase has stayed
build-step-free for a reason; this isn't the PR to change that.

Decision needed: **A1 / A2 / A3.**

---

### 5.2 Decision B — Normalised `ctx` shape

The server passes `ctx = {ticker, fr, ls, globalLs, topTraders, …}` to
`scoreSymbol`. The client reads `T[s]`, `FR[s]`, `LS[s]` directly.
For the same rule to run on both sides, both must build the SAME
input to `rule.condition`.

| Option                                                                           | Behavior                                                                                                                    | Pros                                                                                                         | Cons                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **B1.** Define a normalized `ctx` shape in the registry; each side maps to it.   | The registry is the contract. Each side has a `normalize()` function (server-side and client-side) that produces the shape. | Clean separation. Rules become trivially portable.                                                           | Two new normalizers to write + test. Adds ~80 lines of mapping code. |
| **B2.** Pass the client's raw globals as `ctx`; server adapter mimics that shape | Skip the normalisation layer; just adopt the client's existing access pattern.                                              | Smaller diff on day one.                                                                                     | Server already has a different (cleaner) ctx; flipping is worse.     |
| **B3.** Match the server's existing `ctx` shape; client adapter mimics it.       | Smallest server change; client gets a fresh `buildCtx(symbol)` helper that mirrors the server's signature.                  | Server stays unchanged; client gets a clean buildCtx() that's easier to read than the inline globals access. | Client refactor is bigger than B2 but the result is clearer.         |

**Recommendation: B3.** The server's ctx shape is already documented
and tested. The client is the messy side; pulling it toward the
server's shape is the architectural improvement. A `buildCtx(symbol)`
helper on the client takes 20 lines and makes `quickScan`
substantially cleaner regardless.

Decision needed: **B1 / B2 / B3.**

---

### 5.3 Decision C — Migration order

Some rules are simpler / more important / more aligned than others.
Which subset migrates in **PR A** (the first registry-consuming PR)?

| Option                                                                                                                              | Behavior                                                                                             | Pros                                                                          | Cons                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **C1.** Migrate the 5 P&D-related rules first (VERTICAL, FR_EXTREME, LS_RETAIL_LONG, SMART_VS_RETAIL, THIN_PUMP)                    | These are documented in Phase 1.0 with rationale. Already tested on the server.                      | Builds on the existing detector + audit; lowest risk.                         | The detector is a meta-rule (counts flags); awkward to express in the registry. |
| **C2.** Migrate the 5 simplest scoring rules (TIER1_BONUS, EARLY_ENTRY, STEALTH, MEGA_VOL, HIGH_VOL)                                | Single-condition rules with constant weights. Easy to express as `{condition, weight, tag}`.         | Lowest implementation risk. Proves the registry shape.                        | Lowest informational value — these rules already agree on both sides.           |
| **C3.** Migrate the 5 rules with KNOWN historical drift (LS_RETAIL_LONG, manipulation cap, ATR zones, P&D weights, tier thresholds) | Tackles the cases where drift has actually bitten us. After PR A, those rules can NEVER drift again. | Highest informational value; pays for the registry's design cost immediately. | Larger first PR (the rules are meta-rules; need more wrapping).                 |

**Recommendation: C2 + C3 in PR A** — 5 simple rules to prove the
loader and 1 known-drift rule (LS_RETAIL_LONG, since Phase 1.1.c
explicitly noted client still at 3 vs server at 2.5). That gives PR
A both a clean implementation and immediate value: the LS threshold
gap closes the moment PR A merges.

Decision needed: **C1 / C2 / C3 / C2+C3.**

---

## 6. Test strategy — the contract test

The validator promised in `SCANNER_AUDIT_2026_05_15.md` §6 P2.A.5 is
the **payoff** of this migration:

```js
// tests/scanner-contract.test.js — finally populated

const fixtures = require('./fixtures/contract.json'); // ~30 canonical
// ticker snapshots
const { scoreSymbol } = require('../src/scanner-engine');
// (client's quickScan() loaded via a jsdom shim, OR a port of the
//  client's per-symbol scoring function lifted into src/ as a pure
//  testable helper; either way, it consumes the registry now)

for (const fixture of fixtures) {
  test(`contract — ${fixture.name}`, () => {
    const serverOut = scoreSymbol(fixture.symbol, fixture.ctx);
    const clientOut = clientScore(fixture.symbol, fixture.ctx); // same registry
    assert.equal(serverOut.score, clientOut.score);
    assert.deepEqual(serverOut.tags.sort(), clientOut.tags.sort());
  });
}
```

After PR FINAL ships, the contract test catches any divergence in
CI on every PR. After 2.A.1, drift becomes impossible.

---

## 7. Rollback strategy

Per-rule:

- Each migrated rule is gated by its `id` in the registry. If a
  rule misbehaves, revert just that rule's entry from the registry
  AND restore its inline copy in both sides — 3-line PR per rule.
- Until PR FINAL, the inline copies remain as fallback; the
  parity ratchet means we never lose the original logic until
  every rule has been migration-verified.

Full rollback:

- `git revert <PR A>` restores both sides to fully-inline scoring.
- No data migration involved — scoring is stateless.

---

## 8. What this unlocks downstream

| Downstream phase             | How 2.A.1 helps                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2.A.2** (PWA reads server) | Once the rules are unified, the client running `quickScan` is functionally equivalent to reading `all.signals`. The architectural debate in PR #104 (deepAnalyze vs server-only) loses urgency because the scoring agrees. |
| **2.A.3** (Tier thresholds)  | Part of `THRESHOLDS` constant — done as a side effect of PR A.                                                                                                                                                             |
| **2.A.5** (Contract test)    | The contract test BECOMES MEANINGFUL once both sides import the registry. Currently it's a stub.                                                                                                                           |
| **Phase 4** (Backtest)       | A backtest harness needs a deterministic scoring function it can replay against historical data. The registry IS that function. Without 2.A.1, the harness ships either two versions or with no parity guarantee.          |

---

## 9. Asks for Ziko

Reply with three letters (e.g. **`A1 B3 C2+C3`**) or
**`Approved defaults`** to accept all recommendations. The first
implementation PR (the registry skeleton + ~5 rules) opens within 30
minutes of the reply.

If you want to discuss any decision before committing, say
**`Discuss A`** (or B / C). The discussions don't block — they shape
the very first PR's scope.

---

## 10. Summary

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| Problem        | Two scoring engines drift; manual sync doesn't scale                                    |
| Solution       | Single `src/scoring-rules.js`, imported by both sides via the existing UMD-lite pattern |
| Migration      | Parity ratchet — small PRs, contract test gains coverage with each one                  |
| First-PR scope | 5 simple rules + 1 known-drift rule, behind the new registry                            |
| Why now        | Unblocks 2.A.2, 2.A.3, 2.A.5, and Phase 4                                               |
| Risk           | Low per-PR; the inline copies stay until PR FINAL                                       |
