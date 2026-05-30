# Market Direction Data Layer — Design (Hybrid, server-aggregated)

> **Status:** Design proposal — awaiting Ziko's call on the 5
> decisions in §10 before implementation begins. No code ships until
> the snapshot contract (§5) and aggregation rules (§7) are approved.
>
> **Date:** 2026-05-30
> **Scope:** The "Market Direction / اتجاه السوق" section (BTC + ETH,
> via `analyzeCoinRpt` in `app.js`). Replace single-venue, browser-side,
> silently-degrading data gathering with a **server-aggregated, multi-venue,
> health-scored** data layer feeding a **pure, testable** scoring function.
> **Audit basis:** the Market Direction audit (this session) — dead
> accuracy loop, structural bull bias in `ts`, un-normalized `sc`,
> scale-broken iceberg, silent secondary-source degradation.

---

## 1. Why this is non-trivial

Sizing this as "swap Binance calls for a better API" misses the point.
The Market Direction audit found the section's weakness is **not** the
indicators (`calcRSI/MACD/EMA/ATR` in `src/utils.js` are correct and
tested). It is everything around them:

1. **One venue.** `analyzeCoinRpt` reads Binance only. A live probe this
   session shows Binance BTC funding `0.00506%/8h` while Bybit reads
   `0.00473%` and **dipped negative** (`-0.0079%`) intraday — a real
   positioning signal a Binance-only read never sees.
2. **Silent degradation.** 12 secondary sources are wrapped
   `try/catch → null` and treated as "neutral" with no notice; freshness
   measures cache age, not source completeness.
3. **No feedback loop.** `getAccuracy`, `reportHistory`, `getChanges` are
   defined but never wired — the section cannot measure whether its own
   direction calls were right.
4. **Not testable.** All of the above lives in a 552 KB browser script
   (140 `document.` refs, no exports) that `tests/_setup.js` cannot load,
   so no fix can be covered by a test without extraction first.

The expensive, hard-to-reverse decision is the **data contract** between
server and PWA. This doc pins that contract down; everything downstream
(scoring tweaks, UI, persistence) is cheap to change after.

---

## 2. What the audit established (data-layer implications)

| Audit group | Finding | Data-layer implication |
| ----------- | ------- | ---------------------- |
| A | accuracy loop is dead code | server must **persist snapshots + evaluate** them |
| B | `ts` has structural bull bias | scoring becomes a **pure fn over the snapshot** → unit-testable symmetry |
| C | `sc` un-normalized (max ≈14, shown `/10`) | normalize against **live configured weights**, not a constant |
| D | iceberg bucket is absolute (`p*1e4`), dead for BTC | microstructure moves to a **relative-band** detector (and a gated source — see §3) |
| E | secondary sources fail silently | **health + completeness + confidence** become first-class |
| F | `bearP` capped at 35%, never displayed | resolved when scenarios are recomputed server-side |

---

## 3. Evidence — live data probe (this session)

Pulled against the institutional feed (CoinDesk/CCData) to ground the
design in what is actually reachable, not assumed:

| Signal | Live value (≈2026-05-30) | Note for design |
| ------ | ------------------------ | --------------- |
| Funding (Binance/Bybit BTC) | `0.00506%` vs `0.00473%`/8h; Bybit dipped `-0.0079%` | **multi-venue divergence is real** → aggregate |
| Open Interest (BTC) | `$7.70B`, **−1.72%/24h** at flat price | deleveraging — single venue would miss it |
| Taker flow (perp 1h) | `VOLUME_BUY` / `VOLUME_SELL` delivered split | **CVD comes pre-derived** → drop fragile browser reconstruction |
| Spot venues | 1691 instruments; USD venue buy-skewed vs USDT balanced | **Coinbase-premium proxy** is computable |
| News | top BTC headline `SENTIMENT: NEGATIVE` + `BENCHMARK_SCORE` | **sentiment pre-classified** → no NLP needed |
| Order-book metrics | **`error 97: not authorized`** | depth/L2 is **gated** in current package → §7 fallback |
| Spot/perp price | `~$73,880` | (the audit's `$67k` assumption is stale; band-relative logic matters) |

**Punchline:** multi-source read = *neutral-leaning-bearish* (flat price +
shrinking OI + cooling funding + negative news, minus mild US spot bid).
The current Binance-only read would print *mild bull*. That gap is the
whole project.

---

## 4. Target architecture (tiered hybrid)

```
 HIGH-FREQ  (sub-second → seconds)        MID-FREQ (minutes → hours)
 exchange WebSocket                       server.js poller (keys in env)
   price · trades · taker flow · depth      funding · OI · multi-venue agg
        │                                    news · sentiment · options(?)
        │                                            │
        └──────────────┬─────────────────────────────┘
                       ▼
            MarketDirectionSnapshot  (§5)  — one normalized object,
              { value, source, ts, confidence } per field
                       │
        ┌──────────────┼───────────────────────────────┐
        ▼              ▼                                ▼
  scoreDirection()   GET /api/market-direction/:sym   accuracy persistence
  pure fn (src/)     served to PWA                     → L2 calibrator
  ts · sc · scenarios   app.js consumes only           (calibrate-weights)
```

Key inversion: `analyzeCoinRpt` stops gathering secondary sources itself.
It fetches **one snapshot** and passes it to a pure `scoreDirection()` in
`src/market-direction.js`. This is what makes the audit's fixes testable.

---

## 5. The linchpin — `MarketDirectionSnapshot` (v1)

The one contract that must be right. Every field carries provenance,
timestamp, and confidence so the UI and scorer never have to guess.

```jsonc
{
  "schemaVersion": 1,
  "sym": "BTC",
  "asOf": 1780161336,            // server build time (unix s)
  "price": { "value": 73880.08, "source": "binance.ws", "ts": 1780161336, "confidence": 1.0 },

  "signals": {
    "funding": {
      "value": 0.00000503,        // volume-weighted across venues, per-interval
      "annualizedPct": 5.5,
      "trend": "cooling",         // rising | cooling | flat | flipping
      "perVenue": { "binance": 0.00005057, "bybit": 0.00004727, "okex": 0.000048 },
      "agreement": 0.86,          // 0..1 cross-venue concordance (drives confidence)
      "source": "ccdata.fr", "ts": 1780161303, "confidence": 0.9
    },
    "openInterest": {
      "valueUsd": 7.695e9, "change24hPct": -1.72,
      "interpretation": "deleveraging",   // building | deleveraging | flat
      "perVenue": { "binance": 7.695e9 },
      "source": "ccdata.oi", "ts": 1780161336, "confidence": 0.8
    },
    "takerFlow": {
      "buyVol": 318.35, "sellVol": 175.51, "imbalance": 0.29,  // (buy-sell)/(buy+sell)
      "window": "1h", "source": "ccdata.ohlcv", "ts": 1780160400, "confidence": 0.85
    },
    "spotPremium": {
      "usdVsUsdtPct": 0.04, "interpretation": "mild-us-bid",   // Coinbase-premium proxy
      "source": "ccdata.toplist", "ts": 1780161000, "confidence": 0.7
    },
    "news": {
      "score": 38, "label": "negative", "count24h": 14,
      "topHeadline": "Humpback whales intensify selling…",
      "source": "ccdata.news", "ts": 1780160551, "confidence": 0.6
    },
    "options": { "available": false, "reason": "endpoint_not_authorized" }
  },

  "health": {
    "sourcesTotal": 8, "sourcesLive": 6, "completeness": 0.75,   // sourcesLive/Total
    "degraded": ["options", "orderbook"],
    "perSource": {
      "ccdata.fr":  { "ok": true,  "lastSuccessTs": 1780161303, "errorRate1h": 0.0 },
      "orderbook":  { "ok": false, "lastSuccessTs": 0,          "errorRate1h": 1.0, "code": 97 }
    }
  }
}
```

**Confidence ∈ [0,1] per signal** is a function of: (a) source liveness,
(b) staleness vs the signal's *expected* cadence (funding ~8h, OI ~1m,
news ~min), and (c) cross-venue `agreement`. The scorer multiplies each
factor's contribution by its confidence — a 3/8-source read is *weaker*,
not silently "neutral". This is the direct fix for audit group E.

---

## 6. The API contract

```
GET /api/market-direction/:sym            → MarketDirectionSnapshot (v1)
GET /api/market-direction                 → { BTC: {...}, ETH: {...} }   (batch)
```

- Cache server-side per `sym` on each signal's natural cadence; never
  block a request on a live upstream fetch (serve last-good + `health`).
- `schemaVersion` is mandatory; PWA refuses unknown majors and falls back
  to its existing local read (graceful, mirrors the scanner's
  `all.scannerTs` staleness fallback in `SCANNER_PWA_SERVER_SIGNALS_DESIGN.md`).
- No secrets in the payload; provider keys stay in `server.js` env.

---

## 7. Aggregation, confidence & degradation rules

1. **Venue aggregation** — funding/OI are **volume-weighted** across the
   approved venue set (§10 D1). `agreement` = 1 − normalized dispersion.
2. **Graceful degradation** — a failed source sets `perSource.ok=false`,
   lowers `completeness`, and drops that signal's `confidence` toward 0.
   It does **not** vanish silently and does **not** count as neutral.
3. **Gated endpoints** — order-book depth returned `error 97`. v1 marks
   microstructure `available:false`; the relative-band iceberg/absorption
   detector (audit group D) runs off the **exchange WebSocket** trade
   stream instead, independent of the gated REST endpoint.
4. **Freshness is per-field**, surfaced from each signal's `ts`. The old
   single `getMktFresh(cacheTime)` is replaced by `health.completeness`
   plus oldest-field age.

---

## 8. Closing the loop — the explicit "correct" criterion

The audit's #1 priority. Proposed, pending D2:

- On each snapshot build, persist `{ sym, dir, ts(score), price0, asOf }`.
- Evaluate at horizon **H** after `asOf`: let `move = (priceH − price0)/price0`.
  - `dir` bullish → **correct** iff `move > +θ`
  - `dir` bearish → **correct** iff `move < −θ`
  - `dir` neutral → **correct** iff `|move| ≤ θ`
- Persist `correct` and feed per-factor outcomes to the **existing L2
  calibrator** (`tests/calibrate-weights.test.js`, `vps/`), not a new
  system. `getAccuracy()` then reports a *real* number.

`H` and `θ` are decisions, not guesses (§10 D2).

---

## 9. Phased plan

| Phase | Deliverable | Risk | Closes |
| ----- | ----------- | ---- | ------ |
| 1 | server aggregator + `/api/market-direction` (funding+OI multi-venue, health/completeness). **Additive, no UI change.** | very low | E |
| 2 | extract `scoreDirection()` → `src/market-direction.js` (exported) + unit tests; PWA consumes snapshot | low | **testability** + A |
| 3 | taker flow via `VOLUME_BUY/SELL`; news sentiment; spot-premium; surface `completeness` in UI | medium | E + signal quality |
| 4 | de-bias `ts` (symmetry tests), normalize `sc` vs live weights, wire accuracy loop → L2 | medium | B + C + A |
| 5 | backtest on historical `*_ohlcv`, tune | low | credibility |

Phases 1–2 deliver the original audit fixes **on a testable footing** —
no prior work is wasted, it is rebuilt correctly.

---

## 10. Decisions needed from Ziko (before Phase 1)

- **D1 — Venue set.** Aggregate funding/OI across `binance + bybit + okex`?
  Add a USD venue (e.g. Coinbase) for the spot-premium signal? More venues
  = stronger signal, more rate-limit budget.
- **D2 — Accuracy horizon & dead-band.** Propose `H = {4h, 24h}` (track
  both) and `θ = 0.5%`. Accept, or set your own.
- **D3 — Polling cadence / cost ceiling.** Propose funding 5m, OI 1m,
  news 3m, toplist 5m. Bounded by the provider package's rate/cost — your
  call on the ceiling.
- **D4 — Options in v1?** The options endpoints need an auth check (depth
  was gated). Include skew/put-call in v1, or defer to a later phase?
- **D5 — Confidence handling.** Soft (multiply contribution by confidence,
  **recommended**) vs hard gate (drop a factor below a confidence floor)?

Answer D1–D5 and I start Phase 1 on `claude/jolly-albattani-yHsK2`.
