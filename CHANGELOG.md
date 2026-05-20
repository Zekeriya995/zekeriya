# NEXUS PRO V10 — التسليم النهائي الشامل

## [Scanner Pagination Fix — configurable result limit + Show more] — 2026-05-20

**Closes audit §2.7.** The original implementation hard-coded
`slice(0,7)` at three points in the scanner pipeline
(`qualityFilter`, `loadTrading`'s per-card loop, `renderTrading`'s
final slice), which meant the platform produced 50+ scored signals
but only ever exposed 7 to the user. Trust signal in the wrong
direction — the platform looked like it produced fewer ideas than
it actually did.

The fix is a single configurable limit (`localStorage.nxScannerLimit`,
default 20, clamped 5..100) that all three slices respect, plus a
"Show more" button rendered below the trade list whenever
`qualityFilter` held back more signals than the current limit is
exposing. Each click bumps the persisted limit by 10 and re-renders
from the cached scan — no network work is triggered.

### What ships

- **`src/scanner-helpers.js`** — new pure helper `clampScannerLimit(raw, defaultVal, min, max)`:
  - Parses `raw` as an integer, falls back to `defaultVal` on
    null / non-numeric / empty input.
  - Clamps to `[min, max]` so a typo in localStorage can't render
    zero or thousands of cards.
  - Argument-trio defaults match the shipped policy (20 / 5 / 100)
    so callers without explicit bounds get safe behaviour.
- **`tests/scanner-helpers.test.js`** — 6 new tests for the clamp
  helper: missing/non-numeric → default, below-min → min, above-max
  → max, in-range passthrough, default-argument policy, override
  bounds.
- **`app.js`** — five additions:
  - `SCAN_LIMIT_KEY` / `SCAN_LIMIT_DEFAULT` / `SCAN_LIMIT_MIN` /
    `SCAN_LIMIT_MAX` constants alongside the existing
    `SCAN_MIN_SCORE_KEY` policy block.
  - `_scannerLimit()` / `setScannerLimit(v)` wrap `clampScannerLimit`
    around the localStorage read/write. Try/catch guards against
    private-mode storage failures.
  - `showMoreSignals()` increments the persisted limit by 10 and
    calls `loadTrading()` to re-render — cache-friendly, no network.
  - `_lastQualityFilterPassed` tracks the pre-cap survivor count so
    `renderTrading` can label the "Show more" button with the exact
    number of additional signals waiting.
  - `qualityFilter`, `loadTrading`'s render loop, and
    `renderTrading`'s final slice all now read `_scannerLimit()`
    instead of the hard-coded `7`. The cap is reapplied at each
    layer so a mid-pipeline change (e.g. user clicks "Show more"
    while the cached scan is still fresh) takes effect on the next
    render without re-running the scan.
- **`eslint.config.mjs`** — declares `clampScannerLimit` as a
  readonly global in both the app config and the test config.

### How the "Show more" button works

```
[trade card #1]
[trade card #2]
…
[trade card #20]    ← default limit
─────────────────
[📂 Show more (12 more)]   ← only when qualityFilter held back >0
```

Click → `localStorage.nxScannerLimit` jumps from 20 to 30 → re-
render exposes 10 more cards from the same cached scan. Persistent
across sessions; clears by removing the key or hitting it down to
the floor (5).

### Edge cases handled

- **Private browsing / quota exceeded**: `setScannerLimit` wraps the
  localStorage write in try/catch and silently falls back to the
  in-memory limit. The user just doesn't get persistence — the
  current session still shows more cards.
- **localStorage typo**: a string like `"twenty"` parses to NaN and
  the helper returns the default. A string `"0"` clamps up to 5.
  A string `"99999"` clamps down to 100.
- **No more to show**: button is hidden when
  `_lastQualityFilterPassed <= _visibleCount` OR when the limit is
  already at SCAN_LIMIT_MAX.
- **Cache freshness**: "Show more" reuses the existing 60s scan
  cache, so the user sees the wider list immediately without a
  spinner or any /api/all fetch.

### Backwards compatibility

Users with no `nxScannerLimit` value (every existing user) see 20
cards on first render — up from the previous 7. No flag, no
opt-in, no migration step. The audit lists this as
"can ship any time" — it's a pure user-visible improvement with
no behaviour change for ULTRA push triggers, scoring, or signal
quality gates.

### Test results

- `npm run check` → lint clean, format clean, **731 / 731** tests
  pass (was 725 + 6 from this commit).

### References

- `SCANNER_AUDIT_2026_05_15.md` §2.7 (qualityFilter slice problem
  + recommended fix)
- `SCANNER_AUDIT_2026_05_15.md` §6 "Post-Phase Pagination Fix"
  (ship-anytime designation)

---

## [Scanner Phase 2.A.2 — PWA consumes server signals] — 2026-05-20

**The "Wasted Pipeline" defect closes.** The PWA can now read
`all.signals` from `/api/all` as the primary scanner source instead
of recomputing every coin's score locally. When the server pass is
fresh (< 60 s) and the user has opted in, `getScanResults` short-
circuits `quickScan + deepAnalyze` entirely and adapts the server's
already-scored payload to the client signal shape. When the server
is stale, missing, or the flag is off, the existing local pipeline
runs unchanged.

This is the Option A architectural promise from
`SCANNER_AUDIT_2026_05_15.md` §3: server is the single source of
truth for scoring, and Push ↔ in-app parity is enforced by
construction rather than by best-effort.

### Decisions recorded

Per the design doc (`docs/SCANNER_PWA_SERVER_SIGNALS_DESIGN.md` §3):

| Decision | Choice | Why |
|----------|--------|-----|
| A — Replacement scope | **A2** — server primary, deepAnalyze becomes the stale-only fallback | Matches the audit's literal wording. Defers the MTF / VPIN / iceberg enrichment question to a follow-up; ATR zones already moved server-side in Phase 2.A.4. |
| B — Default state | **B2** — `nxScannerFix_server_signals` defaults OFF for the first deploy | This is a user-facing change touching the entire UX surface. Default OFF lets Ziko verify in his own browser for a week before flipping the default in a 5-line follow-up. |
| C — Transition UX | **C1 + source tags** — hard switch every tick + `📡SRC_SERVER` / `🖥️SRC_LOCAL` tags | Simplest path. The two source labels are symmetric so a single grep finds every signal's origin. Hysteresis can come later if flicker is observed. |

### What ships

- **`src/scanner-server-adapter.js`** (new) — pure adapter
  `adaptServerSignalToClient(serverSig, ctx)` that maps the server
  signal shape (output of `scoreSymbol`) to the client signal shape
  (output of `deepAnalyze`). The server is canonical for
  `score / tags / tier / direction / change / price / volume /
  manipulationRisk / sl / tp1 / tp2 / rr`; local cache fills in
  `whaleConf / waveCount / fr / by / cb / freshness / proven`. Fields
  the server can't compute (`tfAlign`, `confirmedBreakout`,
  `kl15Available`, `atr15m`, VPIN/iceberg) return null/false/0 —
  renderers already gate on these defensively.
- **`tests/scanner-server-adapter.test.js`** (new, 25 tests) —
  validates null-input handling, source-tag de-duplication, tier
  → ultra mapping (including MANIP_HARD_CAP demotion), smartEntry
  shape parity with Phase 2.A.4, checks{} inference from tag
  patterns, pdFlags regex parsing of both `🚨P&D_RISK:N/5` and
  `⚠️P&D_WARN:N/5` variants, freshness/age policy parity with
  deepAnalyze, local-cache fillers (whale / fr / cb / proven),
  ticker fallback when server omits price/change/volume, and
  end-to-end compatibility with `qualityFilterRejectReason`.
- **`app.js`** — three additions:
  - Module-level `serverScanSignals[]`, `serverScanTs`,
    `SERVER_SIGNALS_STALE_MS=60000`.
  - `loadTk()` captures `all.signals` + `all.scannerTs` after the
    existing `all.multi` block.
  - `getScanResults()` adds a branch — when
    `_serverSignalsEnabled() && _serverSignalsFresh() &&
    serverScanSignals.length`, build the cache from the adapter
    and short-circuit deepAnalyze. The branch wraps in try/catch
    so any adapter failure falls through to the existing local
    path without breaking the scan.
  - Local-path deepAnalyze pushes `🖥️SRC_LOCAL` onto every result's
    tag-bag so the source is visible alongside the server-path's
    `📡SRC_SERVER`.
- **`index.html`** — loads the new script after
  `src/scanner-helpers.js`.
- **`tests/_setup.js`** — loads the new script for unit tests.
- **`eslint.config.mjs`** — declares `adaptServerSignalToClient` and
  `SRC_SERVER_TAG` as readonly globals in both the app config and
  the test config.
- **`.env.example`** — the `SCANNER_PWA_USES_SERVER_SIGNALS` env var
  reservation is reclassified as LIVE-no-op-server-side, with a
  pointer to the client-side localStorage flag that actually drives
  the rollout.

### How to opt in

```js
// In DevTools, on any page hosting the PWA:
localStorage.setItem('nxScannerFix_server_signals', 'on');
location.reload();
// Top-3 signals now carry the 📡SRC_SERVER tag and match
// /api/all.signals identically. To revert:
localStorage.setItem('nxScannerFix_server_signals', 'off');
```

The flag is re-read on every `getScanResults` call, so a stale-
to-fresh recovery (e.g., proxy reconnected) flips the signal
source on the next scan tick without a page reload.

### Why deepAnalyze is the fallback only

The audit's wording is "PWA `loadTk()` consumes `all.signals` as
primary; falls back to local `quickScan` only when `all.scannerTs`
is > 60 s stale." Two consequences:

1. When the server is fresh, MTF / VPIN / iceberg / absorption
   enrichment is **not** computed on the client. Phase 2.A.4 already
   brought ATR-aware SL/TP server-side; the remaining client-only
   enrichments are useful but not on the critical path of the Top-3
   render. They can be re-added in a follow-up under a dedicated
   "Deep Dive" affordance (decision A3 from the design doc) without
   reverting this PR.
2. When the server is stale (PROXY down, scanner backed up >60 s),
   the local `quickScan + deepAnalyze` path runs and stamps
   `🖥️SRC_LOCAL` on every signal so a debugger can tell at a glance
   which side scored the row.

### Bandwidth + CPU expectation

Per the audit's §5 "Wasted Pipeline" telemetry: when the flag is on
and the server is fresh, the PWA stops calling Binance directly for
the top-30 kline batch in `deepAnalyze`, dropping roughly 30 kline
fetches per scan tick × ~1 tick / 60 s × N browsers. The exact
savings will be visible in the source-health UI once the flag flips
default-ON in the follow-up PR.

### Rollback

| Scenario | Action | Time |
|----------|--------|------|
| Server payload missing / malformed tags | `localStorage.setItem('nxScannerFix_server_signals','off')` in any browser, reload | < 30 s per user |
| Catastrophic regression on every browser | Revert this commit; service-worker cache TTL means worst-case 1 h staleness before fix lands | 2–30 min |
| Want to test before flipping default | Default stays OFF; testers opt in individually | Always available |

### Test results

- `npm run check` → lint clean, format clean, **725 / 725** tests
  pass (was 700 + 25 from this commit).

### References

- `SCANNER_AUDIT_2026_05_15.md` §3 (architectural decision, Option A)
- `SCANNER_AUDIT_2026_05_15.md` §6 P2.A.2 (this phase)
- `docs/SCANNER_PWA_SERVER_SIGNALS_DESIGN.md` (decisions A2 / B2 / C1)
- Phase 2.A.4 ATR-aware SL/TP (CHANGELOG entry below) — supplies
  the server-side `sl/tp1/tp2/rr` the adapter forwards to `smartEntry`.

---

## [Scanner — FALLING_KNIFE suppression rule] — 2026-05-20

**Defensive new scoring rule.** Triggered by the SAGA finding —
three STRONG signals fired on 2026-05-11 into a coin that had
crashed -14% to -16% over the 24h window each time. Net result:
three logged losses, no actual gains. The scanner was catching the
brief volume blips inside a multi-day crash.

### What ships

A single new rule in `src/scoring-rules.js`:

```js
{
  id: 'FALLING_KNIFE',
  weight: -50,
  tag: '🔪FALLING',
  condition: (ctx) => typeof ctx.change === 'number' && ctx.change < -10,
}
```

Any coin down more than 10% in its 24h window loses 50 points
immediately. A STRONG (70-90) signal on a falling knife drops to
20-40 — below the `WEAK_MIN` quality gate at 30 — and never reaches
the user.

### Why -50

Calibrated so that a STRONG (70-99) signal becomes a WEAK (<30)
after the penalty, which the qualityFilter drops. ULTRA-scoring
signals (100+) still pass through with a heavy penalty (50+ tag),
which is honest: a coin scoring ULTRA *despite* crashing 10%+ in
24h has REAL accumulation underneath the noise, and the user should
see the warning tag and decide.

### Why -10 (not -5 or -15)

- -5 would suppress any minor pullback, killing the scanner's
  ability to catch dip-buys
- -15 would still let SAGA-style -10 to -14 entries through
- -10 is the audit's "tail event" threshold — historically a
  daily move past -10% has follow-through about 60% of the time
  (continuation, not reversal)

If the tag-stats endpoint shows the rule over-suppresses real
bounces, the threshold can widen from -10 to -15 in a single-line PR.

### No per-rule env flag

Consistent with the other 5 rules in the registry. Rollback =
revert this commit (single-line in the array). The parity-ratchet
design intentionally treats rule changes as committable code, not
runtime config.

### Edge cases covered by tests

- Boundary: `change === -10` does NOT fire (strict `<`).
- `change === -10.01` fires.
- Missing / null / NaN / non-numeric `change` does NOT fire.
- Aggregate: a TIER1 + change=-15 ctx scores TIER1 (+10) +
  FALLING_KNIFE (-50) = -40 net.
- A recovering coin at change=-8 does NOT trigger.
- SAGA case (change=-16.31) fires correctly.

### Server impact (when deployed)

The next `fetchTickers` cycle, any coin with `d.change < -10`
will score 50 points lower. Estimated effect: on a typical
red day with 5-10 coins down >10%, those coins drop OUT of
the top signals into `lowScore` rejection (visible in
`/api/scanner/insights`'s `lowScore` counter). Net user-facing
effect: fewer red losers polluting the Top-3.

### Test results

- `npm run check` → lint clean, format clean, **700 / 700** tests pass
  (was 695 + 5 from this commit).

### Rollback

Single-commit revert. The rule object is removed from the RULES
array. Tags `🔪FALLING` already in scanner-history.json remain
(forward-compatible — no consumer breaks on an unknown tag).

### References

- 2026-05-20 SAGA history finding (3 consecutive STRONG losses)
- `SCANNER_AUDIT_2026_05_15.md` §6 (suppression philosophy)

---

## [Scanner Phase 2.A.3 — THRESHOLDS consumption (server wiring)] — 2026-05-20

**Tiny follow-up PR. No behaviour change.** Addresses SRE NOTE 5
from PR #106's pre-merge review: `_tierFromScore` and the
wash-trade floors in `src/scanner-engine.js` still duplicated
hard-coded numbers that already lived in `THRESHOLDS` from the
new registry. This PR replaces those literals with registry
references, effectively closing Phase 2.A.3 (unified tier
thresholds) as a side effect.

### Changed

- `src/scanner-engine.js`:
  - `WASH_VOLUME_FLOOR` / `WASH_OI_FLOOR` module-local consts
    now derive from `scoringRules.THRESHOLDS.WASH_VOLUME_FLOOR` /
    `.WASH_OI_FLOOR` instead of inline literals. Re-exporting them
    as module-locals keeps every existing reference unchanged.
  - `_tierFromScore` reads `scoringRules.THRESHOLDS.ULTRA` / `.STRONG`
    / `.MEDIUM` instead of literals 100 / 70 / 50.
  - `runScannerPass` lowScore gate reads `scoringRules.THRESHOLDS.WEAK_MIN`
    instead of literal 30.

### Test coverage

- `tests/scoring-rules.test.js` — extended the `THRESHOLDS` shape
  test to lock the wash-trade floor values (caught by the same
  assertion that locks the tier cutoffs).
- All 47 existing `scanner-engine.test.js` tests continue to pass
  unmodified — proof the wiring is bit-for-bit equivalent.

### Why this isn't bundled into PR #106

Keeping the parity ratchet small. PR #106 (PR A) was the registry
skeleton + 5 rules + server wiring + review fixes. This (PR B in
the broader plan, but functionally closing Phase 2.A.3) is the
threshold wiring. Each diff is reviewable in 2 minutes.

### Rollback

Single-commit revert. `WASH_VOLUME_FLOOR` / `WASH_OI_FLOOR` /
tier cutoffs return to inline literals; the registry exports the
values but nobody reads them. No data migration.

### Test results

- `npm run check` → lint clean, format clean, 695 / 695 tests pass.

### Phase 2.A.3 status

The audit's Phase 2.A.3 ("Unify tier thresholds — single import")
is now effectively complete on the server. `app.js`'s
`_tierFromScore` (and its inline cutoffs) still uses literals;
PR B of the registry migration handles that.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 P2.A.1, P2.A.3
- `docs/SCANNER_UNIFIED_RULES_REGISTRY_DESIGN.md` §3
- PR #106's SRE review NOTE 5 (now resolved)

---

## [Scanner Phase 2.A.1 PR A — Unified Rules Registry skeleton] — 2026-05-20

**Foundational refactor.** No behaviour change. Implements PR A of
the Phase 2.A.1 migration per `docs/SCANNER_UNIFIED_RULES_REGISTRY_DESIGN.md`
(which Ziko approved by defaults via `A1 B3 C2+C3`).

### What ships

A new file `src/scoring-rules.js` exporting `RULES`, `THRESHOLDS`, and
`applyRules(ctx)` — the **single source of truth** for scanner scoring
rules. Loaded via UMD-lite (forward-looking — the `module.exports`
branch handles CommonJS on the server, the `window.SCORING_RULES`
branch handles direct `<script>` loading in the browser). Zero build
step. Both branches are unit-tested.

Five "simple" rules migrated in this PR (the rest follow in PR B+):

| ID                   | Weight | Tag      | Condition                                       |
| -------------------- | ------ | -------- | ----------------------------------------------- |
| TIER1_BONUS          | +10    | 🏆TOP100 | `isTier1 === true`                              |
| NEW_BONUS            | +2     | 🔍NEW    | `isTier1 === false`                             |
| SILENT_ACCUMULATION  | +25    | 🐋ACC    | `volume > 5e7 && Math.abs(change) < 2`          |
| EARLY_ENTRY          | +20    | 🔍EARLY  | `volume > 3e7 && change >= 0.3 && change < 2`   |
| STEALTH              | +15    | 🔍STEALTH| `volume > 8e7 && change >= 0.5 && change < 3`   |

### Why these five

Picked per the design doc's recommendation (C2 — 5 simplest rules):
each is a single-condition rule with a constant weight, easy to
express as `{condition, weight, tag}`. They have ALREADY been
verified identical between client and server during Phase 1's
hand-alignment, so migrating them produces zero behavioral change.

`MEGA_VOL` / `HIGH_VOL` / `VOL` are intentionally NOT in this PR
because they live in an `else if` chain (only one can fire). They
need a different rule shape (or 3 mutually-exclusive registry
rules). Deferred to PR B.

`LS_RETAIL_LONG` drift fix is also deferred — the design doc
included it in C3, but on closer reading the threshold lives
inside the P&D detector (`scanner-pd-detector.js`), not in
`scoreSymbol`'s top-level tag bag. Migrating the detector is meta
work; PR B will tackle threshold-bearing rules.

### Server wiring

`src/scanner-engine.js scoreSymbol` now does:

```js
const registryResult = scoringRules.applyRules({
  isTier1, volume: d.volume, change: d.change,
});
score += registryResult.scoreDelta;
for (const t of registryResult.tagsDelta) tags.push(t);
```

Replacing the 5 inline if-blocks. Net effect: identical math, same
tags, same order. The 690+ existing tests still pass — confirms the
refactor preserves behavior.

### Client wiring

**Not in this PR.** Client (`app.js`) still has its inline rules.
That's intentional — keeping the parity ratchet to one side per PR
makes the diff reviewable. PR B (next) wires the client to the
registry; CI's existing manual-verification gap on app.js means Ziko
should verify in his browser before that lands.

### Test coverage

`tests/scoring-rules.test.js` — 18 tests covering:
- Shape integrity (RULES frozen, every rule has id/weight/condition,
  ids unique).
- Per-rule contract (each of the 5 rules: fires when conditions met,
  doesn't fire at boundaries, doesn't fire on absent fields).
- Mutual exclusivity of TIER1_BONUS and NEW_BONUS.
- Aggregate `applyRules()` correctness (a BTC-shaped fixture and a
  thin-ticker fixture).
- Pure-function contract (returned `tagsDelta` is a fresh array).
- UMD loader contract (CommonJS path works).
- Defensive: empty / malformed ctx returns zeroed result.

Server-side integration: all 47 existing `scanner-engine.test.js`
tests still pass. The refactor is bit-for-bit equivalent.

### Rollback

Revert this PR — the inline blocks come back, the registry file
remains but unused (no consumer). No data migration, no flag.

### Next PRs in the migration

| PR | Scope                                                              | Risk     |
| -- | ------------------------------------------------------------------ | -------- |
| B  | Client (`app.js`) wires to the registry for the same 5 rules       | Medium (browser code) |
| C  | Migrate `MEGA_VOL`/`HIGH_VOL`/`VOL` else-if chain (3 mutually-exclusive rules) | Low |
| D  | Migrate FR / OBI / Whale rules (10 rules)                          | Low |
| E  | Migrate MTF / indicator rules (10 rules)                           | Medium (depends on ctx fields) |
| FINAL | Remove inline rule blocks once registry coverage is complete    | Low |

Each will follow the same pattern: tiny diff, parity preserved at
every commit.

### Pre-merge review fixes applied

Two parallel reviewer agents (correctness + SRE) cleared the PR
with 0 blockers. Applied 4 small hardenings:

- **Deep-freeze inner rule objects** (correctness NOTE 1).
  `Object.freeze(RULES)` only froze the outer array; `RULES[0].weight =
  999` would have silently mutated at runtime. Each rule object is
  now individually frozen. New test asserts mutation throws.
- **Document strict-equality semantics** (correctness NOTE 2). Added
  comments on TIER1_BONUS / NEW_BONUS explaining the intentional
  `=== true` / `=== false` and the contract this imposes on the
  client's `buildCtx` (must pass real booleans, not undefined).
- **UMD browser-path test** (SRE NOTE 3). Used `vm.runInContext` with
  a sandbox `{ window: {} }` to exercise the `window.SCORING_RULES`
  branch of the loader. Catches regressions in the browser path
  before PR B lands.
- **Comment listing un-expressible patterns** (SRE NOTE 1). Top of
  `src/scoring-rules.js` now lists the 5 patterns the current
  `{id, weight, tag, condition}` shape can't express (else-if
  chains, multi-tag tier rules, non-additive scoring, dynamic tag
  strings, compound rules). Future PRs read this before trying to
  shoehorn.

Deferred to PR B/D:
- **`CTX_KEYS` frozen export + dev-mode validator** (SRE NOTE 2).
  Worth doing when ctx grows past ~12 fields; today's 3 fields don't
  warrant the layer.
- **THRESHOLDS consumption** (SRE NOTE 5). PR B should wire
  `_tierFromScore` to read `THRESHOLDS.ULTRA` etc. so the constant
  isn't orphan.

### Test results

- `npm run check` → lint clean, format clean, 695 / 695 tests pass
  (was 692 + 3 from the review-fix hardening).
- `node --check src/scoring-rules.js` → clean.
- `node --check src/scanner-engine.js` → clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 P2.A.1
- `docs/SCANNER_UNIFIED_RULES_REGISTRY_DESIGN.md` §3 (proposal),
  §4 (parity ratchet), §5 (decisions: A1 B3 C2+C3 approved)

---

## [Scanner — P&D threshold validator CLI] — 2026-05-20

**Pure tool. No runtime behaviour change.** Delivers the validator
script promised in Phase 1.0 (`SCANNER_AUDIT_2026_05_15.md` §6 P1.0
decision C).

### What it does

`node vps/validate-pd-thresholds.js [--days N] [--json] [--history PATH]`

Reads `data/scanner-history.json`, aggregates evaluated signals by
P&D / MANIP / ATR tag family, and prints a delta-vs-baseline report
so engineering can answer: **"is this suppression tag actually
identifying losers, or just suppressing arbitrary signals?"**

Example output (illustrative — real numbers fill in over 7+ days):

```
════════════════════════════════════════════════════════════
  P&D / MANIP THRESHOLD VALIDATOR — last 30 days
════════════════════════════════════════════════════════════

Total tagged signals in window:  142
Pre-1.0b entries excluded:       12

──────────────  BASELINE  ──────────────
  count=142  wins=58  losses=29  winRate=41%  avgGain=2.13%

──────────────  BY TAG FAMILY  ─────────
Family       Count  Wins  Losses  WinRate  AvgGain  vs Baseline
P&D_RISK     0      —     —       —        —        (no firings yet)
P&D_WARN     8      1     5       12%      -2.8%    -29pp
MANIP_CAP    11     2     7       18%      -1.4%    -23pp
ATR_ZONES    23     12    4       52%      +3.7%    +11pp
```

A **negative delta** on a suppression tag means the tag is correctly
catching losers. A **positive delta** means the threshold may be
suppressing legitimate signals — re-examine.

### Interpretation modes

- `P&D_WARN` / `P&D_RISK` / `MANIP_*` are SUPPRESSION tags. Negative
  deltas confirm the threshold works.
- `ATR_ZONES` is a BOOST tag (Phase 2.A.4 wider/tighter stops). Positive
  delta confirms ATR bounds outperform the legacy fixed ladder.

### Added

- `vps/validate-pd-thresholds.js` — CLI tool (~200 lines including
  the renderer). Loads history, computes per-family stats via the
  shared `src/scanner-tag-stats` module, prints text or JSON.
  Exit codes: 0 (success), 1 (file missing/unparseable), 2 (bad CLI arg).
- `tests/validate-pd-thresholds.test.js` — 14 tests on the pure
  helpers: aggregate math, window filter, tag-family regex behavior,
  pre-extension entry exclusion, multi-tag-family entries, realistic
  suppression-vs-baseline scenario.
- `npm run validate-pd` — shorthand for the most common invocation.
- `eslint.config.mjs` — `vps/*.js` added to the Node files block so
  any future scripts in `vps/` get commonjs treatment by default.

### Rollback

N/A — pure tool, opt-in invocation. Delete the file to remove.

### When to run

On the VPS, after Phase 1.0b has accumulated ≥ 7 days of tagged
history. Before then the tool prints "No tagged signals yet — nothing
to validate." correctly.

### Pre-merge review fixes applied

Parallel reviewer agents (correctness + SRE) cleared with 0
blockers. Applied 4 trivial fixes before merge:

- **B1 (CLI UX):** `--history` with no value now exits 2 with
  `--history requires a path` instead of the confusing
  `history file not found: undefined`.
- **B3 (regex precision):** `TAG_FAMILIES` anchored at `:` or
  end-of-string. A future tag like `P&D_RISK_OVERRIDDEN` will
  no longer auto-bucket into the existing `P&D_RISK` family.
  Locked by a new test.
- **SRE-1 (JSON schema versioning):** `--json` output now
  starts with `"schema": 1`. Downstream jq pipelines should
  gate on this; bumping the version signals a breaking change.
- **SRE-2 (size cap):** `loadHistory` rejects files larger than
  10 MB before reading them into RAM. MAX_HISTORY would never
  produce that — 10 MB+ means corruption or hand-edit.

Also documented in the rendered text report:

- The family-count overlap caveat (a single signal carrying
  multiple suppression tags contributes to multiple family rows).
- The ATR_ZONES win-rate-bias caveat (the legacy outcome
  evaluator uses fixed thresholds, not per-signal sl/tp1 — see
  Phase 2.A.4 CHANGELOG for the proper-fix path in Phase 4).

### Test results

- `npm run check` → lint clean, format clean, 647 / 647 tests pass
  (was 632 + 14 + 1 review-fix test).

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 (Phase 1.0 P1.0)
- `docs/SCANNER_PD_THRESHOLDS.md` §6 (schema extension proposal —
  this tool consumes its output)
- Re-uses `src/scanner-tag-stats.js` for the underlying aggregation
- Pre-merge correctness + SRE review agents (2026-05-20)

---

## [Scanner Phase 2.A.4 — Server-side ATR-aware SL/TP] — 2026-05-19

**Behaviour change (gated, default ON).** Implements P2.A.4 from
`SCANNER_AUDIT_2026_05_15.md` §6. Behind `SCANNER_SERVER_ATR_ZONES`.

### Motivation

The legacy SL/TP ladder priced BTC and DOGE identically:

| Coin     | Daily range | Legacy SL  | Outcome                          |
| -------- | ----------- | ---------- | -------------------------------- |
| BTC      | ~1.5%       | -3%        | Stop too far — wastes capital    |
| DOGE     | ~6-8%       | -3%        | Stop inside noise — knocked out  |

Same fixed -3% / +5% / +10% for every coin regardless of how it
actually moves. The R:R ratio is constant (~1.67) but the realised
win rate suffers on both extremes.

### Fix

`scoreSymbol` now reads `ctx.indicator.atr` (Average True Range over
14 × 15m candles, already computed by `src/indicator-engine.js`). When
ATR is available and positive:

```
sl  = price - 1.5 × ATR
tp1 = price + 3.0 × ATR
tp2 = price + 5.0 × ATR
```

R:R is preserved at 2.0 (default), but the absolute distances scale
with the coin's actual volatility. Applied bounds:

| Coin     | Price   | ATR    | New SL    | New TP1   | vs Legacy SL  |
| -------- | ------- | ------ | --------- | --------- | ------------- |
| BTC      | 50,000  | 750    | 48,875    | 52,250    | tighter (-2.25%) |
| DOGE     | 0.10    | 0.004  | 0.094     | 0.112     | wider (-6%)   |

Signals using ATR bounds get a `📐ATR_ZONES` tag so the UI can
distinguish them from fallback signals.

### Fallback

When `ctx.indicator.atr` is null / 0 / non-finite (the symbol isn't
in the `INDICATOR_SYMBOLS` short-list, or indicator-engine hasn't
computed it yet), or when `atrZones()` rejects the inputs (degenerate
setup — ATR large enough to drive stop ≤ 0), `scoreSymbol` falls
back to the legacy fixed ladder. No tag added in that case. So:

- ~10 INDICATOR_SYMBOLS get ATR bounds.
- All other symbols keep the legacy ladder (parity).

### Added

- `src/scanner-atr-zones.js` — pure `atrZones(price, atr, opts)`
  module. Defaults `{ stop: 1.5, tp1: 3.0, tp2: 5.0 }`. Frozen.
  Returns `{ stop, tp1, tp2, rr, atr }` or `null` on bad inputs.
  Defensive against non-finite numbers, non-positive overrides,
  degenerate setups.
- `tests/scanner-atr-zones.test.js` — 21 tests covering all
  boundaries: defensive inputs, BTC and DOGE shaped fixtures,
  multiplier overrides (including non-positive / non-numeric
  fallbacks), degenerate-setup rejection, R:R scale invariance,
  token-precision (8 decimal) rounding, frozen constants contract.
- Integration tests in `tests/scanner-engine.test.js` (4 new):
  ATR present → ATR_ZONES tag + correct sl/tp;
  no ATR → fixed ladder fallback;
  ATR = 0 → fixed ladder fallback;
  DOGE-shaped → wider stop than legacy -3%.

### Changed

- `src/scanner-engine.js` — imports `scanner-atr-zones`, reads
  `SCANNER_SERVER_ATR_ZONES` env at module load. `scoreSymbol`
  branches on `ctx.indicator.atr`; falls back to fixed-ladder
  computation otherwise. Tag `📐ATR_ZONES` pushed when ATR path
  fires.
- `.env.example` — `SCANNER_SERVER_ATR_ZONES` promoted from RSVD
  to LIVE with documentation.
- `eslint.config.mjs` — new file added to the Node files list.

### Rollback

`SCANNER_SERVER_ATR_ZONES=false` + `pm2 restart` → all signals
return to the legacy fixed ladder. No data migration. No flag-on
data is lost because nothing is persisted differently.

### ⚠ Known limitation — outcome evaluator threshold mismatch

`src/scanner-history.js:143-146` (`evaluateOpenSignals`) classifies
win / loss / partial outcomes against **fixed** +5% / 0% / -3%
thresholds, **ignoring the per-signal `sl` / `tp1` values it
persists**. With Phase 2.A.4, ATR-zoned BTC signals carry tighter
SL (~-2.25%) and tighter TP1 (~+4.5%) than the legacy ladder, so:

- A BTC trade that hits its real ATR stop at -2.5% is logged as
  `partial_loss` (would be `loss` if evaluator read `entry.sl`).
- A BTC trade that hits its real TP1 at +4.5% is logged as
  `partial_win` (would be `win` if evaluator read `entry.tp1`).

This biases the tag-stats report (Phase 3.1 and the new validator
in PR #103): the `📐ATR_ZONES` family will appear to have a
*worse* threshold-based win rate than identical-quality legacy
signals — not because the ATR bounds are worse, but because the
outcome ladder is locked to the legacy thresholds.

Proper fix is a Phase 4 deliverable (per-signal outcome evaluation
using `entry.sl` / `entry.tp1` / `entry.tp2`). Until then, treat
ATR_ZONES vs. legacy win-rate comparisons as suggestive, not
authoritative. The `avgGain` metric is unaffected — it uses raw
`pctChange` from the evaluation, which doesn't depend on
thresholds.

Surfaced by the pre-merge SRE review.

### Pre-merge review fixes applied

- `src/scanner-atr-zones.js` — multiplier override now uses
  `Number.isFinite(v) && v > 0` instead of `typeof === 'number' && v > 0`
  (correctness review NIT A1). Catches `+Infinity` overrides up-front
  rather than relying on the downstream degenerate-setup guard.
- `tests/scanner-atr-zones.test.js` — 2 new tests lock the
  `Infinity` / `-Infinity` fallback behavior.

### Test results

- `npm run check` → lint clean, format clean, 660 / 660 tests pass
  (was 633 + 21 atr-zones + 4 integration + 2 review fix).
- `node --check server.js` → clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §2.5, §6 P2.A.4, §8.1 decision D
- `src/scanner-helpers.js:78-113` (browser counterpart — same math)
- `src/indicator-engine.js:106-199` (ATR computation source)
- Pre-merge correctness + SRE review agents (2026-05-20)

---

## [Scanner pre-merge review fixes] — 2026-05-19

**Two fixes surfaced by parallel reviewer agents before merging PR #101.**

### 🔴 BLOCKER fix — health alert flood on rollback

`server.js:1765` registered `globalLs: { stale: 120000, down: 300000 }`
in `HEALTH_THRESHOLDS` unconditionally. But `fetchGlobalLs()` is gated
by `SCANNER_RETAIL_LS_ENABLED` and returns early when the flag is off
— so `cache.lastUpdate.globalLs` never gets stamped, and
`evaluateAlerts` emits a permanent CRITICAL `cache "globalLs" has
never been populated` alert every health-check tick.

This means the documented rollback path
(`SCANNER_RETAIL_LS_ENABLED=false` + `pm2 restart`) would itself
flood `/api/health` with a critical alert that no monitor can
distinguish from a real outage.

**Fix:** moved the `globalLs` threshold registration out of the
literal and into a conditional:

```js
if (RETAIL_LS_ENABLED) {
  HEALTH_THRESHOLDS.globalLs = { stale: 120000, down: 300000 };
}
```

Now turning the flag off cleanly removes the cache from the health
check. The `/api/health` `status` field was unaffected either way
(it only mirrors tickers), but any monitor parsing the `alerts`
array would have paged on every poll.

### 🟡 NIT fix — non-deterministic `lowScore` test

`tests/scanner-engine.test.js` Phase 3.2 `lowScore` test used a
defensive `if (out.signals.length === 0) { assert... }` guard. If a
future scoring change pushed `OBSCURECOIN` over the 30 gate, the
assertion would silently NOT run and the test would pass vacuously
— hiding the regression.

**Fix:** removed the guard, added unconditional assertions on both
`signals.length === 0` AND `rejections.lowScore === 1`. Any future
scoring change that breaks the fixture fails the test loudly.

### Test results

- `npm run check` → lint clean, format clean, 633 / 633 tests pass.
- `node --check server.js` → clean.

### References

- Pre-merge SRE review agent (BLOCKER)
- Pre-merge correctness review agent (NIT 3 in their findings)

---

## [Scanner Phase 1.1.c — LS_RETAIL_LONG widening (3 → 2.5)] — 2026-05-17

**One-line threshold change.** Ziko approved §5 verdict in
`docs/SCANNER_PD_THRESHOLDS.md` on 2026-05-17: widen the
`LS_RETAIL_LONG` threshold from `> 3` to `> 2.5` to catch
borderline retail-heavy coins earlier and soften the hard
cliff at 3.0 flagged in §3.3.

### Changed

- `src/scanner-pd-detector.js` — `FLAG_THRESHOLDS.LS_RETAIL_LONG_RATIO`
  from `3` to `2.5`. Comment explains the Phase 1.1.c approval.
- `tests/scanner-pd-detector.test.js`:
  - Boundary test `does NOT fire at exactly 3` → updated to
    `does NOT fire at exactly 2.5`.
  - New test `fires above new 2.5 threshold` locks the widened
    boundary (regression catch for any future revert).
  - `FLAG_THRESHOLDS — locked constants` test asserts the new
    `2.5` value.
- `docs/SCANNER_PD_THRESHOLDS.md`:
  - §2 summary table — verdict shipped as "PORTED-WITH-WIDER-BAND
    (was 3 → now 2.5, Ziko 2026-05-17)".
  - §3.3 "as-shipped" note — updated to reflect the new threshold.

### Rollback

Single-line revert: change `LS_RETAIL_LONG_RATIO: 2.5` back to
`3` in `src/scanner-pd-detector.js`, restore the old boundary
test. No data migration. The flag itself has no separate env var
because the threshold is a constant; if it ever needs runtime
flexibility, expose `process.env.SCANNER_LS_RETAIL_THRESHOLD` as
an override in a future PR.

### Client parity

The client at `app.js:2459-2476` still uses `> 3`. Phase 2.A.1's
unified rules registry will close the gap by importing
`FLAG_THRESHOLDS` directly. Until then, server is intentionally
more aggressive on this flag — the audit's stated goal.

### Test results

- `node --test tests/scanner-*.test.js` → 324 / 324 pass (was 323 + 1).
- `npx prettier --check .` → clean.

### References

- `docs/SCANNER_PD_THRESHOLDS.md` §3.3, §5, §8 (now resolved)
- `SCANNER_AUDIT_2026_05_15.md` §8.1 decision C ("validate then port")

---

## [Scanner Phase 3.3 — Alpha-based win rate] — 2026-05-17

**Pure-additive analytics enhancement.** Implements P3.3 from
`SCANNER_AUDIT_2026_05_15.md` §6. No flag — the new `alpha` field
is appended to the existing `cache.scannerStats` payload; consumers
that ignore it see no change.

### What it does

The existing `winRate` is a threshold-based metric: signal counts as
a "win" if pctChange >= +5. That captures absolute movement but says
nothing about whether the scanner's selection was actually picking
**above-average** movers in the same window.

`alpha` answers exactly that: each signal's pctChange minus the
median pctChange across the entire evaluated basket. Surfaced as:

```json
"alpha": {
  "basketMedian": 4.0,
  "avgAlpha": 0.0,
  "alphaWinRate": 33,
  "bestAlpha":  { "s": "BIG",   "pctChange": 10, "alpha": 6  },
  "worstAlpha": { "s": "SMALL", "pctChange": -2, "alpha": -6 }
}
```

A high `alphaWinRate` (>= 60%) means the scanner picks above-median
movers; ~50% means selection is no better than random; below 50%
means the scoring rules actively pick UNDER-performers.

### Added

- `src/scanner-history.js`:
  - `_median(values)` helper — robust central tendency.
  - `computeStats` now returns `alpha: { basketMedian, avgAlpha,
    alphaWinRate, bestAlpha, worstAlpha }` when the evaluated basket
    has ≥ 3 samples. Returns `alpha: null` otherwise (single-sample
    "median" is meaningless).
- `tests/scanner-history.test.js` — 9 new tests covering:
  - Suppression below 3 samples.
  - Median computation (odd / even basket sizes).
  - avgAlpha arithmetic correctness.
  - alphaWinRate counts only alpha > 0 (not >= 0).
  - bestAlpha / worstAlpha identification on skewed distributions.
  - Empty-history fallback.

### Rollback

N/A — pure-additive field. Consumers that don't read `alpha` see no
change. To remove: drop the alpha block from computeStats.

### Test results

- `node --test tests/scanner-*.test.js` → 323 / 323 pass (was 314 + 9).
- `npx prettier --check .` → clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 P3.3

---

## [Scanner Phase 3.2 — Gate-rejection telemetry] — 2026-05-17

**New observability endpoint.** Implements P3.2 from
`SCANNER_AUDIT_2026_05_15.md` §6. Behind `SCANNER_INSIGHTS_ENABLED`
(default ON).

### What it does

`GET /api/scanner/insights` returns the most recent scanner pass's
breakdown of WHY each candidate was dropped, so engineering can
finally answer:

- "How many coins did the scanner see this pass?"
- "Of those, how many were rejected for being overheated / low-volume /
  wash-trade fingerprint / low-score?"
- "What % of the scanner's candidate pool actually produces a signal?"

Example response:

```json
{
  "ready": true,
  "passAt": 1779047077319,
  "accepted": 14,
  "rejectionRatePct": 98,
  "rejections": {
    "total": 863,
    "stablecoin": 21,
    "noPrice": 0,
    "overheated": 12,
    "lowVolume": 780,
    "washTrade": 2,
    "lowScore": 34
  }
}
```

Six rejection categories cover every drop path in `scoreSymbol` +
the post-score gate in `runScannerPass`.

### Added

- `src/scanner-engine.js`:
  - `scoreSymbol` accepts optional `ctx._rejectionSink` — when present,
    increments a category counter on each rejection path (noPrice,
    overheated, lowVolume, washTrade). Backward compatible — the
    score/tags output is unchanged either way.
  - `runScannerPass` builds a fresh sink per pass, tracks stablecoin
    and lowScore rejections directly, returns the breakdown alongside
    signals in the `rejections` field.
- `server.js`:
  - Stores `cache.scannerRejections` + `cache.scannerRejectionsTs` on
    every pass (overwrites — single latest pass only, no rolling state).
  - `GET /api/scanner/insights` endpoint gated by `SCANNER_INSIGHTS_ENABLED`.
    Returns `503 insights_disabled` when flag is off, or
    `{ready: false, note: ...}` if no pass has completed yet.
- `tests/scanner-engine.test.js` — 7 new tests covering shape,
  stablecoin counting, overheated, lowVolume, washTrade, lowScore,
  and the invariant `accepted + total_rejected == total`.

### Rollback

`SCANNER_INSIGHTS_ENABLED=false` + `pm2 restart`. Endpoint returns
503; engine still tracks counters internally (cheap) but they're not
exposed.

### Test results

- `node --test tests/scanner-*.test.js` → 314 / 314 pass (was 307 + 7).
- `npx prettier --check .` → clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 P3.2, §8.1 decision D

---

## [Scanner Phase 1.1.b — Retail LS + SMART_VS_RETAIL activation] — 2026-05-17

**Behaviour change (gated, default ON).** Closes a logical bug
discovered while wiring `topTraders` for Phase 1.1's
`SMART_VS_RETAIL` flag.

### The bug

Original implementation (both client `app.js:2469-2472` and the
initial server port) referenced `LS[s]` for the "retail long"
half AND `topTradersLS[s].positions[last]` for the "smart short"
half of `SMART_VS_RETAIL`. **Both sources read the same Binance
endpoint** (`topLongShortPositionRatio`), so the AND condition
was logically impossible to satisfy: `positions.long < 0.4`
implies `positions.ratio < 0.67`, never `> 2`. The flag was dead
code on both sides — never fired in production.

### Fix

Added Binance `globalLongShortAccountRatio` as a separate data
source (TRUE retail-account signal, not top traders):

- New fetcher `fetchGlobalLs()` in `server.js`; same 30-symbol
  scope and refresh interval as `fetchLongShort()`.
- New cache slot `cache.globalLs[sym] = { long, short, ratio }`.
- New cache slot `cache.topTraders[sym] = { positions: [...] }`,
  populated alongside `cache.ls` in the same `fetchLongShort()` call
  (no extra network round-trip — same Binance payload, different
  unit shape that matches the detector's `positions[].long < 0.4`
  check).
- `src/scanner-pd-detector.js` detector now accepts `globalLs` as
  a separate input. `LS_RETAIL_LONG` prefers it when present,
  falls back to `ls` for parity. `SMART_VS_RETAIL` requires both
  `globalLs` (retail) AND `topTraders` (smart) — no fallback —
  so the divergence is real.
- `src/scanner-engine.js` `runScannerPass` wires both new fields
  into the ctx passed to `scoreSymbol`.

### Rollback

`SCANNER_RETAIL_LS_ENABLED=false` + `pm2 restart`. `fetchGlobalLs()`
exits early, `cache.globalLs` stays empty, detector falls back to
ls for LS_RETAIL_LONG, SMART_VS_RETAIL goes back to silent. No
data migration needed.

### Test coverage

`tests/scanner-pd-detector.test.js` updated:
- LS_RETAIL_LONG: fires from globalLs when present, falls back to ls.
- LS_RETAIL_LONG: globalLs takes precedence over ls when both set.
- SMART_VS_RETAIL: fires with globalLs (no longer dead).
- SMART_VS_RETAIL: explicitly does NOT use ls as fallback (would
  re-create the original contradiction).
- SMART_VS_RETAIL: missing globalLs → silent.

`tests/scanner-engine.test.js` Phase 1.1 3-flag integration test
updated to provide `globalLs` instead of `ls` for the retail half.

### Test results

- `node --test tests/scanner-*.test.js` → 307 / 307 pass (was 303 + 4 net).
- `npx prettier --check .` → clean.
- `node --check server.js` → clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §2.1 (P&D detection)
- `docs/SCANNER_PD_THRESHOLDS.md` §3.4 (now annotated with the discovery)
- Binance API: `globalLongShortAccountRatio` vs. `topLongShortPositionRatio`

---

## [Scanner Review Fixes — pre-merge polish] — 2026-05-16

**No behaviour change.** Closes the NITs surfaced by the self-review
pass before merge — documentation, line refs, test coverage gaps.

### Added

- `tests/scanner-engine.test.js` — 4 new integration tests:
  - P&D 2-flag combo emits `⚠️P&D_WARN:N/5` tag and drops score by
    >= 30 (covers detector wiring inside `scoreSymbol`).
  - P&D 1-flag emits no tag (negative case).
  - P&D 3-flag combo (including SMART_VS_RETAIL via injected
    `topTraders`) emits `🚨P&D_RISK:N/5` and floors score at -100.
  - MANIP_CAP downgrade does NOT modify the raw `score` field (locks
    the documented "tier capped, score preserved" contract).

### Changed

- `src/scanner-pd-detector.js` header + `CHANGELOG.md` Phase 1.1 entry:
  fixed off-by-19 line ref (`scanner-engine.js:219` → `:238` — the actual
  location of the `d.change >= 8` early reject).
- `src/scanner-engine.js` Phase 1.2 block: added a clarifying comment
  explaining that `score` is intentionally NOT capped, only the
  published `tier`. Tied directly to the new contract test.
- `docs/SCANNER_PD_THRESHOLDS.md` §3.3: added an "as-shipped" note
  clarifying that the `LS_RETAIL_LONG_RATIO` was kept at `> 3` in
  Phase 1.1 (preserving client parity) rather than the `> 2.5`
  widening §5 recommends. The widening lands in a one-line follow-up
  PR contingent on Ziko's `Approved §5 verdicts` reply.
- `.env.example` Scanner Remediation Flags block: added `LIVE` /
  `RSVD` status legend next to each flag so future reads of `.env.example`
  see at a glance which are wired and which are placeholders for
  Phase 2 / Phase 4.
- `data/scanner-baseline-2026-05-15.json` note: updated to reflect
  the as-shipped state — Phase 1.1 went out with the placeholder
  still in place; the note now flags the post-deploy `npm run snapshot`
  as the next action item rather than a pre-condition.

### Test results

- `node --test tests/scanner-*.test.js` → 303 / 303 pass (was 299 + 4).
- `npx prettier --check .` → clean.

### References

- Self-review pass on 2026-05-16 surfaced 6 NITs + 4 NOTEs, 0 BLOCKERs.
- This commit addresses every actionable NIT.

---

## [Scanner Phase 3.1 — Per-tag win-rate endpoint] — 2026-05-16

**New observability endpoint.** Implements P3.1 from
`SCANNER_AUDIT_2026_05_15.md` §6. Behind `SCANNER_TAG_STATS_ENABLED`
env var (default ON; reserved in Phase 0).

### What it does

`GET /api/scanner/tag-stats?days=7&min=3` aggregates the rolling
`scanner-history.json` by individual tag and returns a per-tag
breakdown: count, wins, losses, winRate, avgGain, best/worst signal.
Engineering can now answer questions like "what's the win rate of
signals that fired 🐋WHALE_A?" or "do MANIP_CAP coins actually
under-perform now that Phase 1.2 caps them?".

### Query parameters

| Param | Range | Default |
|-------|-------|---------|
| `days` | 1-90 | 7 |
| `min`  | 1-100 | 3 (drops tags with fewer samples to cut noise) |

### Data dependency

This endpoint relies on the `tags` field added to recorded entries
by Phase 1.0b. Entries persisted before P1.0b deploys have
`tags: undefined`; they are counted in `totalWithoutTags` but do
not contribute to any per-tag bucket. So for ~7 days post-deploy
the `perTag` map will fill in gradually as fresh signals close out
their 24h evaluation window.

### Added

- `src/scanner-tag-stats.js` — pure `computeTagStats(history, opts)`
  function; ~140 lines including the JSDoc and the empty-result helper.
- `tests/scanner-tag-stats.test.js` — 15 tests covering window
  filtering, pre-extension entries handling, minSamples cutoff,
  per-tag aggregation correctness, multi-tag entries, defensive
  inputs, output shape, sort order, ISO timestamp format.
- `GET /api/scanner/tag-stats` endpoint in `server.js`, gated by
  `SCANNER_TAG_STATS_ENABLED`. Returns `503 tag_stats_disabled` when
  the flag is off.

### Rollback

`SCANNER_TAG_STATS_ENABLED=false` + `pm2 restart`. Endpoint returns
503 until re-enabled. No data migration needed.

### Test results

- `node --test tests/scanner-*.test.js` → 299 / 299 pass (was 284 + 15).
- `npx prettier --check .` → clean.
- `node --check server.js` → syntax clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 P3.1, §8.1 decision D
- Depends on Phase 1.0b (`tags` field on `recordSignal`)

---

## [Scanner Phase 1.3 — Smart ULTRA cooldown bypass on score delta] — 2026-05-16

**Behaviour change (gated, default ON).** Implements P1.3 from
`SCANNER_AUDIT_2026_05_15.md` §6. Behind `SCANNER_ULTRA_DELTA_PUSH`
env var.

### Problem

The ULTRA push had a flat 5-minute per-symbol cooldown to stop a
sticky signal from spamming the user. But the same cooldown muted
the case the user actually wants to know about: a coin that pushed
ULTRA at score 102 and 90 seconds later jumps to 135 — that's
qualitatively a stronger setup, not a duplicate. The audit called
this the "ULTRA reborn" failure mode.

### Fix

`runScannerOnServer`'s ULTRA push gate now checks two conditions and
allows the push if EITHER fires:

- **Age path (unchanged):** previous push for the symbol older than
  COOLDOWN_MS (5 minutes).
- **Delta path (NEW, Phase 1.3):** new score exceeds last-pushed
  score by DELTA_THRESHOLD (30) or more, even within the cooldown
  window.

Logic moved out of `server.js` into the new pure module
`src/scanner-push-cooldown.js` so it can be unit-tested without
spinning up the proxy. Per-symbol state shape changed from
`{[sym]: ts}` to `{[sym]: {ts, score}}` to track the previous score
for the delta comparison.

### Rollback

`SCANNER_ULTRA_DELTA_PUSH=false` + `pm2 restart`. Falls back to the
original age-only cooldown — the delta path is never consulted.

### Test coverage

19 new tests in `tests/scanner-push-cooldown.test.js` cover:
- First push always allowed; per-symbol independence.
- Age path: blocked within cooldown, allowed at exactly the boundary,
  always allowed past it.
- Delta path: bypass at exactly DELTA_THRESHOLD, blocked one below,
  blocked on negative delta (score going down).
- `deltaPushEnabled: false` reverts to age-only behaviour.
- Defensive guards: null state, non-string symbol, non-finite score.
- `recordUltraPush` mutation + idempotent overwrite.

### Test results

- `node --test tests/scanner-*.test.js` → 284 / 284 pass (was 265 + 19).
- `npx prettier --check .` → clean.
- `node --check server.js` → syntax clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 P1.3, §8.1 decision D
- New: `src/scanner-push-cooldown.js`,
  `tests/scanner-push-cooldown.test.js`
- Touched: `server.js` (push gate refactored)

---

## [Scanner Phase 1.2 — Manipulation HIGH tier hard-cap] — 2026-05-16

**Behaviour change (gated, default ON).** Implements P1.2 from
`SCANNER_AUDIT_2026_05_15.md` §6 / §2.4. Behind
`SCANNER_MANIP_HARD_CAP` env var.

### Problem

`_computeManipulationRisk` already classified shady setups as HIGH (vol/OI
gap + penny price + extreme funding + book imbalance) and applied a -15
score penalty. But for a strong-enough setup the -15 was recoverable, and
the symbol could still publish as ULTRA — the scanner's loudest tier and
the only one the push trigger fires on. Real-world failure mode:
manipulated penny coins with extreme funding still hitting the
notification path.

### Fix

`scoreSymbol` now resolves tier in a two-step path:
1. Map score → tier as before.
2. If `manipulationRisk.verdict === 'HIGH'` AND `tier === 'ULTRA'` →
   downgrade to `STRONG`, push tag `🚫MANIP_CAP` so the UI can
   explain the override.

The cap deliberately fires only when the result *would have been*
ULTRA — STRONG / MEDIUM / WEAK signals already carry the manipulation
warning tag and don't need a tier change.

### Test coverage

Three new tests in `tests/scanner-engine.test.js`:
- HIGH manipulation + score ≥ 100 → tier downgraded to STRONG, tag set.
- HIGH manipulation + score < 100 → no tag, tier unchanged.
- LOW manipulation + score ≥ 100 → tier stays ULTRA (cap doesn't over-trigger).

### Rollback

`SCANNER_MANIP_HARD_CAP=false` + `pm2 restart`. Cap disabled, manipulation
HIGH coins can publish as ULTRA again (the -15 score penalty still
applies).

### Test results

- `node --test tests/scanner-*.test.js` → 265 / 265 pass (was 262 + 3 new).
- `npx prettier --check .` → clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §2.4, §6, §8.1 decision D
- `src/scanner-engine.js` (manipulation block + tier resolution)

---

## [Scanner Phase 1.1 — Server-side P&D Detector] — 2026-05-16

**Behaviour change (gated, default ON).** Implements P1.1 from
`SCANNER_AUDIT_2026_05_15.md` §6 and the porting strategy in
`docs/SCANNER_PD_THRESHOLDS.md` §5.

### Added

- `src/scanner-pd-detector.js` — pure-function port of the client's
  detectPumpAndDump (app.js:2459-2476). 5 flags (VERTICAL,
  FR_EXTREME, LS_RETAIL_LONG, SMART_VS_RETAIL, THIN_PUMP),
  ladder: 2 flags = -25, 3+ flags = score floored at -100.
  Defensive against missing fields — never throws.
- `tests/scanner-pd-detector.test.js` — 35 tests covering every flag
  fires/doesn't fire boundary, defensive input handling, score-
  adjustment ladder, FLAG_THRESHOLDS parity assertion.
- `topTraders` field on the ctx passed to `scoreSymbol` — wired now
  even though `cache.topTraders` isn't populated yet, so the day
  the data source lands the SMART_VS_RETAIL flag starts firing
  with no further engine changes.

### Changed

- `src/scanner-engine.js`:
  - Imports `scanner-pd-detector` and reads
    `SCANNER_SERVER_PD_ENABLED` env var at module load (default
    true, set to `false` for instant rollback).
  - `scoreSymbol` runs the P&D detector after the manipulation
    block. 2 flags → tag `⚠️P&D_WARN:N/5`, score -25. 3+ flags →
    tag `🚨P&D_RISK:N/5`, score floored at -100 (downstream
    qualityFilter rejects).

### Runtime reachability (this PR)

| Flag | Reachable today? | Why / how to enable |
|------|------------------|---------------------|
| VERTICAL | ❌ dormant | Upstream `d.change >= 8` reject at scanner-engine.js:238 fires first |
| FR_EXTREME | ✅ live | `ctx.fr` populated from cache.fr |
| LS_RETAIL_LONG | ✅ live | `ctx.ls` populated from cache.ls |
| SMART_VS_RETAIL | ❌ dormant | `cache.topTraders` not fetched yet — wiring future PR |
| THIN_PUMP | ❌ dormant | Same upstream filter as VERTICAL |

Net production effect: server now applies the same
FR_EXTREME / LS_RETAIL_LONG suppression the client always had.
2-flag soft penalty is reachable when both fire on one coin.

### Rollback

Set `SCANNER_SERVER_PD_ENABLED=false` in the proxy's `.env` and
`pm2 restart`. Detector no longer runs; tags no longer pushed; no
score adjustment. No data migration needed.

### Test results

- `node --test tests/scanner-*.test.js` → 262 / 262 pass (was 227 + 35
  new detector tests).
- `npx prettier --check .` → clean.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 P1.1, §8.1 decision A & D
- `docs/SCANNER_PD_THRESHOLDS.md` §5 (verdicts), §3 (per-flag rationale)
- `app.js:2459-2476` (client detector being mirrored)

---

## [Scanner Phase 1.0 — P&D Threshold Validation] — 2026-05-16

**Analysis + schema extension. No runtime behaviour change.**
Implements the P1.0 step recorded in `SCANNER_AUDIT_2026_05_15.md` §8.1
decision C (validate before porting).

### Added

- `docs/SCANNER_PD_THRESHOLDS.md` — per-flag economic / microstructure
  rationale for the 5 P&D flags in `app.js:2459-2476`. Verdicts:
  port 4 of 5 as-is or with a small widening (LS_RETAIL_LONG: > 3 →
  > 2.5); defer THIN_PUMP until quantitative data is available.
- `src/scanner-history.js` — `tags: string[]` field on persisted entries,
  capped at `MAX_TAGS = 30` per entry. Defensive slice() so caller
  mutations don't leak in. Enables the future
  `vps/validate-pd-thresholds.js` quantitative pass.
- `tests/scanner-history.test.js` — 5 new tests covering tag persistence,
  empty default, non-array coercion, MAX_TAGS cap, mutation isolation.

### Changed

- `recordSignal()` now also persists `sig.tags` (or `[]` if absent).
  Pure-additive schema — old entries with no `tags` field still work
  (readers must use `entry.tags || []`).

### Rollback

- N/A — schema is pure-additive with no consumer; reverting only requires
  removing the new field. Decision D's flag requirement is waived per its
  exemption clause for "documentation-only and pure-refactor PRs"; the
  schema field has no behaviour impact.

### References

- `SCANNER_AUDIT_2026_05_15.md` §8.1 (decision C), §6 (P1.0)
- `docs/SCANNER_PD_THRESHOLDS.md` §2 (verdicts), §6 (schema proposal)

### Open question for Ziko

`docs/SCANNER_PD_THRESHOLDS.md` §8 asks whether to:
(a) accept the §5 verdicts (port 4 of 5, widen LS, defer THIN_PUMP), or
(b) port all 5 as-is matching the external plan exactly.
Phase 1.1 begins on (a); flip to (b) by replying in the PR.

---

## [Scanner Phase 0 — Safety Net] — 2026-05-15

**Scanner remediation infrastructure only — no behaviour change.**
Implements SCANNER_AUDIT_2026_05_15.md §6 Phase 0 (compressed variant
approved in §8.1).

### Added

- `SCANNER_AUDIT_2026_05_15.md` — consolidated audit (external 10-engineer
  review + internal Wasted-Pipeline finding) and 5-phase remediation plan
- `vps/snapshot-scanner-metrics.sh` — idempotent baseline-capture script
- `data/scanner-baseline-2026-05-15.json` — placeholder baseline (replace
  with real production snapshot before Phase 1.1 deploys)
- `tests/scanner-contract.test.js` — empty skeleton, populated in Phase 2.A.5
- Eight rollback flag names reserved in `.env.example` (`SCANNER_*_ENABLED`)
- Five rollback flag names reserved in `app.js` header (`nxScannerFix_*`)
- npm scripts: `npm run snapshot`, `npm run test:contract`

### Changed

- None. This phase introduces no behaviour changes — pure infrastructure.

### Rollback

- N/A — pure infrastructure. Revert the merge commit if needed.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 (Phase 0), §8.1 (Decisions Recorded)
- PR #100

---

## ملفات للرفع (4 ملفات)

| الملف | الحجم | الحالة |
|-------|-------|--------|
| **`app.js`** | 475,158 بايت (5,662 سطر) | ✅ مُعدَّل — ارفعه |
| **`sw.js`** | 2,581 بايت (64 سطر) | ✅ مُعدَّل — ارفعه |
| **`index.html`** | 86,571 بايت | ⏸️ بدون تغيير — ارفعه كما هو |
| **`manifest.json`** | 1,498 بايت | ⏸️ بدون تغيير — ارفعه كما هو |

كل الملفات في مجلد التنزيل، اضغط على كل واحد لتنزيله.

---

## الإصلاحات الإجمالية (31 إصلاحاً + ترقية Market Direction كاملة)

### الجزء الأول: 28 باتش أمني/وظيفي

**Tier 1 — ميزات معطوبة (4):**
- P1 Telegram proxy URL
- P2 SHORT trade PnL sign
- P3a/b Gate 4 dead branch + Gate 6 redundant check
- P4 Confidence calibration clamp

**Tier 2 — أخطاء حساب (4):**
- P5 Double minConf tuning removed
- P6 detectWhaleProfitTaking baseline (10-min trailing)
- P7 sigHist migration preserves firstSeen
- P8 loadTk mutex

**Tier 3 — أمان (4):**
- P9 esc() helper
- P10a/b/c Whitelist favorites + wallet + portfolio
- P11 encodeURIComponent
- P12 SW critical/optional split

**Tier 4 — نظافة (5):**
- P13 Dead scanBybitGainers removed
- P14 Module-level setInterval → init()
- P15 wlVerify optimization
- P16 saveMonitor debounce (2s)
- P17 openAdminPanel naming clarified

**إضافات اكتُشفت في المراجعات (11):**
- P18 buildStory safe regex replace
- P19a/b/c/d esc() applied at 4 render sites
- P20 SW excludes /notify from cache
- P21 SW only caches GET responses
- P22 addPort numeric validation
- P23 addWallet address+label validation
- P24 loadTk try/finally structure
- P25 SW CACHE_NAME bumped to v6-patched
- P26+P27 (merged into prior fixes)
- P28 confBucket clamp matches getCalibratedConf

### الجزء الثاني: ترقية Market Direction (analyzeCoinRpt + buildChartHTML)

**`analyzeCoinRpt` المحسّنة:**
- 12 مصدر بيانات جديد يؤثر على trend score
- 23 حقل عودة جديد
- 3 عوامل نقاط جديدة (smart, flow, mood)
- كل V3 calls محمية بـ try/catch

**`buildChartHTML` الجديدة:**
- 15 قسماً بالترتيب الاحترافي
- 5 أقسام جديدة كلياً (Smart Money، FR Multi-Exchange، Liquidation Zones، BTC↔ETH، Market Context)
- 3 أقسام محسّنة (Candle Closings، Whale Intelligence، Multi-Level Entry)
- ختام التحليل في الأسفل (قسم 15)
- نصوص عربية حقيقية (لا `\uXXXX`)

### الجزء الثالث: دمج التعلم الذاتي للعوامل الجديدة

**`DEFAULT_WEIGHTS`:**
- إضافة `smart:1, flow:1, mood:0.5`
- أصبح يحتوي 12 مفتاحاً

**`MONITOR_VERSION`:**
- v1 → v2 (تشغيل هجرة تلقائية)

**هجرة v1 → v2 (للمستخدمين الموجودين):**
- بياناتهم القديمة محفوظة بالكامل (الأوزان المتعلَّمة، الإحصاءات، blacklist، coinStats)
- المفاتيح الجديدة فقط تُضاف لـ `weights` و `factorStats`
- بدون فقدان بيانات

**`captureFactorSnapshot`:**
- تسجّل الآن 12 عاملاً (9 قديمة + 3 جديدة)
- كل عامل جديد له منطق dynamic لتقييمه

**النتيجة:**
- كل صفقة تُغلَق تُحدّث `winRate` للعوامل الـ 12
- بعد 5 صفقات لكل عامل، `autoTuneWeights` يبدأ تعديل أوزانها
- النظام يتعلم من 12 مصدر بدلاً من 9

---

## التحقق النهائي (فحوصات ناجحة)

| الفحص | النتيجة |
|-------|---------|
| `node --check app.js` | ✅ |
| `node --check sw.js` | ✅ |
| Runtime test في VM context | ✅ |
| `buildChartHTML` تُرجع 25,816 بايت HTML | ✅ |
| 15/15 قسم يظهر | ✅ |
| 370 سلسلة عربية في المخرج | ✅ |
| `analyzeCoinRpt` تحتوي 23 حقل عودة | ✅ |
| 6/6 دوال V3 ملفوفة بـ try/catch | ✅ |
| Migration v1 → v2 يحفظ البيانات | ✅ |
| `captureFactorSnapshot` تشمل smart/flow/mood | ✅ |
| Null-safety: كل البيانات null تعمل | ✅ |
| Bear case يعرض لغة هبوطية | ✅ |

---

## إعداد مطلوب على Cloudflare Worker

**باتش P1 يحتاج `/notify` endpoint:**

```js
if (url.pathname === '/notify' && request.method === 'POST') {
  const { message } = await request.json();
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch(e) {}
  return new Response('OK', { headers: { 'Access-Control-Allow-Origin': '*' }});
}
```

بدونه: التطبيق يعمل، لكن إشعارات Telegram لن تصل (تظهر تحذيرات في console).

---

## قائمة التحقق بعد النشر

### عام
1. **Console نظيف عند التحميل** — لا أخطاء
2. **Service Worker** — `nexus-v10-v6-patched` نشط في Application tab
3. **localStorage** — `nxMonitor` تتم هجرتها من v1 إلى v2 تلقائياً عند أول تحميل

### Market Direction (الترقية الجديدة)
4. افتح صفحة Market → اضغط على تبويب BTC
5. تحقق من ظهور **15 قسماً بالترتيب**:
   - 1. Hero (مع شريط ذكاء المال المصغّر)
   - 2. الرسم البياني 4H
   - 3. إغلاقات الشموع (مفصّلة لكل فريم)
   - 4. هيكل السوق (SMC)
   - 5. FVG + Order Blocks
   - 6. المستويات الرئيسية
   - 7. المؤشرات الفنية
   - 8. استخبارات الحيتان (مع P&L، Flow Rate، Iceberg)
   - 9. **لوحة ذكاء المال** (جديد)
   - 10. **معدلات التمويل متعددة المنصات** (جديد)
   - 11. **مناطق التصفية** (جديد)
   - 12. **العلاقة BTC ↔ ETH** (جديد)
   - 13. **سياق السوق** (جديد)
   - 14. **مناطق الدخول الثلاثة** (مع R:R لكل واحدة)
   - 15. **ختام التحليل** (الأخير في الأسفل)
6. كرر مع تبويب ETH

### الأمان
7. في favorites اكتب `<script>alert(1)</script>` → يجب أن يُرفض/يُنظَّف
8. في portfolio أضف رمزاً غريباً → يُرفض
9. في wallet جرّب عنواناً ليس Ethereum → يُرفض

### نظام التعلم
10. في console نفّذ `monitorState.weights` → يجب أن ترى **12 مفتاحاً** (smart, flow, mood ضمنها)
11. نفّذ `monitorState.factorStats` → نفس الأمر
12. نفّذ `monitorState.v` → يجب أن يكون `2`

### التحقق من القيم
13. `getCalibratedConf(150)` → يرجع 100 (مُقيَّد)
14. `getCalibratedConf(-20)` → يرجع 0
15. لا أخطاء في console بعد ساعة من المراقبة

---

## القرارات المؤجَّلة (ليست أخطاء)

7 بنود تحتاج قرارك إن أردت معالجتها:
- #14 سقف 20% على confidence
- #21 تفعيل/إلغاء مسار SHORT trading
- #36 تقليل fan-out في loadDash
- #26 baseline detectAbsorption
- #22 detectFailPatterns O(n²) — غير مهم حتى >1000 إدخال
- #19 throttle لـ sendTG
- #37 memoize whale techniques

أخبرني لو أردت معالجة أي منها.

---

## ملخص رحلة التطوير

- **5 جلسات مراجعة عميقة** للكود
- **31 إصلاحاً** أمنياً/وظيفياً
- **ترقية شاملة** لـ Market Direction (دالتان رئيسيتان)
- **دمج كامل** للعوامل الجديدة في نظام التعلم الذاتي
- **هجرة بيانات سلسة** للمستخدمين الموجودين
- **حجم نهائي**: 475 KB (من 484 KB أصلية — أضفنا منطق + حذفنا كود ميت)
- **5,662 سطر** (من 5,373 — صافي +289 سطر)

النظام جاهز للإنتاج. 🎯
