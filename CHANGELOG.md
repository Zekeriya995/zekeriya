# NEXUS PRO V10 — التسليم النهائي الشامل

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
