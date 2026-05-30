# Market Movement Auto-Summary — Design

> **Status:** Design — core shape **locked by Ziko this session**; only the
> micro-decisions in §8 remain. Builds on the `MarketDirectionSnapshot`
> contract (`MARKET_DIRECTION_DATA_LAYER_DESIGN.md`).
>
> **Date:** 2026-05-30
> **Decisions locked:** (1) cadence = _all_ — continuous capture + periodic
> summary + instant alert on direction flip; (2) output = an **in-app panel
> at the end of the BTC market-direction analysis** (then ETH); (3) narrative
> = **deterministic templates** (revive `buildStory`), offline, no LLM.
> **Scope:** An automated job that watches BTC/ETH movement over time and
> renders an Arabic-first narrative summary of the up/down moves and
> direction flips — informational only, no action verbs.

---

## 1. Why this is mostly a _revival_, not new build

The Market Direction audit found a half-built narrative engine already in
the tree, all **dead/unwired**. This feature wires and automates it:

| Dead piece (today)                           | Role it was meant to play           |
| -------------------------------------------- | ----------------------------------- |
| `buildStory()` + `MKT_TPL` / `MKT_TPL_EN`    | the Arabic/English narrative itself |
| `getChanges()`                               | describe change vs the last report  |
| `hourlyLog` / `addHourlyLog()`               | rolling movement log                |
| `reportHistory` / `prevReport` (`nxRptHist`) | the time-series it reads from       |
| `supervisorData.dailyReport` / `lastReport`  | the empty "daily report" slot       |
| `vps/` periodic trend capture (#145)         | forward server-side monitoring      |

So the work is: **persist a real time-series, drive a deterministic
narrative from it on a schedule + on flips, and render it at the bottom of
the BTC analysis.**

---

## 2. Behavior model (the locked "all")

1. **Continuous capture** — a server job samples a `MarketDirectionSnapshot`
   for BTC/ETH every ~20 min and appends it to a persisted time-series.
2. **Periodic summary** — every 6h, and a longer end-of-day roll-up, the job
   regenerates the narrative over the trailing window.
3. **Instant on-flip** — when `dir` crosses a boundary (bull ↔ neutral ↔
   bear) or a large move fires, it regenerates immediately and timestamps
   the flip so the panel always reflects the latest turn.

All three feed the **same** stored summary object the PWA reads — the panel
is never stale relative to the last flip.

---

## 3. The narrative engine (deterministic)

Input: the trailing slice of the time-series → a set of **deltas**:

- net move and intraday high/low (the up-leg vs the down-leg, with times)
- direction flips and **when** they happened
- funding trend (cooling / heating / flipped sign), OI (building /
  deleveraging), taker-flow tilt, news tone, source completeness

Output: template-filled Arabic prose that **separates the up moves from the
down moves** and names the turning point. No buy/sell verbs (mirrors the
audit's "good practice"). Example:

> «خلال آخر 24 ساعة: BTC صعد إلى ‎$74,100‎ صباحاً مدعوماً بتدفّق شراء، ثم
> تراجع بعد الظهر مع **تبريد التمويل** و**تقلّص OI ‎−1.7%‎**؛ الاتجاه انقلب
> من _صعودي_ إلى _محايد_ عند الساعة 14:00. نبرة الأخبار سلبية (توزيع حيتان).
> اكتمال المصادر 6/8.» — _للاطلاع فقط._

Templates extend the existing `MKT_TPL` set with movement/flip/timing
fragments, and reuse `getChanges()` logic for the "since last" line.

---

## 4. Placement & data flow

```
server job (PM2/cron, like vps/*)        PWA (app.js)
  capture snapshot every ~20m              buildChartHTML(BTC):
  detect flips / big moves        ──►        … 15 existing sections …
  regen narrative (periodic+flip)            ► NEW final section:
  store data/market-summary.json               "📜 ملخّص حركة السوق (آلي)"
        │                                       narrative + flip timeline
        └──►  GET /api/market-summary/:sym  ──►  + "آخر تحديث / اكتمال المصادر"
                                                 then mktSignature() disclaimer
```

The panel is the **last content block** of the BTC report (immediately
before `mktSignature()` at `app.js:5322`), then mirrored for ETH.

---

## 5. Persistence

- Time-series + latest summary live server-side in `data/market-summary.json`
  (same pattern as `data/scanner-history.json`), capped/rolled like
  `supervisorData`.
- This finally gives `reportHistory` a real writer — and the **same store
  doubles as the accuracy-loop history** from the data-layer design (one
  time-series, two consumers). No duplicate plumbing.

---

## 6. Phases

| Phase | Deliverable                                                                                 | Risk   |
| ----- | ------------------------------------------------------------------------------------------- | ------ |
| 1     | narrative engine as pure `src/market-summary.js` (templates + flip/delta) + unit tests      | low    |
| 2     | server job: capture time-series, regen on schedule + on-flip, store + `/api/market-summary` | medium |
| 3     | PWA panel rendered as the final BTC section (then ETH); freshness + completeness line       | low    |
| 4     | wire instant-on-flip + the end-of-day roll-up into `supervisorData.dailyReport`             | low    |

Phase 1 is independent of the hybrid data layer (works off existing
`analyzeCoinRpt` output), so it ships value immediately and is fully
testable — paying down the extraction debt the audit flagged.

---

## 7. Out of scope (deferred)

- Telegram delivery (the platform supports it) — not chosen now; the stored
  summary + `/api` make it a one-function add later if wanted.
- LLM phrasing — explicitly rejected for determinism/offline/no-hallucination.

---

## 8. Remaining micro-decisions

- **D1 — periodic cadence:** 6h _and_ daily roll-up (proposed), or just one?
- **D2 — flip sensitivity:** what counts as a "big move" alert besides a
  `dir` boundary cross — propose ≥ 1.5% in < 1h, or your threshold.
- **D3 — window of the panel narrative:** trailing 24h (proposed) vs 12h.

Answer D1–D3 (or accept the proposals) and I start Phase 1 on
`claude/jolly-albattani-yHsK2`.
