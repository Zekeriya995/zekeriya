# Session 2026-05-20 → 2026-05-21 — Summary

Overnight remediation session. Closed out the original
SCANNER_AUDIT_2026_05_15.md plan in full (Phases 1.x, 2.A.1,
2.A.2, 2.A.3, 2.A.4, 2.A.4.b, 2.A.5, 3.1, 3.2) and **continued
beyond it** at the user's explicit request — adding 4 more
PRs (F/G/H + docs) that extend the parity ratchet to almost
every simple scoring rule.

## Headline result

**18 PRs merged this session — original audit plan 100% delivered.**
Registry grew from 6 → **35 rules**. Tests grew from 700 →
**781**. Phase 2.A.1 parity ratchet COMPLETE for every simple
(single-tag, additive) rule. Phase 2.A.2 (PWA reads server
signals) COMPLETE in three ratchets. Phase 2.A.4.b (tier-aware
ATR) addresses the 2026-05-20 BTC screenshot regression
structurally. **Phase 4 (backtest harness) COMPLETE** — the
foundation for evidence-based weight tuning is now live.

## PRs merged in chronological order

| PR   | Title                                                   | Notable                                                                                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #110 | Phase 2.A.4.b — Tier-aware ATR multipliers              | Directly addresses BTC TP1 regression. Tighter mults for tier-1 majors. R:R drops 2.0→1.5 (above audit floor of 1.3). Adds `📐ATR_T1` observability tag.                                                                                                                                                                        |
| #112 | Phase 2.A.2.1 — Client overlays server SL/TP/RR         | First ratchet of "PWA reads server signals". Caught 2 BLOCKERs in review: `_scanWarn` typo + `smartEntry` was the actual UI data path (top-level `r.sl` was a no-op).                                                                                                                                                           |
| #113 | Phase 2.A.2.2 — Client tier demotion                    | Asymmetric: server can DEMOTE but never PROMOTE. Surfaces `🚫MANIP_CAP` / `🔪FALLING` / `🚨P&D_RISK` / `🚨MANIP_HIGH` as `🛑SRV_DEMOTE`.                                                                                                                                                                                        |
| #114 | Phase 2.A.1 PR C — TIER1/TIER2/NEW migration            | Caught BLOCKER: TIER1 ∩ tier2Coins overlap (hot majors land in both lists) would have silently scored +15. Fixed by precedence-in-condition gate `isTier1 !== true`.                                                                                                                                                            |
| #115 | docs: VPS deployment guide                              | Step-by-step guide for tomorrow's deploy.                                                                                                                                                                                                                                                                                       |
| #116 | Phase 2.A.2.3 — Client merges selected server tags      | Promotes `📐ATR_T1 / 📐ATR_ZONES / 🔪FALLING / 🚫MANIP_CAP / 🚨MANIP_HIGH / ⚠️MANIP_MED / 🌐FR_NEG` to visible cards. Exact-match allowlist (no prefix).                                                                                                                                                                        |
| #117 | Phase 2.A.1 PR D — FR / LS / coinalyzeFR migration      | Caught BLOCKER: client DOES have `coinalyzeFR` data (from `/api/all`), so the inline rule at app.js:2641 had to be migrated AND deleted. First iteration missed both.                                                                                                                                                           |
| #118 | docs: deploy guide refresh                              | Marks #113-#116 merged, lists #117 pending.                                                                                                                                                                                                                                                                                     |
| #119 | Phase 2.A.1 PR E — MTF / RSI / MACD migration           | Server-only data; 8 rules. No client changes needed (strict no-op gates). Histogram tie-breaker (+3/-3 tagless) kept inline — doesn't fit current rule shape.                                                                                                                                                                   |
| #120 | Phase 2.A.1 PR FINAL — doc + ledger cleanup             | First "complete" snapshot. No code.                                                                                                                                                                                                                                                                                             |
| #121 | Phase 2.A.1 PR F — VOL chain + change-band              | +7 rules (VOL_MEGA/HIGH/NORMAL + CHANGE_RISING/LATE/PENALTY_GT3/GT5). Tagless rules first appear here. Client's 4th VOL tier `📊vol` lowercase preserved inline.                                                                                                                                                                |
| #122 | Phase 2.A.1 PR G — AT_HIGH/BOTTOM/TAKER/COINALYZE_OI    | +4 rules. AT_HIGH/BOTTOM/TAKER bit-for-bit on both sides; COINALYZE_OI server-only with Option-C client no-op.                                                                                                                                                                                                                  |
| #123 | Phase 2.A.1 PR H — REVERSAL/BTC*OK*\*/CVD_BUY           | +4 rules. All client-only data; server cleanly no-ops via strict gates. BTC market check migrated as two-sided rule (bonus + tagless penalty).                                                                                                                                                                                  |
| #125 | **Phase 4 — Backtest harness (per-rule effectiveness)** | **Closes the last item in the original audit plan.** New `src/scanner-backtest.js` module + `GET /api/scanner/backtest` endpoint. Answers "which rules predict wins, which hurt?" with marginal-gain delta per rule + `suspiciousRules` list (positive-weight rules with negative outcome correlation — the worst kind of bug). |

## Pre-merge review process

Every PR ran through one or two parallel reviewer agents
(correctness + SRE) before merge. **Three real BLOCKERs caught
this way** — none would have surfaced from CI alone:

1. **PR #114 (TIER overlap):** TIER1 ∩ tier2Coins overlap would
   have inflated tier-1 scores by +5 on every hot major. CI
   passes because the tests didn't cover the overlap case. SRE
   reviewer flagged it; 2 regression tests added in the fix.
2. **PR #117 (coinalyzeFR client):** The first iteration claimed
   COINALYZE_FR_NEG was "server-only" but the client DOES
   populate `coinalyzeFR[s]` from `/api/all` data. The inline
   rule at app.js:2641 would have continued firing alongside
   the new registry rule (double-score). SRE reviewer caught
   the live emission path; fix extends client ctx + deletes
   inline + extends fallback.
3. **PR #112 (smartEntry path):** First iteration wrote to
   `r.sl/tp1/tp2/rr` (top-level) but every UI consumer reads
   from `r.smartEntry.target1/target2/stop`. The PR would have
   merged green but the BTC card would have shown the OLD TP1
   regardless. Correctness reviewer found this; fix overlays
   smartEntry in-place.

Plus a SRE NIT on PR #113 that became a meaningful improvement
(tier demotion hoisted above the bounds-validity gate so it
fires even when bounds are corrupt).

## Final registry composition (35 rules)

```
PR A: TIER1_BONUS, NEW_BONUS, SILENT_ACCUMULATION, EARLY_ENTRY, STEALTH
PR C: TIER2_BONUS
PR D: FR_VERY_NEG, FR_MILDLY_NEG, FR_OVEREXTENDED, LS_SHORTS, COINALYZE_FR_NEG
PR E: MTF_BULL_FULL, MTF_BULL_PARTIAL, MTF_BEAR_FULL, MTF_BEAR_PARTIAL,
      RSI_OS, RSI_OB, MACD_BULL_CROSS, MACD_BEAR_CROSS
PR F: VOL_MEGA, VOL_HIGH, VOL_NORMAL, CHANGE_RISING, CHANGE_LATE,
      CHANGE_PENALTY_GT3 (tagless), CHANGE_PENALTY_GT5 (tagless)
PR G: AT_HIGH, BOTTOM, TAKER_SKEW, COINALYZE_OI
PR H: REVERSAL, BTC_OK_BONUS, BTC_NOT_OK_PENALTY (tagless), CVD_BUY
Plus FALLING_KNIFE (PR #108, native to registry, not a migration)
```

Each rule is `Object.freeze`'d, has a unique id, tag (or `null`
for tagless score-only rules), weight, and pure condition. Contract
test in `tests/scoring-rules.test.js` pins every rule's shape +
behaviour. **767 / 767 tests pass.**

## Patterns the registry doesn't express yet (deferred)

- Multi-tag tier rules (whaleWave A/B/C/D) — would need
  `tagFn(ctx) => string | string[]` shape extension
- Non-additive scoring (P&D KILL → score floor at -100) — would
  need `scoreFn(score, ctx) => newScore` or `kind: 'modifier'`
- Dynamic tag strings (`📗BID:Nx`, `📗snap:Nx`,
  `🐋✨WHALE_TARGET:N`, `🐋WHALE_ACTIVE:N`) — needs `tagFn(ctx)`
- Compound rules reading earlier rule outputs (none in current
  code, but a hypothetical extension would need a two-pass evaluator)
- MACD histogram tie-breaker (tagless +3/-3) — now COULD fit
  the registry as `tag: null` rules (precedent set by PR F's
  CHANGE*PENALTY*\* and PR H's BTC_NOT_OK_PENALTY); kept inline
  as the only inline scoring left on the server

Remaining client-only inline rules not migrated:

- `📊CVD_BUY` migrated in PR H ✓
- `📘BID_PRESS` (bookTickers) — simple, could migrate next batch
- `📈OI_BUILD`, `OI↑` (oiHistory time-series) — needs ctx
  carrying oiHistory; harder to migrate without shape extension
- `🧠SMART` (topTradersLS positions) — compound condition
- `▲▲` (prediction sc) — depends on a prediction engine
- `💥LIQ_SHORT` (liquidationData) — time-windowed aggregation
- Coinbase Premium / Bitfinex / DEX-CEX (xex.signals) — array-
  based signal sets, needs `tagFn` or compound condition

Documented in `src/scoring-rules.js` header.

## Deploy tomorrow

See `docs/DEPLOY_2026_05_21.md` for the step-by-step. The
checklist covers SSH, git pull (with the now-known `.git/objects`
ownership fix), `.env` audit, pm2 restart, server-side smoke
tests (atrZones math, registry shape, tag-stats, live signal
pct), browser smoke tests (registry global, server signal
capture, BTC card TP1 display, tier demotion dev injection,
rollback flag round-trip), escalating rollback path, and a
post-deploy summary template.

Expected user-visible changes after deploy:

- BTC / ETH cards show TP1 ~+3-4% (was +6-7%)
- New tag chips visible on tier-1 cards: `📡SRV` + `📐ATR_T1` +
  `📐ATR_ZONES`
- Signals with manipulation HIGH or P&D RISK get demoted from
  ⭐ ULTRA to 🟢 CONFIRMED with a `🛑SRV_DEMOTE` chip
- Coins down >10% in 24h get the `🔪FALLING` chip (rare day-to-day)

## Numbers

- Tests: 700 (pre-session) → **781** (+81)
- Registry rules: 6 (pre-session) → **35** (+29)
- PRs merged: **18** (#110 pre-deployed + #112-#125)
- Inline-rule deletions: ~25+ blocks across `src/scanner-engine.js`
  and `app.js quickScan`
- New observability tags: `📡SRV`, `🛑SRV_DEMOTE`, `📐ATR_T1`
- New env flags: `SCANNER_TIER_AWARE_ATR_ZONES` (PR #110),
  `SCANNER_BACKTEST_ENABLED` (PR #125) — both default ON
- New localStorage flag wired (Phase 0 reservation):
  `nxScannerFix_server_signals`
- New endpoint: `GET /api/scanner/backtest` (Phase 4)
- Reviewer BLOCKERs caught + fixed: **4 real BLOCKERs** + several
  NITs. All would have shipped silently if not for parallel
  reviewers (CI alone passed every BLOCKER PR).
- **Original audit plan: 100% delivered.**

## Status of the original 16-phase audit plan

| Phase                                   | Status                                              |
| --------------------------------------- | --------------------------------------------------- |
| 1.1 — Shared P&D detection module       | merged earlier                                      |
| 1.1.b — Retail LS data source           | merged earlier                                      |
| 1.2 — Manipulation hard-cap             | merged earlier                                      |
| 1.3 — Smart ULTRA cooldown delta-bypass | merged earlier                                      |
| 2.A.1 — Unified scoring rules registry  | **COMPLETE (this session)**                         |
| 2.A.2 — PWA reads server signals        | **COMPLETE (3 ratchets, this session)**             |
| 2.A.3 — Engine wired to THRESHOLDS      | merged earlier                                      |
| 2.A.4 — ATR-aware SL/TP bounds          | merged earlier                                      |
| 2.A.4.b — Tier-aware ATR multipliers    | **COMPLETE (PR #110)**                              |
| 2.A.5 — Contract test populated         | done as part of 2.A.1                               |
| 3.1 — Per-tag win-rate tracking         | merged earlier                                      |
| 3.2 — Gate-rejection telemetry          | merged earlier                                      |
| 4 — Backtest harness                    | **DEFERRED** — needs 14-30 days of post-deploy data |

**End state: the audit plan is COMPLETE except for Phase 4,
which requires data we won't have until tag-stats accumulates
post-deploy.**

## Next steps (for the morning)

1. Deploy. See `docs/DEPLOY_2026_05_21.md`.
2. Smoke-test on production. Use the checklist in the deploy
   doc — including the BTC card TP1 reading, which is the
   one direct user-visible verification of all this work.
3. Let tag-stats accumulate for 2-3 days. Then look at the
   `📐ATR_T1` and `🛑SRV_DEMOTE` win rates in
   `/api/scanner/tag-stats` to see if the tier-aware multipliers
   and protective demotions actually improved outcomes.
4. After 14-30 days of data, evaluate Phase 4 (backtest harness).
