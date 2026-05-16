# NEXUS PRO — Scanner Unified Audit & Remediation Plan

**Date:** 2026-05-15
**Scope:** Scanner subsystem (`quickScan` + `scoreSymbol` + `qualityFilter` +
`signalQualityGate` + scanner-history/sectors/indicators)
**Methodology:** Two independent reviews consolidated by the engineering manager:
- **Review A** — External 10-engineer panel audit (delivered 2026-05-14 as 8
  separate documents totalling ~4,400 lines)
- **Review B** — Internal verification pass that independently walked every
  `cache.*` field from server fetcher to client consumer

**Status:** Ready for Ziko's approval. Phase ordering below supersedes the
external plan's ordering on two points (compressed Phase 0; new Phase 0.5
architectural decision).

---

## 0. Executive Summary

The Scanner is functional but suffers from **three structural defects**, only
two of which were caught by the external review. Together they degrade trust
faster than any individual scoring bug:

1. **🔴 Client/Server Scoring Drift** — 15+ scoring tags exist on one side only.
   Same coin → different scores depending on which scanner saw it. Push says
   ULTRA, in-app says STRONG. (External review §3.1.)
2. **🔴 Pump-and-Dump detection is client-only** — The 5-flag P&D detector that
   zeroes the score lives in `app.js:2444-2461` only. The server happily fires
   ULTRA pushes on the exact dump fingerprint the client filter rejects.
   (External review §3.2.)
3. **🔴 Wasted Pipeline (newly identified)** — The server publishes
   `signals`, `top3`, `sectorHeatmap`, `scannerStats` via `/api/all`, but
   `app.js` reads **none** of them. The visible UI runs an entirely separate
   client-side scanner. The server scanner exists only to drive push
   notifications. **This is a precondition to any "unification" work.**

Five additional findings (manipulation soft cap, fixed SL/TP, regime-blind
win-rate, `qualityFilter` slice(0,7), no backtest) are real and addressed below,
but defect #3 above changes the framing of how to fix the others. **Decision
required from Ziko in Phase 0.5 before Phase 2 work begins.**

The data feeding the scanner is **real** — every cache field traces to a live
HTTPS endpoint (Binance/Bybit/Hyperliquid/Bitfinex/Coinalyze). The 221 tests
pass. The scoring math is mostly defensible. The defects are about
**coherence and coverage**, not about fake data or fabricated results.

---

## 1. Why Two Reviews

Single-reviewer audits miss things. This consolidation captures both
perspectives because they found different categories of defects:

| Review | Strongest Finding | Methodology |
|--------|-------------------|-------------|
| A (external) | **Client/Server Drift Matrix** — 15+ tags asymmetric | Read every scoring rule on both sides, built a tag-level diff table |
| B (internal) | **Wasted Pipeline** — server output is unconsumed | Traced every `cache.*` field from server `/api/all` to the client `loadTk()` consumer with `grep`; counted what's read vs published |

Review A treats client and server as **two scanners that should agree**. Review
B asks a deeper question: **does the front-end consume the server's verdict at
all?** The answer (no, except for push notifications) reframes the unification
plan. This document keeps both findings.

---

## 2. Consolidated Top 8 Findings

### 🔴 P0 — Bleeding Right Now

#### 2.1 Pump-and-Dump detection is client-only

- **Where:** Server `scoreSymbol` in `src/scanner-engine.js:216-543` has no
  cumulative 3-flag rule; client `quickScan` in `app.js:2444-2461` has a 5-flag
  detector that floors score to -100.
- **User impact:** ULTRA pushes fire on coins matching dump fingerprint
  (`change=6%`, `FR=0.12`, `LS.ratio=4.2`, retail-long-heavy). User opens app to
  see chart already peaked.
- **Fix:** Extract the detector to a pure helper `detectPumpAndDump(d, ctx)` in
  `src/scanner-helpers.js`, call from both sides. See §6 Phase 1.
- **Pre-fix verification required:** Validate the 5 thresholds against
  `scanner-history.json` outcomes before porting (Review B critique — Review A
  proposes a pure port without re-validation).

#### 2.2 Client/Server Scoring Drift

- **Where:** Two separate scoring loops drifted after the `scanner-helpers.js`
  extraction. 15+ tags on client-only (`VPIN_HIGH`, `ICE_BUY`, `CVD_BUY`,
  `LIQ_SHORT`, `CB_PREM`, `BY_PREM`, `predArrow`, `BTC✅`, …) and 8+ on
  server-only (`MTF_BULL`, `MANIP_HIGH`, `RSI_OS`, `MACD_BULL`, `BFX_LONG`,
  `HL_NEG`, `BULL_NEWS`, …).
- **User impact:** Push payload shows score=105 ULTRA, in-app card shows
  score=78 STRONG for the same symbol within minutes.
- **Tier thresholds also drift:** ULTRA is implicit ≥85 on client, ≥100 on
  server.
- **Fix:** Single source-of-truth scoring registry. See §6 Phase 2, gated on
  Phase 0.5 decision.

#### 2.3 Wasted Pipeline — server output is unconsumed by UI

- **Where:** `server.js:1591-1619` publishes `signals`, `top3`, `sectorHeatmap`,
  `scannerStats`, `indicators`, `indicatorsMtf`, `whaleWaves`. `grep` on
  `app.js` for `all.signals|all.top3|all.scannerStats|all.sectorHeatmap`
  returns **zero matches**.
- **Confirmed reads:** `all.tickers`, `all.fr`, `all.oi`, `all.ls`, `all.taker`,
  `all.depth`, `all.liq`, `all.market`, `all.whales`, `all.multi`.
- **Implications:**
  - The PWA recomputes the entire scanner locally on every device.
  - `cache.scannerStats.winRate` is exposed but the visible win-rate badge is
    computed from `monitorState.coinStats` (client-only history).
  - `cache.sectorHeatmap` is exposed but `renderHeatmap` in `app.js:3788` walks
    `T` directly with its own coloring rule.
  - The server scanner exists **only** to drive ULTRA push + Top-3-change push
    + the 24-hour history record.
- **Decision required (Phase 0.5):** Either
  - **(A) Unify** — make the PWA consume `all.signals`; the server becomes
    single source of truth. Drops client compute cost. **Requires merging
    drift first** (defect 2.2).
  - **(B) Bifurcate by design** — accept two scanners with documented overlap.
    Tighten the contract test (Phase 2) to enforce parity only on the rules
    that intentionally fire on both sides. Drop the unused server fields from
    `/api/all` to save bandwidth.
- **Recommendation:** **Option A.** The current shape is "Option B by neglect" —
  it has all the cost of Option A (two implementations) with none of the
  benefits (single source of truth). Choose deliberately.

### 🟠 P1 — Compounding Drift

#### 2.4 Manipulation HIGH is a soft penalty, not a tier cap

- **Where:** `src/scanner-engine.js:503-510` — `HIGH` deducts 15 points. A
  coin with pre-manip score 115 finishes at 100 = still ULTRA. 🚨 and ⭐
  co-occur in the same payload. Incoherent.
- **Fix:** Hard-cap at STRONG (score = 99 max) when `manip.verdict === 'HIGH'`.
  See §6 Phase 1.

#### 2.5 Fixed SL/TP ignore ATR

- **Where:** `src/scanner-engine.js:518-525` — SL/TP1/TP2 are
  `price × {0.97, 1.05, 1.10}` regardless of volatility. The volatility-aware
  `atrZones()` exists in `src/scanner-helpers.js:78` but is unused by the
  server. R:R reports a constant 1.67.
- **User impact:** Push payload SL/TP doesn't match in-app card SL/TP (which
  uses `atrZones` in `deepAnalyze`).
- **Fix:** Call `atrZones` when `ctx.indicator.atr` is available; fall back to
  fixed-percent only when ATR cache is cold. See §6 Phase 2.

#### 2.6 Late-entry double-penalty kills legitimate breakouts

- **Where:** `src/scanner-engine.js:271-275` —
  - `change ≥ 5 && < 8`: `-5` (LATE tag)
  - `change > 3`: `-15`
  - `change > 5`: `-30`
- At `change = 6`: cumulative penalty is **-50** before any other rule fires.
  Any breakout between +5% and +8% with healthy volume is buried.
- **Fix:** Single monotone curve (e.g. `-3 × max(0, change-3)`) replacing the
  three stacked branches. See §6 Phase 2 (folded into rules registry).

#### 2.7 `qualityFilter` silently drops 43 of 50 signals

- **Where:** `app.js:2759` — hardcoded `.slice(0, 7)`. `deepAnalyze` returns
  50+ scored signals; only 7 reach the UI. No pagination, no "show more", no
  setup filter exposing the rejected 43.
- **User impact:** The platform appears to produce 7 ideas per day when it
  produces 50+. Trust signal is the wrong direction.
- **Fix:** Make the slice configurable (`localStorage.nxScannerLimit`, default
  20); add "show more" expansion. See §6 Phase 3.

#### 2.8 Win-rate threshold is regime-blind

- **Where:** `src/scanner-history.js:131` — `pctChange >= +5%` defines "win".
  In a bull regime every coin clears that bar; in a bear regime none do.
  Reported `winRate` measures market direction, not signal quality.
- **Fix:** Two parallel measurements — absolute (current rule, kept for
  backwards compat) and **alpha** (signal return minus median 24h return of
  the same-sector basket). See §6 Phase 3.

### 🟢 P1 — Foundations missing

#### 2.9 No backtest infrastructure (consequential, not user-visible)

- 521 trade outcomes exist in `monitorState.factorStats` but no replay harness.
  Every threshold change is shipped to production blind.
- **Fix:** Cache snapshot recorder + replay CLI. See §6 Phase 4.

---

## 3. The Architectural Decision (Phase 0.5)

**This must be answered before Phase 2 begins.** It is the single highest-
leverage decision in the remediation.

### The Question

Should the PWA consume the server's scanner output (`all.signals`,
`all.top3`, `all.scannerStats`, `all.sectorHeatmap`), or remain a separate
scanner with documented parallel scoring?

### Decision Matrix

| Aspect | Option A — Unify | Option B — Deliberate Bifurcation |
|--------|------------------|-----------------------------------|
| Single source of truth | ✅ Server | ❌ Two sources |
| Client CPU cost | ↓ Significant (no local scoring) | Unchanged |
| Push ↔ in-app parity | ✅ Identical by construction | Best effort via contract test |
| Offline / PWA-cached browsing | ❌ Degrades to last-cached payload | ✅ Client keeps scoring on cached `T` |
| Per-user customization (`scannerTimeframe`, `setup`, `tier`) | Requires server-side fanout per user **or** client-side post-filter on full result set | ✅ Already works (client decides) |
| Server cost | ↑ Must serve more queries / push more data | Unchanged |
| Engineering effort to migrate | 5-7 days (Phase 2 work) | 2 days (contract test + drop unused fields) |
| Risk | Medium (one regression breaks everyone) | Low (each side is isolated) |

### Recommendation

**Option A**, conditional on three pre-conditions:

1. Phase 1 P&D port lands first (so server scoring is at least as defensive as
   client).
2. The PWA keeps a degraded local scanner that fires only when `/api/all` is
   stale > 60s — preserves offline behaviour.
3. Per-user UI filters (`scannerTimeframe`, `setup`, `tier`) operate on the
   client by post-filtering the server's full signal list — no per-user
   server fanout.

If any of the three pre-conditions cannot be met, fall back to **Option B**:
- Add `all.signals` to the documented-but-intentionally-unused list in
  `server.js:1591`'s comment.
- Tighten the Phase 2 contract test to assert tag-bag equality for the rules
  marked `availableOn: ['client', 'server']` only — accept client-only and
  server-only rules as design (not drift).

**Both options are valid engineering.** The current state — "drifted by accident
with no test enforcing anything" — is not.

---

## 4. The Drift Matrix (External Review §4, abbreviated)

The full tag-by-tag diff lives in `SCANNER_DISCOVERY_REPORT.md` §4 (Review A's
artifact). Highlights:

**Client-only scoring inputs not read by server:**
`bookTickers`, `topTradersLS`, `liquidationData`, `aggCVD`, `predArrow`,
`oiHistory` (server reads current OI only)

**Server-only scoring inputs not read by client:**
`bitfinexMargin` (read but unused), `hyperliquidData` (read but unused),
`newsSentiment` (read but unused), `cache.indicators` (client recomputes from
klines), `cache.indicatorsMtf` (client recomputes via `tfAlignment`)

**Tier threshold drift:** ULTRA = 85 on client (implicit), 100 on server.

**SL/TP drift:** Client `atrZones`, server fixed-percent (see 2.5).

---

## 5. The Wasted Pipeline (Internal Review)

### Server publishes (via `/api/all`)

```text
all.signals          — top 50 scored signals (server scoreSymbol output)
all.top3             — top 3 (push trigger source)
all.scannerStats     — winRate, avgGain, byTier
all.sectorHeatmap    — 10-sector aggregation
all.indicators       — RSI/MACD/EMA per symbol
all.indicatorsMtf    — multi-TF agreement per symbol
all.whaleWaves       — server-aggregated whale waves
```

### Client reads (verified by `grep "all\\." app.js`)

```text
all.tickers, all.fr, all.oi, all.ls, all.taker, all.depth,
all.liq, all.market, all.whales, all.multi
```

### Gap

| Server publishes | Client reads | Cost |
|------------------|--------------|------|
| signals, top3 | ❌ | 50 signal objects × ~500 bytes = ~25 KB / request, ignored |
| scannerStats | ❌ | win-rate computed twice (server every 5 min, client per page load) |
| sectorHeatmap | ❌ | sector classification done twice |
| indicators, indicatorsMtf | ❌ | RSI/MACD/EMA computed twice |
| whaleWaves | ❌ | Client reads `whaleWaves` from `all.whales` instead (different shape) |

**Estimated waste:** ~30 KB per `/api/all` response × ~17,280 polls/day per
active user × N users = measurable bandwidth cost serving fields nobody reads.
On the server CPU side, `runScannerPass` runs every 30s producing output that
only feeds push triggers; on the client CPU side, `quickScan` runs the same
work locally on every device.

### Recommended action

Tied to §3 Phase 0.5 decision. If **Option A** wins: client begins consuming
`all.signals`. If **Option B** wins: drop unused fields from `/api/all` payload.

---

## 6. Compressed 5-Phase Roadmap

This roadmap supersedes the external `SCANNER_REMEDIATION_PLAN.md` in two
places, marked **[REVISED]**.

### Phase 0 — Safety Net **[REVISED: compressed from 1 day to ~4 hours]**

External plan dedicates a full day to: snapshot script + empty contract test +
`.env.example` flags + CHANGELOG entry. Review B's view: this is documentation
only; can ship in one PR.

| ID | Task | Effort |
|----|------|--------|
| P0.1 | Single PR adding: snapshot shell script + 8 flag names in `.env.example` + `nxScannerFix_*` header comment in `app.js` + CHANGELOG entry + empty contract test skeleton + `npm run snapshot` + `npm run test:contract` | 3-4 hours |

DoD identical to external plan. No behaviour change.

### Phase 0.5 — Architectural Decision **[NEW]**

Ziko picks Option A or Option B from §3 in writing (decision recorded in
`CHANGELOG.md` and in the PR description of the Phase 2.1 work). **Phase 1
can ship in parallel** — it is option-agnostic. **Phase 2 cannot start until
this decision is on file.**

### Phase 1 — Stop the Bleeding (4 days)

| ID | Task | Pre-condition added by internal review | Effort |
|----|------|----------------------------------------|--------|
| P1.0 | **NEW: Validate P&D thresholds** — run the 5 flags against the existing `data/scanner-history.json` outcomes. Report `flag_count → win_rate` curve. Adjust thresholds if any flag has < 20% win rate suppression vs unflagged baseline. | Internal review | 0.5 d |
| P1.1 | Port P&D detector to `src/scanner-helpers.js`. Call from both `quickScan` and `scoreSymbol`. Server side: `kill=true → return null`; `warn=true → score -= 25`. Behind `SCANNER_SERVER_PD_ENABLED` env flag and `nxScannerFix_pd_v2` localStorage flag. | (External) | 1.5 d |
| P1.2 | Manipulation HIGH hard cap at STRONG (score ≤ 99 + `🔒CAP_MANIP` tag). | (External) | 0.5 d |
| P1.3 | Smart ULTRA cooldown: bypass when `Δscore ≥ 30` within 5-min window. | (External) | 1 d |
| P1.V | Verify with snapshot diff. Bad-ULTRA-push rate target ↓ ≥ 80%. | (External) | 0.5 d |

### Phase 2 — Eliminate Drift (option-dependent)

**If Phase 0.5 picks Option A (Unify):**

| ID | Task | Effort |
|----|------|--------|
| P2.A.1 | Extract scoring rules to `src/scoring-rules.js`. Single registry consumed by `runScannerPass` (server) and by a new thin `quickScan` orchestrator (client). Rules tagged `availableOn`. | 3 d |
| P2.A.2 | PWA `loadTk()` consumes `all.signals` as primary; falls back to local `quickScan` only when `all.scannerTs` is > 60s stale. | 1.5 d |
| P2.A.3 | Unify tier thresholds (`TIER_THRESHOLDS = { ULTRA: 100, STRONG: 70, MEDIUM: 50 }`) — single import. | 0.5 d |
| P2.A.4 | Server SL/TP uses `atrZones` when ATR present, fixed fallback otherwise. | 1 d |
| P2.A.5 | Contract test asserts tag-bag equality on `availableOn: ['client', 'server']` rules. | 1 d |

**If Phase 0.5 picks Option B (Bifurcate):**

| ID | Task | Effort |
|----|------|--------|
| P2.B.1 | Tighten `scoreSymbol` and `quickScan` to call shared helpers (`detectPumpAndDump`, `atrZones`, OBI calc) instead of inline duplicates. | 2 d |
| P2.B.2 | Drop unused fields from `/api/all` payload (`signals`, `top3`, `sectorHeatmap`, `scannerStats`, `indicatorsMtf`) **unless** push trigger or future internal tool reads them. Document the deliberate bifurcation in `server.js` header comment. | 0.5 d |
| P2.B.3 | Contract test asserts that on **shared** rules (the explicit allow-list), client and server tag-bags match. Tags marked `client-only` or `server-only` are documented exemptions. | 1.5 d |
| P2.B.4 | Server SL/TP uses `atrZones` when ATR present. | 1 d |

### Phase 3 — Observability (4 days)

Identical to external plan with one addition:

| ID | Task | Effort |
|----|------|--------|
| P3.1 | Per-tag win-rate tracking + `/api/scanner/tag-stats` endpoint. | 2 d |
| P3.2 | Gate-rejection telemetry from client + `/api/scanner/insights`. | 1 d |
| P3.3 | **NEW: Alpha-based win rate** — alongside the existing static-threshold winRate, compute `signal_return - median_basket_return` over the same 24h window. Surface both numbers. | 1 d |

### Phase 4 — Backtest (10 days)

Identical to external plan. Cache snapshot recorder + replay CLI + threshold
sweep + docs.

### Post-Phase Pagination Fix (½ day, can ship any time)

`qualityFilter` slice(0,7) → configurable via `localStorage.nxScannerLimit`
(default 20) + "show more" expansion. Not in any phase; ship opportunistically
in Phase 1 or 3 sprint slack.

---

## 7. KPI Targets

Inherited from external plan with two additions (marked **[NEW]**):

| KPI | Baseline | Post-Phase-1 | Post-Phase-2 | Post-Phase-4 |
|-----|----------|--------------|--------------|--------------|
| Bad-ULTRA-push count | ~5-8/day | ↓ ≥80% | ↓ ≥90% | ↓ ≥95% |
| Client/Server tag parity (on shared rules) | ~60% | ~75% | ≥95% | ≥98% |
| Push vs in-app SL/TP drift | up to ±100% | unchanged | ≤5% | ≤5% |
| Tags tracked individually | 0 | 0 | 0 | 80+ |
| **[NEW] Server output consumed by client** | ~0% (10/17 fields read) | unchanged | 100% (Option A) or 100% of intentional (Option B) | unchanged |
| **[NEW] Alpha-based win rate exposed** | ❌ | ❌ | ❌ | ✅ |
| Tests | 221 (verified) | +24 | +48 | +90 |
| Magic numbers outside scoring-rules.js | ~70 | ~70 | 0 (Option A) or documented (Option B) | 0 |

---

## 8. Pre-Approval Action Items for Ziko

Before any code lands on `main`:

1. **Approve or revise the architectural decision** in §3. Engineering's
   recommendation is Option A; respond with `Approved A`, `Approved B`, or
   `Discuss before deciding`.
2. **Approve compressed Phase 0** in §6. External plan estimates 1 day;
   internal review estimates 3-4 hours.
3. **Approve the P&D threshold validation step (P1.0)** added before the
   external plan's Phase 1.1. External plan ports the detector as-is; internal
   review wants the existing thresholds validated against history first.
4. **Confirm rollback discipline**: every PR carries an env-var or localStorage
   flag.

### 8.1 Decisions Recorded — 2026-05-15

Ziko answered the four questions sequentially in chat. Recorded here as the
canonical reference for downstream PRs.

| # | Question | Decision |
|---|----------|----------|
| A | Architecture (§3) | **Option A — Unify.** Server becomes single source of truth; PWA consumes `all.signals` from `/api/all`; client keeps a degraded local `quickScan` that fires only when `all.scannerTs` is > 60s stale. Drives Phase 2 path A (P2.A.1 through P2.A.5). |
| B | Phase 0 length (§6) | **Compressed — single PR, ~4 hours.** All Phase 0 sub-tasks land in one commit chain on `claude/audit-scanner-module-a7dWq`. |
| C | P&D validation (§6 P1.0) | **Yes — P1.0 ships before P1.1.** Validate the 5 client-side flag thresholds against `data/scanner-history.json` outcomes; trim or re-weight any flag with weak suppression evidence before porting to the server. |
| D | Rollback discipline (§8.4) | **Yes — every behaviour-changing PR carries a flag.** Server fixes behind `SCANNER_*_ENABLED` env vars (read at boot); client fixes behind `nxScannerFix_*` localStorage keys (read at module init). Documentation-only and pure-refactor PRs are exempt. |

The decisions above are now the contract. Any future deviation requires a
written amendment in this section, dated, with rationale.

---

## 9. What Was Verified vs Asserted

To stay honest about evidence quality:

| Claim | How verified |
|-------|--------------|
| Real upstream data (Binance/Bybit/Hyperliquid/Bitfinex/Coinalyze) | `grep` for `Math.random|MOCK|FAKE|TEST_MODE` in `server.js` + `scanner-engine.js` — zero hits in the data path |
| 221 tests pass | `node --test tests/scanner-*.test.js` run during this audit — `pass: 221, fail: 0` |
| `app.js` does not read `all.signals` / `all.top3` / `all.scannerStats` / `all.sectorHeatmap` | `grep -nE "all\.signals\|all\.top3\|all\.scannerStats\|all\.sectorHeatmap" app.js` returned 0 lines. Listed reads: `grep "all\." app.js \| grep -oE "all\.[a-zA-Z_]+" \| sort -u` |
| Drift matrix (15+ client-only tags, 8+ server-only) | Cross-checked external review's matrix line-by-line against the two source files |
| P&D detector absent from server | `grep -n "pdFlags\|P&D\|pump.*dump" src/scanner-engine.js` — zero matches |
| Manipulation HIGH soft, not hard, cap | Direct read of `scanner-engine.js:503-510` |
| Late-entry penalty stacks to -50 at change=6 | Direct read of `scanner-engine.js:266-275` |

Claims about runtime metrics (bad-ULTRA push rate, daily signal count) are
**estimates** until Phase 0 snapshot lands and captures them.

---

## 10. Document Inventory

The external review delivered the following 8 documents. They remain the
authoritative source on their respective topics; this document supersedes only
the parts marked **[REVISED]**.

| Document | Role | Disposition |
|----------|------|-------------|
| `SCANNER_DISCOVERY_REPORT.md` | Audit (drift matrix, per-engineer findings) | **Keep as reference.** §3.4 to be added: "Wasted Pipeline" (this document §5). |
| `SCANNER_REMEDIATION_PLAN.md` | 5-phase fix plan | **Keep with revisions** — Phase 0 compressed, Phase 0.5 inserted, Phase 1.0 validation added, Phase 2 forks on architectural decision |
| `SCANNER_BENEFITS_REPORT.md` | KPI table + business value | **Keep as reference.** KPI table extended in §7 above |
| `SCANNER_WIN_RATE_PLAN.md` | 70-75% Realistic / 80-85% Optimal path | **Keep as reference.** Out of scope for current remediation; revisit after Phase 4 backtest lands |
| `SCANNER_PRE_PUMP_QUALIFICATIONS.md` | 54+ qualification catalog | **Keep as reference.** Input to Phase 2.1 rule registry |
| `CRYPTO_PUMP_CONDITIONS_RESEARCH.md` | Academic backing | **Keep as reference.** |
| `CLAUDE.md` | Operating manifest for Claude Code | **Adopt.** Add §3 Phase 0.5 architectural decision as a standing question |
| `MISSION_PHASE_0.md` | First concrete task | **Revise** to match compressed Phase 0 in §6 |

---

**End of audit.** Next concrete action: Ziko answers the four pre-approval
questions in §8.
