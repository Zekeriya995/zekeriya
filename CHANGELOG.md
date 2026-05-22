# NEXUS PRO V10 — التسليم النهائي الشامل

## [Gem Hunter — quality audit fixes] — 2026-05-22

**Scope: Gem Hunter (`صيد الجواهر`) tab only.** Four coordinated
fixes after a hands-on audit of the gem grid in production
(2026-05-22 screenshot review):

### What the audit found

Five candidates surfaced in the gem grid; only one (PSG, 2.5x
vol, +8.2%) was a real signal. The other four were noise:

| Coin | vx | 24h | Issue |
|---|---|---|---|
| PLUME | 1.0x | +2.0% | vx below scoring threshold, surfacing on timing alone |
| NXPC | 0.3x | +2.8% | volume DECLINING but classified as "early" |
| HYPER | 1.6x | **-6.8%** | falling knife passed as "Early — Enter!" |
| MEGA | 1.9x | **-6.2%** | same pattern |

Signal-to-noise: 1/5 = 20%. Unacceptable for a production
"opportunity hunter" tab.

### The four coordinated fixes

#### 1. Falling-trend gate in `scoreGemCandidate`

`src/scanner-helpers.js` — coins with `ticker.c < -5%` now
short-circuit with `{ score: 0, tags: ['🔻FALLING'], blocked: true }`.
Threshold (-5%) intentionally matches:
- the freshness=`old` cutoff in `app.js deepAnalyze`
- the stale-drawdown gate in `qualityFilterRejectReason`

Consistent falling-knife posture across the whole scanner now.
Pinned by 5 boundary tests (-5% exact passes, -5.01% blocks,
HYPER -6.8% case locked, null ticker.c does not block).

#### 2. Tightened momentum gate in `loadSmallCaps2`

`app.js:2064` — was `vx>=1.5 OR timing in [early,still]` (OR).
Now requires BOTH:

```js
hasMomentum = (vx >= 1.5 && timing in [early, still])
           OR (vx >= 1.2 && timing === 'early')
```

The second clause is a small relaxation for clearly-early
candidates (the spike hasn't fully materialized yet but price
is fresh). `'late'` timing always rejected — the move has
already played out.

NXPC (vx=0.3, early) and PLUME (vx=1.0, early) both fall
below the new floor.

#### 3. Numeric score badge per card

`app.js renderSmallCaps` — each card now shows its raw score
as a pill ("73 pts"). Color ladder mirrors the existing visual
semantics:

| Score | Color |
|---|---|
| 85+ | green (`var(--up)`) |
| 70-84 | neon (`var(--neon)`) |
| 50-69 | warn (`var(--warn)`) |
| 35-49 | muted (`var(--t2)`) |

Pre-fix all cards looked equally credible regardless of whether
they were at the SCORE_MIN floor (35) or at 75+. Now the user
can calibrate confidence per card.

#### 4. MC transparency

`app.js renderSmallCaps` — when `g.mc === 0` (CoinGecko data
missing), the MC label now renders in warn color with a
"⚠" prefix. The audit noted that the MC range filter at
`app.js:2010` only enforces when `mc > 0`, so coins with no
known MC slip past the cap-range guard silently. Surfacing
the "unknown" state makes the user aware that this candidate
wasn't size-gated.

### Files changed

- `src/scanner-helpers.js scoreGemCandidate` — +13 lines for
  the falling-trend gate (with doc-block explaining the audit
  case)
- `app.js loadSmallCaps2` (~line 2064) — momentum gate
  tightened, plus a `blocked` skip before target/stop math
- `app.js renderSmallCaps` (~line 2114) — score badge
  + MC warning chip
- `tests/scanner-helpers.test.js` — **+5 tests** covering
  the trend gate (block, boundary, regression, null-safety)

### Verification

- `npm run check` → **802/802 tests pass** (+5).
- Lint + format clean.

### Expected user-visible impact

Applied to the audit's 5-candidate snapshot:

| Coin | Pre-fix | Post-fix |
|---|---|---|
| PLUME (1.0x, +2.0%) | shown | **hidden** (vx < 1.2) |
| NXPC (0.3x, +2.8%) | shown | **hidden** (vx < 1.2) |
| **PSG (2.5x, +8.2%)** | shown | **shown** with explicit score |
| HYPER (1.6x, -6.8%) | shown | **hidden** (trend gate) |
| MEGA (1.9x, -6.2%) | shown | **hidden** (trend gate) |

S/N ratio: 20% → **100%**.

### Rollback

`git revert <merge-commit>`. The trend gate is one short-circuit
in `scoreGemCandidate`; the momentum gate is a single boolean
expression; the score badge and MC warning are pure HTML-string
additions in the render function. All localised to the Gem
Hunter — no other tab affected.

### Out of scope (filed for later)

- The "all 5 cards showing 11 min" pattern from the screenshot
  could indicate `gemTrackFirstSeen` stamping all cards with
  scan-cycle time instead of true detection time. Needs a
  dedicated investigation; not in this PR.
- The `RUG_MAX = 70` threshold inherits from the original
  audit; could be tightened to 50 once we have more failure
  data (currently every shown card passes "safe").

## [Scanner — stale-signal display fix + downward-drift gate] — 2026-05-21

**User-visible bug fix.** Closes the ETH 2026-05-21 screenshot
case where a signal detected at $2,363 with current price
$2,134 (-9.7% from detection) was still displayed as
"🟢 إشارة قوية — فرصة حقيقية" alongside a "قد يكون متأخراً"
warning. Three coordinated changes:

### 1. New qualityFilter gate: `stale-drawdown`

`src/scanner-helpers.js qualityFilterRejectReason` previously
only rejected upward drift (`drift > 8`, "missed the pump").
A signal whose price has DROPPED ≥5% from detection is now
also rejected with reason `stale-drawdown`.

Asymmetric thresholds (5% down, 8% up) by design: downward
drift is more dangerous — chasing a falling setup is worse
than missing a pump. Pinned by a dedicated test.

The ETH case (-9.7%) is now blocked at the qualityFilter — it
won't even render as a card. Test fixture uses the exact
$2,363 → $2,134 numbers.

### 2. Verdict block is now freshness-aware

`app.js` signal-card render previously read only `s.conf` for
the verdict line, so a score-80 signal showed "🟢 إشارة قوية"
even when `freshness === 'old'`. Now the verdict downgrade
ladder respects freshness:

| Condition | Verdict |
|---|---|
| conf ≥ 85 + ULTRA + fresh | 🟢 إشارة ممتازة — ادخل بثقة |
| conf ≥ 80 + fresh | 🟢 إشارة قوية — فرصة حقيقية |
| conf ≥ 70 + (fresh OR warm) | 🟡 فرصة جيدة — ادخل بحذر |
| freshness === 'old' (any conf) | ⚪ إشارة قديمة — للمراقبة فقط |
| conf ≥ 55 | 🔵 إشارة متوسطة — للمراقبة |
| else | ⚪ فرصة محتملة — راقب فقط |

Stale signals now ALWAYS show the muted "for monitoring only"
verdict, regardless of their raw score. The contradiction
"green badge + late warning" can no longer happen.

### 3. Timing label distinguishes re-emergence from fresh detection

`app.js` timing block previously printed "ظهر منذ الآن" when
`ageMinutes < 1`, even when the signal had been re-detected
after `src/portfolio.js recSig` had reset `firstSeen` on the
1h dormancy clause (preserving `priceAtDetection` for the
drift gate — see the comment in `recSig`).

Result: card claimed "appeared just now" while showing a
detection price hours / days old. Now:

```js
const _isReEmergence = sigAge < 5 && Math.abs(sigDrift) >= 2;
const ageText = _isReEmergence ? 'إعادة ظهور' : ...
```

When the age is fresh AND drift ≥2% the label switches to
"إعادة ظهور" (re-emerged), clarifying that the signal is a
return-after-dormancy rather than a brand-new detection.

### Files changed

- `src/scanner-helpers.js qualityFilterRejectReason`: +5 lines
  for the downward-drift gate, with a doc-comment explaining
  the ETH motivating case and the asymmetry rationale
- `app.js` signal card render: 2 blocks updated (verdict ladder
  + timing label)
- `tests/scanner-helpers.test.js`: **+2 tests** pinning the
  -5% boundary, -9.7% ETH case, and the asymmetric 5-vs-8
  invariant

### Verification

- `npm run check` — 797/797 tests pass (+2).
- Manual: after deploy + hard-refresh in browser, ETH-like
  signals with drift < -5% no longer render as cards. Borderline
  cases (-2% to -5% drift) render with the "إشارة قديمة" muted
  verdict.

### Rollback

`git revert <merge-commit>`. The drift gate has the same shape
as the original (just one extra `if`); reverting is trivial.

### Future considerations (not in this PR)

- The fast-mode signal type (10-30 min scalps) uses fixed
  ±1.5%/-0.5% bounds regardless of ATR. In a -9.7%-dropped
  market the -0.5% stop is too tight. A future PR could
  tier-aware-ATR-ize fast-mode too.
- `src/portfolio.js recSig` preserves `priceAtDetection`
  across 1h dormancy resets. The qualityFilter and UX fixes
  here mean the preservation is now strictly beneficial
  (drift gate keeps protecting), but a future refactor could
  split the data model into `firstDetectionPrice` (preserved)
  and `lastSeenPrice` (updated) for cleaner semantics.

## [Scanner Phase 4 Part 3 — ctx-based hybrid attribution] — 2026-05-21

**Server-side.** Extends `computeRuleAttribution` to **replay
each rule's condition against the persisted ctx** when present,
falling back to the original tag-membership check otherwise.

### The capability this unlocks

Before Part 3, the 3 tagless rules (`CHANGE_PENALTY_GT3`,
`CHANGE_PENALTY_GT5`, `BTC_NOT_OK_PENALTY`) were structurally
unattributable — they don't push anything into the tag bag, so
the tag-based attribution from PR #125 had nothing to look at.

Part 3 lets the harness replay `rule.condition(entry.ctx)`
directly. For tagless rules this is the ONLY way to know if
they fired; for tagged rules it's a stricter equivalent that
also catches a class of bug where the tag string drifts between
the registry and the signal emitter.

### Hybrid attribution logic

For each (rule, entry) pair:

1. If `entry.ctx` exists AND rule has a `condition` function →
   replay condition. Most accurate; covers tagless rules.
2. Else if rule has a tag → tag-membership in `entry.tags`
   (the original Part 1 behaviour). Backwards-compatible with
   old entries on disk.
3. Else (tagless + no ctx) → SKIP. Cannot attribute.

For TAGGED rules with ctx, both methods produce identical
answers because the same condition produced the tag at signal
time. The hybrid only changes behaviour for tagless rules +
new entries — strictly additive.

### Defensive: buggy rule conditions

If a rule's condition function throws, the (rule, entry) pair
is skipped silently. The backtest never crashes. Tested
explicitly.

### Output shape addition

Each `perRule[ruleId]` entry now includes
`attributableEntries: N` — how many entries could be attributed
to this rule (via ctx OR tag). A rule with
`attributableEntries: 0` is omitted from `perRule` to keep the
output clean. The `tag` field can now be `null` for tagless
rules attributed via ctx.

### Files changed

- `src/scanner-backtest.js` — both `computeRuleAttribution` and
  its `byTier` companion loop now use the hybrid (ctx-first,
  tag-fallback) attribution.
- `tests/scanner-backtest.test.js` — **+5 tests** covering
  tagless attribution via ctx, tagged rule attributed via ctx
  (no tag in tags), mixed history backwards-compat, buggy
  condition tolerance, tagless-without-ctx skip.

### Verification

- `npm run check` — **795/795 tests pass** (+5 over PR #127's
  790).

### Operational note

Until ~24h of ctx-bearing entries accumulate post-deploy, the
hybrid path won't fire for any entry — all entries on disk are
from before PR #127 and lack ctx. Backwards compat keeps the
backtest working in the meantime. After the first day, new
entries start carrying ctx and the tagless rules appear in the
`/api/scanner/backtest` response.

### Rollback

`git revert`. Pure additive: removes the ctx-replay path; falls
back to PR #125 tag-based behaviour for all entries.

## [Scanner Phase 4 Part 2 — ctx capture for backtest harness] — 2026-05-21

**Server-side. Foundation for richer Phase 4 analyses.** Adds the
input ctx that the registry consumed at signal-scoring time to
each persisted scanner-history entry. Enables future PRs to:

1. **Attribute tagless rules** (`CHANGE_PENALTY_GT3` /
   `CHANGE_PENALTY_GT5` / `BTC_NOT_OK_PENALTY`) — these don't
   appear in the persisted tag bag, so tag-based attribution
   (PR #125) can't see them.
2. **Replay rule modifications** against historical signals
   (real A/B backtesting): re-run `applyRules` with rule
   weights / conditions modified and compare against actual
   outcomes.

### Implementation

- `scoreSymbol` builds the registry ctx as a named `_ruleCtx`
  const and returns it on the signal under `ctx`. Consumers
  that don't care (PWA cards, push payload) ignore the field.
- `scanner-history.recordSignal` sanitises + persists `sig.ctx`
  via an **allowlist + per-field type schema** (`CTX_TYPE_MAP`):
  - Unknown keys silently dropped — no accidental private-state
    leak to the on-disk JSON.
  - Type mismatches silently dropped (string in a boolean slot
    → ignored, matching registry rules' strict `typeof` gates).
  - Strings capped at 32 chars.
  - `NaN` / `Infinity` rejected.
- Entries without `sig.ctx` (legacy signals) get NO `ctx` field
  — backwards compatible.

### Storage cost

Each ctx serialises to ~250-400 bytes. At 1000 entries the file
grows ~200 KB → ~600 KB worst case. Acceptable for the analytic
value.

### Files changed

- `src/scanner-engine.js` — `scoreSymbol` extracts the registry
  input ctx into a named `_ruleCtx` const, then returns it on
  the signal object.
- `src/scanner-history.js` — new `CTX_TYPE_MAP`,
  `CTX_ALLOWLIST_KEYS`, `_sanitizeCtx` exports. `recordSignal`
  invokes the sanitizer and attaches the result when non-null.
- `tests/scanner-history.test.js` — **+10 tests** covering
  sanitiser edge cases (null/non-object, allowlist, unknown
  keys dropped, type mismatches dropped, NaN/Infinity, string
  length cap), the allowlist contract, `recordSignal` ctx
  capture happy path, `recordSignal` backwards compat.

### Verification

- `npm run check` — **790/790 tests pass** (+10 over PR #125's
  781).

### Rollback

Data-capture only — no behaviour change. `git revert
<merge-commit>`. Old entries' `ctx` field stays on disk
harmlessly; code stops reading/writing it.

### Future work this unlocks

- **Part 3**: extend `scanner-backtest.js` to use `entry.ctx`
  when present, replaying every rule's condition against the
  ctx for proper attribution (covers the 3 tagless rules +
  any future schema-extended rules).
- **Part 4**: rule-modification A/B replay. Take a RULES
  override (e.g. `FALLING_KNIFE.weight = -30`), re-run
  `applyRules` against every entry's ctx, compare what the
  resulting tier would have been vs the recorded tier.

## [Scanner Phase 4 — Backtest harness (per-rule effectiveness)] — 2026-05-21

**Server-side. NEW READ-ONLY ENDPOINT. No state mutation. No
behaviour change to the scanner itself.**

Closes the last phase of the original
`SCANNER_AUDIT_2026_05_15.md` plan. Builds the per-rule
effectiveness attribution module that consumes scanner-history
and the unified registry to answer: **which rules actually
predict wins, and which ones hurt?**

### What it does

For each rule in the registry, `computeRuleAttribution(history,
rules, opts)`:

1. Partitions evaluated history (>= 24h old, within the
   look-back window) into two groups: signals where the rule's
   tag was present (`fired`) vs absent (`absent`).
2. Computes win rate + average pct-gain for each group.
3. **Marginal-gain delta:** `firedAvgGain − absentAvgGain`. A
   positive delta means "signals where this rule fired did
   better"; a negative delta means the rule is actively
   misleading the scorer.
4. Surfaces a **`suspiciousRules`** list: positive-weight rules
   whose presence correlates with WORSE outcomes. This is the
   worst kind of bug — the scoring formula is pulled in the
   wrong direction by its own weights. Surfacing these is the
   highest-ROI target for weight retuning.

### What it does NOT do (yet)

This is **simple correlation analysis**, not causal A/B
testing. Causality needs to replay `scoreSymbol` with the rule
disabled and compare which signals would still have fired —
that requires capturing the input `ctx` with each history entry
(future PR). For tonight, correlation is enough to flag the
obvious wins and losses.

### Known limitation: tagless rules

The 3 tagless rules introduced in PR F / PR H
(`CHANGE_PENALTY_GT3`, `CHANGE_PENALTY_GT5`, `BTC_NOT_OK_PENALTY`)
are **skipped** by the attribution helper — we can't tell from
the persisted scanner-history whether they fired (they push no
tag to the tag bag). They'll need ctx capture to attribute.

### New files

- `src/scanner-backtest.js` — pure module:
  - `computeRuleAttribution(history, rules, opts)` — the
    per-rule analyzer
  - `computeBacktestSummary(history, rules, opts)` — wrapper
    that bundles attribution + basket-wide aggregates
  - Exports `MIN_DEFAULT_SAMPLES = 5`, `DEFAULT_DAYS_BACK = 30`
- `tests/scanner-backtest.test.js` — **+14 tests** covering
  empty/null history, unevaluated entries, daysBack window,
  per-rule attribution math, suspicious-rule detection (the
  CRITICAL property), tagless-rule skip, low-sample
  exclusion-from-rankings, per-tier breakdown, summary
  integration, default constants, invalid-opt fallback.

### New endpoint

```
GET /api/scanner/backtest
  ?days=N (1-90, default 30)
  &min=N  (1-100, default 5)
```

Returns:

```json
{
  "windowDays": 30,
  "totalEvaluated": 243,
  "perRule": {
    "FALLING_KNIFE": {
      "tag": "🔪FALLING", "weight": -50,
      "fired": 12, "absent": 231,
      "firedWinRate": 8, "absentWinRate": 41,
      "firedAvgGain": -7.2, "absentAvgGain": 2.1,
      "delta": -9.3,
      "sampleSize": "sufficient"
    },
    ...
  },
  "byTier": { "ULTRA": {...}, "STRONG": {...} },
  "topPositiveDelta": ["MTF_BULL_FULL", "SILENT_ACCUMULATION", ...],
  "topNegativeDelta": ["FALLING_KNIFE", ...],
  "suspiciousRules": [],
  "basket": {
    "total": 243, "wins": 99, "losses": 41, "partials": 103,
    "winRate": 40, "avgGain": 1.8, "medianGain": 1.2
  }
}
```

### Server changes

- `server.js`:
  - +3 imports (`scannerBacktest`, `scoringRules`,
    `scannerTagStats` already imported)
  - +new `GET /api/scanner/backtest` endpoint gated by
    `SCANNER_BACKTEST_ENABLED` env flag (default ON)
- `.env.example` — documents `SCANNER_BACKTEST_ENABLED=true`

### Verification

- `npm run check` — 781/781 tests pass (+14 new).
- Manual verification post-deploy:
  ```bash
  curl -s https://shamcyrpto.com/api/scanner/backtest?days=7 \
    | python3 -m json.tool | head -50
  ```
  Expected: a JSON response with `totalEvaluated > 0` after
  tag-stats has accumulated signals (24h post-deploy minimum;
  meaningful after 7 days).

### Rollback

`SCANNER_BACKTEST_ENABLED=false` in `.env`, then
`pm2 restart --update-env`. Endpoint returns 503. The
underlying module remains available for direct require.

### Audit plan status — FINAL

| Phase | Status |
|---|---|
| 1.1 — Shared P&D detection | merged earlier |
| 1.1.b — Retail LS data source | merged earlier |
| 1.2 — Manipulation hard-cap | merged earlier |
| 1.3 — Smart ULTRA cooldown delta-bypass | merged earlier |
| 2.A.1 — Unified scoring rules registry | **EXTENDED COMPLETE** (35 rules) |
| 2.A.2 — PWA reads server signals | COMPLETE (3 ratchets) |
| 2.A.3 — Engine wired to THRESHOLDS | merged earlier |
| 2.A.4 — ATR-aware SL/TP bounds | merged earlier |
| 2.A.4.b — Tier-aware ATR multipliers | COMPLETE (PR #110) |
| 2.A.5 — Contract test populated | done as part of 2.A.1 |
| 3.1 — Per-tag win-rate tracking | merged earlier |
| 3.2 — Gate-rejection telemetry | merged earlier |
| **4 — Backtest harness** | **COMPLETE (this PR)** |

**Original audit plan: 100% delivered.** Phase 4 is the
foundation for future evidence-based weight tuning — its real
value materializes after tag-stats accumulates 14-30 days of
post-deploy signals.

## [Scanner Phase 2.A.1 PR H — REVERSAL / BTC_OK_* / CVD_BUY] — 2026-05-21

**Server-side: NO BEHAVIOUR CHANGE. Client-side: NO BEHAVIOUR
CHANGE.** Four more rules join the unified registry. Registry now
holds **35 rules total**.

### Rules added (4)

| Rule | Weight | Tag | Condition |
|---|---|---|---|
| `REVERSAL` | +12 | `🔄REVERSAL` | change in [-10, -3] + volume > 5e7 |
| `BTC_OK_BONUS` | +5 | `BTC✅` | `btcMarketOk === true` |
| `BTC_NOT_OK_PENALTY` | −10 | **null** (tagless) | `btcMarketOk === false` |
| `CVD_BUY` | +20 | `📊CVD_BUY` | `cvdTrend === 'BUYING' && cvdDelta > 0 && change < 3` |

All 4 were client-only data sources pre-PR-H. Server ctx omits
`btcMarketOk` / `cvdTrend` / `cvdDelta` → all 4 rules cleanly
no-op via strict equality / typeof gates (same Option-C pattern
as COINALYZE_OI in PR G).

### BTC market check — two-sided rule

The pre-PR-H inline was `if(btcOk){sc+=5;tags.push('BTC✅')} else
{sc-=10}`. Migrated as TWO rules:
- `BTC_OK_BONUS`: `btcMarketOk === true` → +5 with `BTC✅` tag
- `BTC_NOT_OK_PENALTY`: `btcMarketOk === false` → −10, tagless

The `=== true` / `=== false` strict checks (NOT `!==`) preserve
the server's pre-PR-H behaviour: server ctx has no `btcMarketOk`
field, so both rules see undefined and neither fires — matching
the server's pre-PR-H behaviour of not applying the BTC market
check at all.

### Files changed

- `src/scoring-rules.js` — +4 rules at end of array
- `app.js quickScan` — ctx extended with `btcMarketOk` /
  `cvdTrend` / `cvdDelta`; rule IDs added to forEach; inline
  REVERSAL / BTC check / CVD_BUY blocks deleted; defensive
  fallback extended
- `src/scanner-engine.js` — unchanged (these are client-only
  rules; server ctx omits the new fields)
- `tests/scoring-rules.test.js` — **+4 tests** covering
  REVERSAL boundaries, BTC_OK / BTC_NOT_OK mutual exclusion +
  server-ctx no-op, CVD_BUY boundaries, CVD_BUY server-ctx no-op

### Verification

- `npm run check` — 767/767 tests pass (+4 over PR G's 763).

### Rollback

No behaviour change. To revert: `git revert <merge-commit>`.

### Parity ratchet status (post-PR-H)

| PR | Migrated | Status |
|---|---|---|
| PR A-G | 30 rules (registry + ATR + FR/MTF/VOL/CHANGE/AT_HIGH/etc.) | merged |
| **PR H (this)** | **REVERSAL + BTC_OK_* + CVD_BUY (4 rules)** | **here** |

Plus FALLING_KNIFE → **35 rules in the registry.**

## [Scanner Phase 2.A.1 PR G — AT_HIGH / BOTTOM / TAKER / COINALYZE_OI] — 2026-05-21

**Server-side AND client-side: NO BEHAVIOUR CHANGE.** Four more
rules join the unified registry. Registry now holds **31 rules
total**.

### Rules added (4)

| Rule | Weight | Tag | Condition |
|---|---|---|---|
| `AT_HIGH` | +12 | `🎯AT_HIGH` | near 24h high + small positive change |
| `BOTTOM` | +10 | `📉BOTTOM` | lower 25% of 24h range + volume > 5e6 |
| `TAKER_SKEW` | +15 | `💹TAKER` | `takerRatio > takerAvg * 1.3` |
| `COINALYZE_OI` | +6 | `🌐OI` | multi-exchange OI positive + |change| < 3 (server-only) |

AT_HIGH / BOTTOM / TAKER_SKEW were inline on BOTH sides with
identical logic. COINALYZE_OI is server-only (client has no
aggregated multi-exchange OI feed) and uses the Option-C
typeof-gate pattern to no-op cleanly on the client.

### ctx extensions

| Field | Source | Notes |
|---|---|---|
| `high` | `d.high` (server) / `d.h` (client) | 24h high price |
| `low` | `d.low` / `d.l` | 24h low price |
| `price` | `d.price` / `d.p` | current price |
| `takerAvg` | `ctx.taker.avg` / `takerData[s].avg` | rolling avg |
| `takerRatio` | `ctx.taker.ratio` / `takerData[s].ratio` | spot ratio |
| `coinalyzeOIValue` | `ctx.coinalyzeOI.value` (server only) | aggregated OI |

### Files changed

- `src/scoring-rules.js` — +4 rules at end of array
- `src/scanner-engine.js` — extends applyRules ctx with 6 new
  fields; deletes inline AT_HIGH (was ~358-368), BOTTOM (was
  ~371-380), TAKER (was ~388-391), COINALYZE_OI (was ~392-395)
- `app.js quickScan` — extends ctx; adds AT_HIGH/BOTTOM/
  TAKER_SKEW to forEach; deletes inline blocks; defensive
  fallback extended
- `tests/scoring-rules.test.js` — **+8 tests** (per-rule
  boundaries + missing-data no-ops + client-ctx no-op for the
  server-only rule)

### Verification

- `npm run check` — 763/763 tests pass (+8 over PR F's 755).

### Rollback

No behaviour change. To revert: `git revert <merge-commit>`.

### Parity ratchet status (post-PR-G)

| PR | Migrated | Status |
|---|---|---|
| PR A | TIER1 + NEW + SILENT_ACC + EARLY + STEALTH | merged |
| PR B (client narrow) | SILENT_ACC + EARLY + STEALTH | merged |
| PR C | TIER1/TIER2/NEW (precedence) | merged |
| PR D | FR + LS + COINALYZE_FR_NEG | merged |
| PR E | MTF + RSI + MACD cross | merged |
| PR FINAL | docs cleanup | merged |
| PR F | VOL + change bands + late penalties | merged |
| **PR G (this)** | **AT_HIGH + BOTTOM + TAKER + COINALYZE_OI** | **here** |

Plus FALLING_KNIFE → **31 rules in the registry.**

## [Scanner Phase 2.A.1 PR F — VOL chain + change-band migration] — 2026-05-20

**Server-side AND client-side: NO BEHAVIOUR CHANGE.** Seven more
rules join the unified registry. The VOL chain (MEGA / HIGH /
NORMAL — 3 of the 4 client tiers; the 4th `📊vol` lowercase
stays inline because the server never had it) plus the four
change-band rules (RISING / LATE / late-penalty-GT3 /
late-penalty-GT5) are now declarative.

### Rules added (7)

| Rule | Weight | Tag | Condition |
|---|---|---|---|
| `VOL_MEGA` | +25 | `🔥MEGA_VOL` | `volume > 1e9` |
| `VOL_HIGH` | +18 | `📊HIGH_VOL` | `volume > 1e8 && volume <= 1e9` |
| `VOL_NORMAL` | +10 | `📊VOL` | `volume > 3e7 && volume <= 1e8` |
| `CHANGE_RISING` | +8 | `📈RISING` | `change >= 3 && change < 5` |
| `CHANGE_LATE` | −5 | `⚠️LATE` | `change >= 5 && change < 8` |
| `CHANGE_PENALTY_GT3` | −15 | **null** (tagless) | `change > 3` |
| `CHANGE_PENALTY_GT5` | −30 | **null** (tagless) | `change > 5` |

### VOL chain — server vs client divergence preserved

The client has a 4th tier `📊vol` (lowercase) at weight 5 for
`volume in (1e7, 3e7]` that the server NEVER had. Pre-PR-F the
two sides agreed on tiers 1-3 (MEGA/HIGH/NORMAL) and diverged
on tier 4. Migrating tier 4 to the registry would add `+5` to
server scoring on every coin in that volume range — a behaviour
change. **PR F preserves the divergence**: the 3 shared tiers
are in the registry, the 4th `📊vol` stays inline on the client
(now the ONLY inline scoring rule the client carries besides
the P&D detector and a few dynamic-tag rules).

### Change-band rules — INDEPENDENT, not mutually exclusive

Pre-PR-F the inline code had:
```js
if (change >= 3 && change < 5) score += 8; tags.push('📈RISING');
if (change >= 5 && change < 8) score -= 5; tags.push('⚠️LATE');
if (change > 3) score -= 15;
if (change > 5) score -= 30;
```

Note that RISING/LATE are mutually exclusive (disjoint change
ranges), but the late-penalty rules OVERLAP with both. The
registry models this as 4 INDEPENDENT rules — there's no
mutual-exclusion gate because the inline behaviour was already
"each fires independently when its condition matches". The
overlapping combinations a `change` value can trigger:

| change | Rules fired | Total |
|---|---|---|
| 3 | RISING only | +8 |
| 3.1 | RISING + PENALTY_GT3 | -7 |
| 4 | RISING + PENALTY_GT3 | -7 |
| 5 | LATE + PENALTY_GT3 | -20 |
| 5.1 | LATE + PENALTY_GT3 + PENALTY_GT5 | -50 |
| 6 | LATE + PENALTY_GT3 + PENALTY_GT5 | -50 |
| 8 | PENALTY_GT3 + PENALTY_GT5 only | -45 |
| 10 | PENALTY_GT3 + PENALTY_GT5 only | -45 |

`CHANGE_PENALTY_*` rules use `tag: null` per the rule shape (the
registry has supported tagless rules since PR A).

### Files changed

- `src/scoring-rules.js` — adds 7 rules at the end of `RULES`
  (after MACD_BEAR_CROSS).
- `src/scanner-engine.js` — DELETES the inline VOL chain (was
  lines 366-375) and the inline change bands + late penalties
  (was lines 354-363).
- `app.js quickScan` — DELETES the inline 3 VOL tiers (was
  2629-2631), inline change bands (was 2623-2627). KEEPS the
  4th tier `📊vol` line gated to `(d.v > 1e7 && d.v <= 3e7)`.
  Adds 7 new rule IDs to the forEach list. Defensive fallback
  extended to mirror the new inline-equivalent logic for
  registry-load failure parity.
- `tests/scoring-rules.test.js` — **+9 tests**:
  - VOL_MEGA / VOL_HIGH / VOL_NORMAL per-rule contract (3)
  - VOL chain exhaustive mutual exclusion across 12 volume
    samples (1)
  - CHANGE_RISING / CHANGE_LATE / CHANGE_PENALTY_GT3 /
    CHANGE_PENALTY_GT5 per-rule contract (4)
  - CHANGE overlap matrix (independent-rule additive behaviour)
    end-to-end via applyRules (1)
  Plus updates to 10 existing applyRules tests that need the
  VOL_NORMAL +10 added to their expected scores.

### Verification

- `npm run check` — 755/755 tests pass (+9 over PR E's 746).
- Server-side regression: `tests/scanner-engine.test.js` still
  passes (the inline deletions are compensated by the registry
  rules running on the same ctx).

### Rollback

No behaviour change. To revert: `git revert <merge-commit>`.

### Parity ratchet status — extended beyond the original plan

The original audit plan was Phase A through Phase E. PR F adds
this 7-rule batch on top of that — pure parity-ratchet hygiene.
Remaining inline rules in app.js / scanner-engine.js use
patterns that don't fit the current rule shape (dynamic tag
suffixes like `📗BID:Nx`, multi-tag whale waves, non-additive
scoring like P&D KILL). Those need shape extensions (`tagFn`,
`scoreFn`) before migration.

After PR F the registry holds **27 rules** (was 20 pre-PR-F).

## [Scanner Phase 2.A.1 PR D — FR / LS / coinalyzeFR migration] — 2026-05-20

**Server-side AND client-side: NO BEHAVIOUR CHANGE.** Bit-for-bit
equivalent. Five more rules join the unified registry, finishing
the migration of every FR/LS-related scoring rule.

### Rules added (5)

| Rule | Weight | Tag | Condition |
|---|---|---|---|
| `FR_VERY_NEG` | +12 | `FR⬇️` | `frRate < -0.01` |
| `FR_MILDLY_NEG` | +5 | `FR-` | `frRate < 0 && frRate >= -0.01` |
| `FR_OVEREXTENDED` | −8 | `FR⚠️` | `frRate > 0.08` |
| `LS_SHORTS` | +10 | `🩳SHORTS` | `lsRatio < 0.8` |
| `COINALYZE_FR_NEG` | +8 | `🌐FR_NEG` | `coinalyzeFRRate < -0.01` |

Each rule's condition starts with a strict `typeof === 'number'`
gate, so missing data sources cleanly no-op the rule.

### FR precedence — encoded in conditions, not control flow

The three `FR_*` rules form a mutually-exclusive precedence chain
(same Option-C pattern as TIER1 > TIER2 > NEW in PR C):

| frRate range | Fires |
|---|---|
| (−∞, −0.01) | FR_VERY_NEG (+12) |
| [−0.01, 0)  | FR_MILDLY_NEG (+5) |
| [0, 0.08]   | none (matches the inline `else if` drop-through) |
| (0.08, ∞)   | FR_OVEREXTENDED (−8) |

The middle "neutral" range is intentional — the original inline
chain on both sides had no `else { tag.push('FR=') }` branch.

### Client-side `coinalyzeFR` was NOT server-only (BLOCKER fix)

The first iteration of this PR claimed COINALYZE_FR_NEG was
"server-only — client has no coinalyzeFR feed". Pre-merge SRE
review caught this: the client DOES populate `coinalyzeFR[s]`
from `/api/all` multi-exchange data (`app.js:2205`), and the
inline rule at the bottom of `quickScan` (was line 2641) was
actively scoring `+8 / '🌐FR_NEG'` on the client. Bit-for-bit
client safety required:

  1. Extending the client `_ruleCtx` with `coinalyzeFRRate`
  2. Adding COINALYZE_FR_NEG to the client's forEach rule-id list
  3. DELETING the inline `if(coinalyzeFR[s]...)` at line 2641
  4. Adding the same coinalyzeFR check to the defensive fallback
     so a registry-load failure preserves identical scoring

All four landed in the BLOCKER fix amend on this branch.

### Files changed

- `src/scoring-rules.js` — adds 5 rules; doc updates the ctx
  shape with `frRate`, `lsRatio`, `coinalyzeFRRate`.
- `src/scanner-engine.js`:
  - Extends `applyRules` ctx with `frRate`, `lsRatio`,
    `coinalyzeFRRate` (sourced from `ctx.fr.rate`, `ctx.ls.ratio`,
    `ctx.coinalyzeFR.rate` with strict-number guards).
  - DELETES the inline FR chain, the inline LS_SHORTS block,
    and the inline coinalyzeFR neg block.
- `app.js quickScan`:
  - Extends the registry ctx with `frRate`, `lsRatio`,
    `coinalyzeFRRate`.
  - Adds `FR_VERY_NEG / FR_MILDLY_NEG / FR_OVEREXTENDED /
    LS_SHORTS / COINALYZE_FR_NEG` to the forEach rule-id list.
  - DELETES the inline FR chain (was app.js:2587-2589), the
    inline LS_SHORTS line (was 2592), AND the inline
    coinalyzeFR neg (was 2641, caught by BLOCKER fix).
  - The `var fr = FR[s]` declaration stays — it's still used by
    the P&D detector (`FR_EXTREME`) and the final
    `cands.push({...fr})` payload.
  - Defensive fallback path extended to also run the FR chain,
    LS_SHORTS, AND coinalyzeFR neg inline — so a registry-load
    failure produces identical scoring across all migrated rules.
- `tests/scoring-rules.test.js` — **+11 tests**.

### Verification

- `npm run check` — 733/733 tests pass (+11 over PR C's 722).
- Server-side: existing `tests/scanner-engine.test.js` still passes.

### Rollback

`git revert <merge-commit>`. No behaviour change.
## [Scanner Phase 2.A.1 PR E — MTF / RSI / MACD migration] — 2026-05-20

**Server-side: NO BEHAVIOUR CHANGE. Client-side: NO BEHAVIOUR
CHANGE (these rules were ALWAYS server-only).** Eight more rules
join the unified registry, migrating the MTF agreement chain
plus the RSI and MACD cross diagnostics.

### Rules added (8)

| Rule | Weight | Tag | Condition |
|---|---|---|---|
| `MTF_BULL_FULL` | +15 | `🎯MTF_BULL` | `mtfStrength === 'full' && mtfBias === 'bullish'` |
| `MTF_BULL_PARTIAL` | +8 | `🎯MTF_BULL_2` | `mtfStrength === 'partial' && mtfBias === 'bullish'` |
| `MTF_BEAR_FULL` | −10 | `🎯MTF_BEAR` | `mtfStrength === 'full' && mtfBias === 'bearish'` |
| `MTF_BEAR_PARTIAL` | −5 | `🎯MTF_BEAR_2` | `mtfStrength === 'partial' && mtfBias === 'bearish'` |
| `RSI_OS` | +10 | `📉RSI_OS` | `rsi < 30` |
| `RSI_OB` | −8 | `📈RSI_OB` | `rsi > 70` |
| `MACD_BULL_CROSS` | +12 | `📊MACD_BULL` | `macdCross === 'bull'` |
| `MACD_BEAR_CROSS` | −8 | `📊MACD_BEAR` | `macdCross === 'bear'` |

### Mutual exclusion (MTF chain)

The four `MTF_*` rules are mutually exclusive by construction:
`mtfStrength` is exactly one of `'full'`/`'partial'`/undefined
and `mtfBias` is exactly one of `'bullish'`/`'bearish'`/undefined.
So at most ONE of the four can fire per ctx — matching the
inline if/else if/else if/else if behaviour. Pinned by the
exhaustive `MTF — at most ONE of the 4 rules fires per ctx`
test.

### Server-only data, client no-op (Option-C)

These rules read `mtfStrength`/`mtfBias`/`rsi`/`macdCross` —
all derived from kline data the server's indicator engine
computes for INDICATOR_SYMBOLS. The client's `quickScan` has
NO inline equivalent — these are purely server-side
diagnostics today. Same strict-equality + `typeof === 'number'`
pattern PR D used for `coinalyzeFRRate`: the client passes none
of these fields → all 8 rules cleanly no-op → client scoring
unchanged.

### MACD histogram tie-breaker stays inline

The pre-PR-E MACD block had a third branch when `cross` was
neither 'bull' nor 'bear': add +3 (h > signal) or -3 (h <
signal) with NO tag. This is a tagless score-only adjustment
that doesn't fit the registry rule shape cleanly (would need
either a `tag: null` rule with positive AND negative weight or
two separate rules). Left inline below the registry call,
gated by `_m.cross !== 'bull' && _m.cross !== 'bear'` to
preserve the exact same if/else-if semantics. Tests cover the
registry rules; the inline tie-breaker is unchanged from
pre-PR-E behaviour.

### Files changed

- `src/scoring-rules.js` — adds 8 rules AFTER `FALLING_KNIFE` to
  avoid line-conflict with PR D's FR/LS additions. JSDoc ctx
  shape extended.
- `src/scanner-engine.js` — applyRules ctx extends with
  `mtfStrength / mtfBias / rsi / macdCross`; inline MTF and
  RSI/MACD blocks DELETED; histogram tiebreaker kept (gated
  on no-cross).
- `tests/scoring-rules.test.js` — **+13 tests** for the 8
  rules: per-rule contract, mutual-exclusion exhaustion (7
  ctx shapes), missing-data no-op for both client side and
  bad-data inputs, applyRules end-to-end for a fully-equipped
  server ctx and a bare client ctx.

### Verification

- `npm run check` — 735/735 tests pass (+13 over PR D's 722).
- `tests/scanner-engine.test.js` still passes — the inline
  MTF/RSI/MACD deletions are compensated by the registry rules
  running on the same ctx.

### Rollback

No behaviour change. To revert: `git revert <merge-commit>`.

### Parity ratchet status

| Phase 2.A.1 PR | Migrated | Status |
|---|---|---|
| PR A (server) | SILENT_ACC + EARLY + STEALTH + TIER1 + NEW | merged |
| PR B (client narrow) | SILENT_ACC + EARLY + STEALTH | merged |
| PR C (client tier chain) | TIER1 + TIER2 + NEW | merged |
| **PR D (FR / LS / coinalyzeFR)** | **5 rules above** | **merged** |
| PR E (MTF / RSI / MACD) | 8 rules — see entry above | this rebase |
| PR FINAL | cleanup + dead-code purge | pending |

## [Scanner Phase 2.A.2.3 — Client merges selected server tags] — 2026-05-20

**Client-side change. Adds visibility — does NOT change scoring
or tier.** Third ratchet of "PWA reads server signals". Same
overlay block in `getScanResults()`, same freshness/flag gates,
same rollback. The new piece: after the bounds and tier
overlays, promote specific server-only tags onto the client's
visible card so the user sees WHY a signal was bound by ATR
tier-1 multipliers (`📐ATR_T1`), suppressed (`🔪FALLING`),
capped (`🚫MANIP_CAP` / `🚨MANIP_HIGH` / `⚠️MANIP_MED`), or
flagged on negative-FR (`🌐FR_NEG`).

### Why this matters

Before this PR the user could see that a BTC card had `📡SRV`
(bounds overlaid) and possibly `🛑SRV_DEMOTE` (tier demoted)
— but not WHY the server demoted it. With this PR, the
demoting cause (e.g. `🚫MANIP_CAP`) is visible right next to
`🛑SRV_DEMOTE` on the same card, so the user can audit and
trust the demotion at a glance.

### The allowlist

Server-only tags promoted (exact match, no prefix):

| Tag | Origin (server) | Meaning |
|---|---|---|
| `📐ATR_T1` | `src/scanner-engine.js:644` (Phase 2.A.4.b) | tier-1 ATR multipliers applied |
| `📐ATR_ZONES` | `src/scanner-engine.js:633` (Phase 2.A.4) | ATR-aware bounds applied (vs fixed -3/+5/+10) |
| `🔪FALLING` | `src/scoring-rules.js:145` (PR #108) | FALLING_KNIFE rule fired (-50 score) |
| `🚫MANIP_CAP` | `src/scanner-engine.js:667` (Phase 1.2) | tier capped at STRONG due to MANIP HIGH |
| `🚨MANIP_HIGH` | `src/scanner-engine.js:567` (Phase 1.x) | manipulation HIGH verdict |
| `⚠️MANIP_MED` | `src/scanner-engine.js:570` | manipulation MEDIUM verdict |
| `🌐FR_NEG` | `src/scanner-engine.js:426` | server-side negative-FR aggregate flag |

### Why exact match and NOT prefix

The client already emits its own `🚨P&D_RISK:N/5` /
`⚠️P&D_WARN:N/5` (different N from the server — the two sides
count slightly different P&D flags). A naive prefix-merge would
surface BOTH the client's and server's variants on the same
card and confuse the user. Same for FR-related tags
(`FR⬇️`/`FR-`/`FR⚠️`) — the client computes those from its own
FR cache. So we promote only tags the client provably can't
emit.

### Files changed

- `app.js` line ~1030 (inside the same overlay block as PR
  #112 / #113): new merge loop runs AFTER the demotion check
  and BEFORE the bounds overlay. Iterates `_srv.tags`, promotes
  any allowlisted server tag not already present. Idempotent.
- `CHANGELOG.md` — this entry.

### Safety + rollback

- Same `nxScannerFix_server_signals` flag controls the entire
  overlay (bounds + tier + tag merge). One flip reverts all
  three ratchets.
- Same try/catch as PR #113 — tag merge failure cannot break
  the scanner; falls back to client's own tags.
- Each promoted tag must satisfy `typeof === 'string'` AND
  exact-match the allowlist. Anything else is silently dropped.
- Idempotent on repeated overlays (the `indexOf === -1` check).

### Verification

- `npm run check` — 722/722 tests pass.
- **Manual browser verification** post-deploy:
  1. Pull on VPS, restart pm2
  2. Open `shamcyrpto.com` → Scanner tab
  3. BTC / ETH card (with ATR data) should now carry `📐ATR_T1`
     AND `📐ATR_ZONES` tag chips
  4. Any card with `🛑SRV_DEMOTE` should also carry the
     specific demote reason — e.g. `🔪FALLING` (suppressed
     because the coin is down >10%) or `🚫MANIP_CAP`
     (manipulation capped tier).
  5. Rollback test (same as PR #113):
     `localStorage.setItem('nxScannerFix_server_signals','off')` +
     reload → all `📐ATR_T1` / `🔪FALLING` / `🚫MANIP_CAP` /
     etc. tags disappear from the cards, reverting to
     client-only computed tags.

## [Scanner Phase 2.A.1 PR C — TIER1 / TIER2 / NEW bonus migration] — 2026-05-20

**Server-side: NO BEHAVIOUR CHANGE.** **Client-side: NO BEHAVIOUR CHANGE.**
Bit-for-bit equivalent. Closes the architectural divergence noted
in CHANGELOG #109 by following Option C from the divergence table.

### What changed

- `src/scoring-rules.js`:
  - Adds `TIER2_BONUS` rule (`weight: 5`, `tag: '🥈T2'`,
    `condition: (ctx) => ctx.isTier2 === true`)
  - Tightens `NEW_BONUS` condition to
    `ctx.isTier1 === false && ctx.isTier2 !== true` so tier-2
    coins don't fire both TIER2_BONUS (+5) AND NEW_BONUS (+2)
- `app.js quickScan`:
  - The inline `if(isTier1){...} else if(isTier2){...} else
    {...}` chain is replaced by the registry-driven forEach,
    now including `TIER1_BONUS`, `TIER2_BONUS`, `NEW_BONUS`
    alongside the 3 migrated in PR B (SILENT_ACCUMULATION,
    EARLY_ENTRY, STEALTH).
  - The defensive `else` fallback (when `window.SCORING_RULES`
    didn't load) is extended to also run the tier chain inline
    — so a registry-load failure still produces bit-for-bit
    identical scoring (the original fallback only ran the
    accumulation rules).
- `tests/scoring-rules.test.js`:
  - +7 tests covering TIER2_BONUS shape/firing/exclusion,
    NEW_BONUS tier-2 gate, server-ctx (no isTier2) behaviour
    preservation, three-way mutual exclusion, applyRules
    end-to-end on a tier-2 client coin.

### Why Option C (vs A/B from #109)

| Option | Cost | Risk |
|---|---|---|
| A: drop isTier2 from client | smallest client diff | loses the +5 tier-2 medium tier on PWA — UX regression |
| B: add tier-2 list to server | best convergence | requires tier-2 coin list as data the server doesn't have today; another data source to keep in sync |
| C: TIER2_BONUS rule with isTier2 strict-check; server passes none | minimum diff, zero data migration | none |

Option C is provably no-op on the server: the strict `=== true`
check on `isTier2` rejects undefined cleanly, and the new
`!== true` gate on `NEW_BONUS` evaluates `undefined !== true`
truthy — so server scoring is bit-for-bit unchanged. Three
test cases pin this property as a contract.

### Verification

- `npm run check` — 720 / 720 tests pass (+7 from PR B's 713).
  Lint clean, format clean.
- Server-side regression: tests under `tests/scanner-engine.test.js`
  still pass — they pass server-style ctxs (no `isTier2`) and
  the test expectations rely on NEW_BONUS firing for non-tier-1
  coins, which still holds.

### Rollback

This PR has no behaviour change so no rollback flag is strictly
needed. To revert: `git revert <merge-commit>` on the server.

The Phase 0 namespace at `app.js:14` reserves
`nxScannerFix_unified_rules` for per-page localStorage rollback
of Phase 2.A.1 work, but the reservation is currently a
no-op — **no code reads it yet**. If a future PR needs to wire
real per-page rollback, it would gate the `if (window.SCORING_RULES)`
branch on that flag and fall back to the inline `else` path
when the flag is set to 'off'. Out of scope for PR C since
there's no behaviour to roll back.

The defensive `else` fallback in `quickScan` (which mirrors the
inline pre-PR-B/C path) only fires when `window.SCORING_RULES`
itself failed to load (CDN issue, ad-blocker stripping the
`<script>` tag, …). It is NOT a flag-driven rollback path —
flagging that distinction here so a future on-call doesn't
expect setting the flag to do anything.

### Parity ratchet status

| Phase 2.A.1 PR | Migrated rules | Status |
|---|---|---|
| PR A (server) | SILENT_ACC, EARLY, STEALTH + TIER1, NEW | merged |
| PR B (client, narrow) | SILENT_ACC, EARLY, STEALTH | merged |
| **PR C (client, tier-bonus chain)** | **TIER1, TIER2, NEW** | **this PR** |
| PR D (next) | FR / OBI / Whale rules | pending |
| PR E (next) | MTF / indicator rules | pending |
| PR FINAL | cleanup + dead-code purge | pending |

## [Scanner Phase 2.A.2.2 — Client demotes tier on server protective flags] — 2026-05-20

**Client-side change. ASYMMETRIC overlay: server can DEMOTE,
never PROMOTE.** Second ratchet of "PWA reads server signals".
Builds on Phase 2.A.2.1 — same overlay block in
`getScanResults()`, same freshness/flag gates, same rollback
path. The new piece: when the server's signal for a symbol
carries a protective tag (`🚫MANIP_CAP`, `🚨MANIP_HIGH`,
`🔪FALLING`, `🚨P&D_RISK:N/5`), the client demotes its own
`r.ultra` / `r.confirmed` booleans so the visible card reflects
the safer tier.

### Why asymmetric (DEMOTE-only)

The client's `deepAnalyze` has scoring rules the server doesn't
compute: `TIER2_BONUS`, `🐋✨WHALE_TARGET`, `📊CVD_BUY`,
`💹TAKER`, depth `📗WALL:Nx`, `📘BID_PRESS`, `📈OI_BUILD`,
`🧠SMART`, `🔄REVERSAL`, plus the kline-derived checks. A
symbol can be a legitimate client-ULTRA on the strength of
those signals even when the server's coarser view doesn't reach
ULTRA. Letting the server PROMOTE would either lose those rules
or require dragging them into the server registry first (which
is the rest of Phase 2.A.1 — out of scope here).

DEMOTE is safe regardless: the protective flags are themselves
asymmetric. `MANIP_CAP` only fires on manipulation HIGH;
`FALLING_KNIFE` only fires on coins down >10% / 24h;
`P&D_RISK` only fires when 3+ pump-and-dump indicators stack.
Each is a strong "avoid" signal that survives independently of
the client's richer scoring.

### Demotion ladder

| Client tier before | Server protective tag present | Client tier after |
|---|---|---|
| ULTRA (`r.ultra=true`)  | yes | CONFIRMED (`r.ultra=false`, `r.confirmed=true`) |
| CONFIRMED (`r.confirmed=true`) | yes | neither (both false) |
| neither | yes | neither (no-op) |
| any | no | unchanged |

When any demotion fires, `🛑SRV_DEMOTE` is added to the row's
tags so the user (and the client-side `tagPerf` map) can audit
which signals got demoted by which server flag (`📡SRV` for the
bounds overlay is added separately by Phase 2.A.2.1).

### Files changed

- `app.js` line ~1018 (inside the existing 2.A.2.1 overlay
  block): adds the tier demotion check after the bounds and tag
  overlay. Reads `_srv.tags` (already in the captured server
  signal), scans for any of the four protective prefixes, and
  applies the ULTRA→CONFIRMED→none cascade. Idempotent —
  re-running the overlay never additionally demotes a row.
- `CHANGELOG.md` — this entry.

### Safety + rollback

- Same `nxScannerFix_server_signals` flag controls the entire
  overlay (bounds + tier). `localStorage.setItem(...,'off')` +
  reload reverts both Phase 2.A.2.1 and .2.2 in one step.
- Same try/catch wraps the whole block; tier demotion failure
  cannot break the scanner.
- Tag-prefix matching uses `.indexOf(prefix)===0` to handle
  variable-suffix tags (`🚨P&D_RISK:3/5`, `🚫MANIP_CAP`, …)
  without depending on exact string equality.
- The demote-flag set is HARDCODED to the four protective tag
  prefixes — generic risk tags (`⚠️P&D_WARN`, `FR⚠️`,
  `⚠️LATE`) intentionally do NOT trigger demotion because the
  server already factored those into its own score, and the
  client's score also penalises them.

### Verification

- `npm run check` — 713/713 tests pass.
- **Manual browser verification** post-deploy:
  1. Pull on VPS, restart pm2
  2. Open `shamcyrpto.com` in browser → Scanner tab
  3. If any visible signal carries `🚫MANIP_CAP` / `🔪FALLING`
     / `🚨P&D_RISK` / `🚨MANIP_HIGH` tag → the card should
     also carry `🛑SRV_DEMOTE` AND the ⭐ ULTRA badge should
     be downgraded to 🟢 CONFIRMED (or neither if it was only
     CONFIRMED before).
  4. If no live signal carries a protective tag at the moment
     (common on calm days), force the case via DevTools:
     ```js
     window.__serverSignals['BTC'].tags.push('🚫MANIP_CAP');
     // wait one scanner tick (~60s) or force-refresh the
     // Scanner tab. BTC card should now carry 🛑SRV_DEMOTE.
     ```
     Remove the manual tag from the live signal after the
     check (or reload — `loadTk` rebuilds `__serverSignals`
     from the live `/api/all` payload).
  5. Rollback test: `localStorage.setItem('nxScannerFix_server_signals','off')`
     + reload → demotions should disappear, ULTRA/CONFIRMED
     restored to client's own determination.

## [Scanner Phase 2.A.2.1 — Client overlays server-computed SL/TP/RR] — 2026-05-20

**Client-side change. PARTIAL convergence to Phase 2.A.2.**
First ratchet of "PWA reads server signals". For any symbol the
server scanner has a fresh signal for (`/api/all` → `signals[]`,
indexed by `s`), the PWA overlays `sl` / `tp1` / `tp2` / `rr` from
the server result onto its own `deepAnalyze` output. Score, tier,
and other tags stay client-side for now (deferred to PR D2.A.2.2 /
.3).

### Why this finally surfaces 2.A.4.b for users

Phase 2.A.4.b shipped tier-aware ATR multipliers server-side, but
the BTC card in the PWA still showed the wider non-tier-1 TP1
(+6.5%) because the client's `scanner-helpers.js` atrZones never
knew about `TIER1_MULTS`. After this PR, the card shows the
server's tier-1 bounds directly (+3.92% TP1 on a typical BTC
setup). The `📡SRV` observability tag marks any signal whose
SL/TP/RR was overlaid from the server.

Note on tag-stats scope: `📡SRV` is added on the CLIENT after
the overlay step, so the server's `/api/scanner/tag-stats`
endpoint (which aggregates `pass.signals` produced by
`scoreSymbol` server-side) does NOT see this tag — it only sees
its own server tags (`📐ATR_ZONES`, `📐ATR_T1`, `🪙ULTRA`, ...).
The client's local `tagPerf` map (`app.js:1504`) DOES capture
`📡SRV` and persists per-tag outcomes to localStorage for that
individual user. A future server-side complement (emit `📡SRV`
on server signals whose bounds came from full-data scoring)
would let the cross-user tag-stats endpoint slice by this tag
too. Deferred.

### Files changed

- `app.js` line ~1973 (in `loadTk()`): captures `all.signals` into
  `window.__serverSignals` (keyed by symbol) and timestamps the
  capture. Falsy when the server has not run a pass yet — the
  overlay step no-ops cleanly.
- `app.js` line ~944 (in `getScanResults()`): after `deepAnalyze`
  resolves, walks the result list and overlays the server bounds
  in TWO places (the second is what makes the UI actually
  change):
    1. Top-level `_row.sl / .tp1 / .tp2 / .rr` — for any future
       consumer that reads them.
    2. `_row.smartEntry.stop / .target1 / .target2 / .rr` —
       this is the data path every visible card reads
       (`app.js:1353` trade-zone card, `:3111` ultraCard,
       `:6321` top-3 opps, `:2898` openTrade). Preserves the
       string-typed `rr` contract (`.toFixed(1)`) from
       deepAnalyze's `smartEntry` construction at line 2774.
       Also aligns `smartEntry.entry` to the server's
       reference price so displayed pct is exact, not a mix
       of server target / local entry.
  Adds the `📡SRV` tag to the overlaid row.
- `CHANGELOG.md` — this entry.

### Freshness + safety

- Server signals must be fresher than **5 minutes** to apply.
  Anything older falls back to the client's own values — defends
  against a stuck server scanner returning ancient bounds.
- Numeric overlay values must satisfy ALL of: `Number.isFinite`
  on `sl`/`tp1`/`tp2`/`rr`, plus `sl > 0`, `tp1 > sl`,
  `tp2 > 0`, `rr > 0`. Anything that fails any gate falls back
  to the client's local values unchanged.
- The entire overlay is wrapped in `try/catch` and never throws.
  Any failure is logged via `_scanWarn` (rate-limited) and the
  pass continues with pure-local bounds.

### Rollback (browser-side, no redeploy)

In the user's browser DevTools console:
```js
localStorage.setItem('nxScannerFix_server_signals','off');
location.reload();
```
The overlay block reads the flag every pass, so flipping it OFF
reverts to pure-local quickScan + deepAnalyze.

### Verification

- `npm run check` — lint + format + tests still green (app.js has
  no Node test suite; only the static bits are checked).
- **Manual browser verification REQUIRED** post-deploy:
  1. Pull on VPS, restart pm2
  2. Open `shamcyrpto.com` in browser
  3. Scanner tab — find a BTC or ETH signal
  4. The card should show TP1 ~+3-4% (was +6-7%)
  5. The card's tag chips should include `📡SRV`
  6. DevTools console: `window.__serverSignals` is a non-empty
     object keyed by symbol
  7. **Rollback test:** in DevTools console run
     `localStorage.setItem('nxScannerFix_server_signals','off')`
     then wait one scanner tick (~60s) OR `location.reload()`,
     and confirm: TP1 reverts to the local +6-7% value AND the
     `📡SRV` tag chip is gone. Then re-enable with
     `localStorage.removeItem('nxScannerFix_server_signals')`
     and verify the overlay returns.

## [Scanner Phase 2.A.4.b — Tier-aware ATR multipliers] — 2026-05-20

**Server-side behavior change. Tighter TP/SL bounds for tier-1 majors.**
Adds `TIER1_MULTS = { stop: 1.2, tp1: 1.8, tp2: 3.0 }` alongside the
existing `DEFAULT_MULTS = { stop: 1.5, tp1: 3.0, tp2: 5.0 }` in
`src/scanner-atr-zones.js`. The engine passes `isTier1` through to
`atrZones(price, atr, opts)` so tier-1 coins get the tighter
multipliers; non-tier-1 alts are unchanged.

### Motivation (the screenshot)

On 2026-05-20 Ziko shared a BTC signal showing entry $77,160 with
TP1 at +6.5% over a displayed "1-4 hour" window. The number was
mathematically consistent with the engine (BTC ATR(14) ~$1,680;
TP1 = price + 3.0 × ATR = $82,200 = +6.5%) but unrealistic in
practice: a +6.5% BTC move typically takes a half-day to a day,
not 1-4 hours. The same multipliers work fine for non-tier-1 alts
where +5% in an hour is routine.

### The new math (worked on the screenshot fixture)

| Bound | Non-tier-1 (old)          | Tier-1 (new)              |
|-------|---------------------------|---------------------------|
| stop  | $77,160 − 1.5×$1,680 = $74,640 (−3.27%) | $77,160 − 1.2×$1,680 = $75,144 (−2.61%) |
| tp1   | $77,160 + 3.0×$1,680 = $82,200 (+6.53%) | $77,160 + 1.8×$1,680 = $80,184 (+3.92%) |
| tp2   | $77,160 + 5.0×$1,680 = $85,560 (+10.88%) | $77,160 + 3.0×$1,680 = $82,200 (+6.53%) |
| R:R   | 2.00                       | 1.50                       |

The R:R drop from 2.0 → 1.5 is the explicit trade-off: less reward
per trade, but the target is actually reachable in the displayed
window. The audit's stated profitability floor is R:R ≥ 1.3, and
the new tier-1 R:R = 1.5 stays clear of it. A future tune below
1.3 would be caught by `tests/scanner-atr-zones.test.js`.

### Files changed

- `src/scanner-atr-zones.js` — adds `TIER1_MULTS`; `atrZones()` now
  accepts `opts.isTier1` and uses it to pick the baseline. Numeric
  overrides in `opts` still win over the tier baseline. Strict
  `=== true` check on `isTier1` (consistent with the registry
  rules) — anything else falls through to non-tier-1 defaults.
- `src/scanner-engine.js` — adds `SCANNER_TIER_AWARE_ATR_ZONES`
  env flag (default ON); when ON, passes
  `{ isTier1: TIER_AWARE_ATR_ENABLED && isTier1 }` to `atrZones`;
  when OFF, atrZones falls back to its non-tier-1 defaults for
  every symbol (bit-for-bit identical to pre-2.A.4.b behaviour).
- `tests/scanner-atr-zones.test.js` — +10 tests covering
  `TIER1_MULTS` shape, `isTier1=true/false/invalid` baseline
  selection, BTC fixture (locks the exact $80,184 TP1 number),
  DOGE non-tier-1 regression, override cascade interaction with
  tier-1.
- `.env.example` — documents `SCANNER_TIER_AWARE_ATR_ZONES=true`.
- `CHANGELOG.md` — this entry.

### Observability

When the tier-1 path fires, the engine adds a second tag
`📐ATR_T1` alongside the existing `📐ATR_ZONES`. The Phase 3.1
tag-stats pipeline picks this up automatically so we can answer
"did the tighter tier-1 multipliers actually improve win rate?"
after a few days of data. Without this tag, the two regimes
would be indistinguishable in historical data — impossible to
retrofit later.

### Rollback

`SCANNER_TIER_AWARE_ATR_ZONES=false` in `.env`, then
`sudo -u nexus pm2 restart nexus-proxy --update-env`. Engine
stops passing `isTier1=true` and tier-1 symbols revert to the
non-tier-1 multipliers (the only call-site is the
`atrZonesModule.atrZones(` call in `src/scanner-engine.js`).
The flag is read once at module load so a restart is required.

### Verification

- `npm run check` → 710 / 710 tests pass (10 new).
- **Manual verification post-deploy** — pull the branch on VPS,
  restart pm2, watch for a BTC/ETH ULTRA signal. The TP1
  percentage in the signal card should be ~3-4% (not 6-7% as
  before). XRP/SOL too. DOGE/SHIB/small-caps should be unchanged.

## [Scanner Phase 2.A.1 PR B — Client-side registry consumption (narrow)] — 2026-05-20

**Client-side refactor. NO BEHAVIOUR CHANGE — bit-for-bit equivalent.**
Migrates 3 of the 6 registry rules from inline `if` blocks in
`app.js quickScan` to a small dispatcher reading
`window.SCORING_RULES.RULES`. Closes part of the parity ratchet for
Phase 2.A.1.

### Why only 3 of 6 rules

During implementation I found a divergence the design doc missed:
the client has a **TIER2_BONUS** branch (`isTier2 → +5, '🥈T2'`) that
the server does NOT. Migrating `TIER1_BONUS`/`NEW_BONUS` blindly
would lose the tier-2 logic. The 3 rules in this PR
(`SILENT_ACCUMULATION`, `EARLY_ENTRY`, `STEALTH`) have **no
divergence** — they were already identical bit-for-bit. Migrating
them is provably safe.

`FALLING_KNIFE` also not migrated to client here — it's a new
server-side suppression, and adding it to the client without the
matching tag-stats data to validate would be a meaningful UX
change. Deferred to a follow-up PR after Ziko verifies the server
rule works for a few days.

### Architectural divergence to resolve (PR C decision)

Three options for the tier-2 question:

| Option | Implication |
|---|---|
| Drop `isTier2` from client (loses tier-2 medium tier) | Smallest diff, but loses signal granularity |
| Add `isTier2` to server + `TIER2_BONUS` rule in registry | Best convergence; needs `tier2Coins` data on server |
| Add `TIER2_BONUS` rule with `condition: (ctx) => ctx.isTier2 === true` and let server pass `false` always | Cheapest; effectively no-op on server but client keeps behaviour |

Recommend the third for the next PR — minimum diff, future-proof.

### Files changed

- `index.html` — `<script defer src="src/scoring-rules.js">` added,
  loaded BEFORE `app.js` so `window.SCORING_RULES` is ready.
- `app.js` `quickScan` — the 3 inline rules replaced by:
  ```js
  ['SILENT_ACCUMULATION','EARLY_ENTRY','STEALTH'].forEach(function(_id){
    var _r = window.SCORING_RULES.RULES.find(function(x){return x.id===_id});
    if (_r && _r.condition(_ruleCtx)) { sc += _r.weight; if (_r.tag) tags.push(_r.tag); }
  });
  ```
  Plus a defensive fallback to the inline logic if
  `window.SCORING_RULES` failed to load (CDN issue, ad-blocker,
  whatever). The fallback is bit-for-bit identical to what was
  there before this PR — so even total registry failure means no
  regression.

### Verification

- `npm run check` → lint clean, format clean, 700 / 700 tests pass.
- **Manual browser verification required before merge** — `app.js`
  has no CI integration test. Ziko opens `shamcyrpto.com` with
  this branch deployed, confirms scanner still produces signals
  with `🐋ACC` / `🔍EARLY` / `🔍STEALTH` tags as before.

### Manual test plan (Ziko)

```bash
# On VPS after merge + pull:
sudo -u nexus pm2 restart nexus-proxy --update-env

# Open https://shamcyrpto.com in browser, then in DevTools console:
window.SCORING_RULES   # should be the registry object
window.SCORING_RULES.RULES.length   # should be 6

# Scanner tab should still show signals with 🐋ACC / 🔍EARLY / 🔍STEALTH tags
# Score values should be identical to before (within ~1 second of
# the same /api/all snapshot).
```

### Rollback

Revert this PR. `window.SCORING_RULES` global stays loaded (harmless),
`quickScan` reverts to fully-inline. No data migration.

### Test results

- `npm run check` → 700 / 700 pass.

### References

- `SCANNER_AUDIT_2026_05_15.md` §6 P2.A.1
- `docs/SCANNER_UNIFIED_RULES_REGISTRY_DESIGN.md` §4 (parity ratchet)

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
