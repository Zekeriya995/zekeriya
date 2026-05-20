# Scanner P&D Threshold Rationale (Phase 1.0)

> **Status:** Draft for Ziko's review. Implements P1.0 from
> `SCANNER_AUDIT_2026_05_15.md` §6 (decision C in §8.1: "validate the 5
> client-side flag thresholds _before_ porting to the server").
>
> **Date:** 2026-05-15 → 2026-05-16
> **Scope:** Document the economic / microstructure rationale for each of
> the 5 P&D flags currently active in `app.js:2459-2476`, classify the
> evidence quality, and recommend a porting strategy for Phase 1.1.

---

## 1. Why this document exists

The external 10-engineer review's plan ports `detectPumpAndDump` to the
server _as-is_. The internal audit's concern (decision C) was that
porting an unvalidated detector multiplies its impact: every bad
threshold now distorts both client-side and server-side scoring, and on
the server it also leaks into push notifications, win-rate stats, and
the eventual backtest.

The original intent of P1.0 in the audit doc was to read
`data/scanner-history.json` and compute, per flag, the proportion of
historical signals that fired with that flag set vs. their evaluated
outcomes. **That cannot be done today**, because:

1. `data/scanner-history.json` does **not exist in the repository** — it
   is generated on the production VPS at runtime and persists locally
   only.
2. The current `recordSignal()` schema (see `src/scanner-history.js:78-89`)
   stores `{s, score, tier, entryPrice, sl, tp1, tp2, recordedAt,
evaluated, outcome, pctChange, exitPrice}` — **no flag list, no tag
   bag, no reasons array**.

So a pure quantitative validation is impossible until either (a) we
extend the schema to record flags going forward and let data accumulate
for 2-4 weeks, or (b) we manually backfill flags by re-running the
detector against a captured price/volume time series.

This document does the next-best thing: a structured **microstructure
rationale review** of each flag, plus a recommendation for porting,
plus a concrete proposal (§6) for the schema extension that will enable
the quantitative pass later.

---

## 2. Summary table

| #   | Flag              | Threshold                                 | Confidence     | Verdict for Phase 1.1                                         |
| --- | ----------------- | ----------------------------------------- | -------------- | ------------------------------------------------------------- |
| 1   | `VERTICAL`        | `d.c >= 15` (24h % change ≥ +15)          | **High**       | **PORT as-is**                                                |
| 2   | `FR_EXTREME`      | `fr.rate > 0.1` (per 8h, ≈ 0.1%)          | **Medium**     | **PORT as-is, add unit assertion in test**                    |
| 3   | `LS_RETAIL_LONG`  | `LS[s].ratio > 2.5` (shipped Phase 1.1.c) | **Medium-Low** | **PORTED-WITH-WIDER-BAND** (was 3 → now 2.5, Ziko 2026-05-17) |
| 4   | `SMART_VS_RETAIL` | `topTrader.long < 0.4` AND `LS.ratio > 2` | **Medium**     | **PORT as-is** (compound condition is self-validating)        |
| 5   | `THIN_PUMP`       | `d.c >= 8` AND `d.v < 3e7` (USD)          | **Low**        | **DEFER until schema extension yields ≥ 7 days of flag data** |

Aggregate verdict: **port 4 of 5 flags as-is or with a small widening,
defer 1 until quantitative data is available.** This keeps the spirit
of the external plan's "port as-is" while honoring decision C.

---

## 3. Per-flag analysis

### 3.1 `VERTICAL` — 24h % change ≥ +15%

```js
// app.js:2466
if (d.c >= 15) {
  pdFlags++;
  pdReasons.push('VERTICAL:+' + d.c.toFixed(0) + '%');
}
```

- **Data source.** `d.c` = Binance 24h % change, refreshed every minute
  via the spot tickers stream. No upstream rate limit risk.
- **Why this exists.** A vertical move of +15% over 24h on a USDT-pair
  is, in any sane venue, a tail event: roughly the 99th percentile of
  daily returns for liquid altcoins. Combined with a high funding rate
  or skewed long-short ratio, it is the canonical "late-stage pump"
  pattern that distribution typically follows within hours.
- **Microstructure rationale.** A vertical mark is not by itself a
  short signal — many continuation pumps tag +15% and run another
  +30%. But it is a **suppression** signal: the _expected forward
  return_ for a fresh long entered at +15% is materially worse than
  the same coin at +5%, because (a) the coin has already consumed
  much of the latent buy-side liquidity, (b) profit-takers and
  funding shorts are now actively defending levels.
- **Failure mode if too low.** A 15% threshold is generous; lowering
  it to 10% would catch most legitimate continuation moves and choke
  the scanner's pipeline. Symptom would be: scanner produces almost
  no ULTRA signals on green days.
- **Failure mode if too high.** Raising to 20%+ would let the scanner
  enter coins at the absolute top of the move, where SL probability
  is highest. Symptom would be: ULTRA signals with sub-30% win rate.
- **Verdict.** **PORT as-is.** The threshold is at a defensible level
  on the conservative side. Confidence **High** because (a) the
  underlying data is reliable, (b) the rationale is grounded in
  basic returns distribution, (c) there is asymmetric downside to
  changing it without data.

---

### 3.2 `FR_EXTREME` — Funding rate > 0.1

```js
// app.js:2467
if (fr && fr.rate > 0.1) {
  pdFlags++;
  pdReasons.push('FR_EXTREME:' + fr.rate.toFixed(3));
}
```

- **Data source.** `FR[sym]` — funding rate from `/api/all` aggregated
  across Binance / Bybit / OKX / Hyperliquid (see `app.js:294,107-109`).
- **Critical unit question.** Funding rate is conventionally quoted in
  one of three units across exchanges:
  - **Decimal per 8h** (Binance default): `0.0001` = 0.01% per 8h ≈
    0.03% APR daily, 11% annualized.
  - **Percent per 8h**: `0.01` = 0.01% per 8h.
  - **Annualized %**: `11.0` = 11% APR.

  At threshold `> 0.1`, this fires only if the value is in the third
  bucket (annualized %) at any reasonable rate, OR in the second
  bucket (percent per 8h) at an unsustainable 0.1% per 8h ≈ 110%
  APR. **The intended unit is almost certainly "percent per 8h"**,
  matching how the FR is also used in `app.js:478` (`r.frRate >
0.05` = "FR > 0.05%"). Cross-checked: line 478's label
  explicitly reads `'FR > 0.05%'`, confirming the percent unit.

- **Why this exists.** Funding > 0.1% per 8h is **shorts paying longs
  ~0.3%/day** = 110% APR to the long side. This level is reached only
  when retail is FOMO-long the perp aggressively while smart money
  is staying spot or neutral. Historically a leading indicator of
  liquidation cascades.
- **Microstructure rationale.** Extreme positive funding is a market-
  structure anomaly: it represents a transient demand for leverage
  that typically corrects within 1-3 funding intervals as longs get
  priced out or shorts arrive. Entering long at this point is buying
  at the most expensive moment of the cycle.
- **Failure mode if too low.** `> 0.05` would fire on ordinary trending
  days and over-suppress legitimate entries.
- **Failure mode if too high.** `> 0.2` would only fire at the
  absolute extreme tail and miss the early warning window.
- **Verdict.** **PORT as-is**, but the server-side test must
  explicitly assert the input unit (`expect(detectPumpAndDump({fr:
{rate: 0.15}})).toFire('FR_EXTREME')`). Confidence **Medium**:
  rationale is sound, but the unit fragility (different exchanges
  publish in different scales) is a non-trivial source of bugs.

---

### 3.3 `LS_RETAIL_LONG` — Long/short ratio > 3

```js
// app.js:2468
if (LS[s] && LS[s].ratio > 3) {
  pdFlags++;
  pdReasons.push('LS_RETAIL_LONG:' + LS[s].ratio.toFixed(1));
}
```

- **Data source.** `LS[s].ratio` — Binance global long/short account
  ratio (see `app.js:1988`). This is **all accounts**, not top
  traders, so it skews retail by construction.
- **Why this exists.** A 3:1 ratio of accounts going long means 75%
  of perp users are positioned for upside. Markets historically punish
  consensus, and this level is reached at retail euphoria peaks.
- **Microstructure rationale.** The ratio is a **sentiment proxy**,
  not a position-size proxy — one whale short can offset many retail
  longs in actual position weight. So the signal works _only because_
  retail tends to enter at tops; it is structurally weaker than
  funding rate (which IS volume-weighted).
- **Failure mode if too low.** `> 2` would fire constantly during
  uptrends and over-suppress.
- **Failure mode if too high.** `> 4` is rarely seen outside extreme
  tops; the threshold may already miss most useful signals.
- **Concern.** 3.0 is a **hard cliff**. A coin sitting at 2.9 fires
  zero flags; a coin at 3.0 fires one — and may flip the total over
  the `pdFlags >= 3` kill-line. Hard cliffs around continuous data
  are a known source of false negatives.
- **Verdict.** **PORT-WITH-WIDER-BAND** (recommended). Recommend
  the server-side port use `> 2.5` instead of `> 3`, OR a graduated
  weighting (`>= 3 → 1.0 flag`, `>= 2.5 → 0.5 flag`). The widening
  yields earlier suppression on borderline retail-heavy coins.
  Confidence **Medium-Low** — happy to revert if the tag-stats
  endpoint (P3.1) shows the new threshold over-suppresses.
- **As-shipped in Phase 1.1.c (2026-05-17).** Ziko approved the §5
  verdict on 2026-05-17. The server detector
  (`src/scanner-pd-detector.js`) now uses
  `FLAG_THRESHOLDS.LS_RETAIL_LONG_RATIO = 2.5`. The client at
  `app.js:2459-2476` still uses `> 3`; Phase 2.A.1 (unified rules
  registry) closes that gap. If the tag-stats endpoint shows the
  new threshold over-suppresses, revert by flipping the constant
  back to `3` — single-line change, no other code paths affected.

---

### 3.4 `SMART_VS_RETAIL` — Compound: top traders short AND retail long

> **Post-Phase-1.1 discovery (2026-05-17).** The original implementation
> on both client (`app.js:2469-2472`) and server's initial port
> referenced **`LS[s].ratio > 2`** (top-trader POSITION ratio) for the
> retail half AND `topTradersLS[s].positions[last].long < 0.4` (also
> top-trader POSITION fraction) for the smart-money half. Both halves
> read the same Binance endpoint (`topLongShortPositionRatio`), making
> the AND condition **logically impossible to satisfy** on any single
> snapshot — if `positions.long < 0.4` then `positions.ratio < 0.67`,
> never `> 2`. The flag was effectively dead code on both sides.
>
> **Fix (Phase 1.1.b):** the server now also fetches Binance's
> `globalLongShortAccountRatio` (TRUE retail signal — all accounts,
> not just top traders) into `cache.globalLs`. The detector reads
> this for the retail half of `SMART_VS_RETAIL`, restoring the
> divergence the flag's name implies. The client still has the
> contradiction; the planned Phase 2.A.2 (PWA consumes server signals)
> will inherit the fix automatically.

```js
// app.js:2469-2472
if (topTradersLS[s] && topTradersLS[s].positions && topTradersLS[s].positions.length > 0) {
  var _tp = topTradersLS[s].positions[topTradersLS[s].positions.length - 1];
  if (_tp && _tp.long < 0.4 && LS[s] && LS[s].ratio > 2) {
    pdFlags++;
    pdReasons.push('SMART_VS_RETAIL');
  }
}
```

- **Data source.** `topTradersLS[s].positions` (Binance top-100 perp
  account positions, position-weighted) AND `LS[s].ratio` (all
  accounts).
- **Why this exists.** This is the strongest of the 5 flags conceptually:
  it requires the **divergence** between informed money (top traders
  net short, `long < 0.4`) and uninformed money (all accounts net
  long, ratio > 2). Alignment of these two indicators is the
  classic "smart money exits while retail enters" pattern.
- **Microstructure rationale.** Top-trader data is position-weighted,
  which means it tracks where capital is, not just account count. A
  reading of `long < 0.4` means **the largest accounts on the venue
  are net short**, which is structurally meaningful in a way that
  account-count ratios are not. The compound condition self-filters
  out false positives where everyone is short (retail too).
- **Failure mode if too lax.** Loosening either side weakens the
  divergence. Already permissive at `LS > 2` (vs. the standalone
  flag's `> 3`), which is intentional — the compound nature
  justifies the lower bar.
- **Failure mode if too strict.** Tightening would make the flag
  effectively unreachable; `top.long < 0.4` is already the 95th
  percentile.
- **Verdict.** **PORT as-is.** The compound condition is naturally
  self-validating — by definition both halves must align, so the
  false-positive rate is structurally low. Confidence **Medium**:
  rationale is sound, but a quantitative pass on real history would
  still be welcome to set a confidence weight.

---

### 3.5 `THIN_PUMP` — Pump > 8% on volume < $30M

```js
// app.js:2474
if (d.c >= 8 && d.v < 3e7) {
  pdFlags++;
  pdReasons.push('THIN_PUMP');
}
```

- **Data source.** `d.c` = 24h % change, `d.v` = 24h quote volume (USD).
- **Why this exists.** A pump that doesn't spend volume is mechanically
  fragile — it represents a thin order book getting walked up by a
  small number of bids, with no real buy-side conviction. The classic
  "small-cap rip" before the dump.
- **Microstructure rationale.** Volume / move-size ratio is a real
  microstructure signal, BUT the cutoff values are fragile:
  - `$30M` daily volume is the small-cap line, but the actual line
    depends heavily on the exchange and the listing's age. A new
    listing's first 24h volume is by definition uncomparable.
  - `8% pump` overlaps with `VERTICAL` (15%) — coins in 8-15% range
    fire only this flag, coins above 15% fire both, double-counting.
- **Concerns.**
  1. **Double counting.** If `VERTICAL` AND `THIN_PUMP` are both
     reasonable, fine; but the implementation gives them equal
     weight in `pdFlags`, so a coin at +20% on $25M volume scores
     2 flags from what is essentially one observation
     (overheated + thin) — pushing it close to the kill-line.
  2. **Fixed $30M.** Cap-aware volume thresholds (e.g. % of market
     cap) would be more robust than a fixed $ figure across the
     entire altcoin spectrum.
  3. **No floor.** The flag fires on any coin with `d.v < 3e7`,
     including very illiquid microcaps where a $30M day is
     genuinely a pump. The distinction between "thin pump" and
     "small-cap legitimate move" gets blurred.
- **Verdict.** **DEFER.** This is the only flag where I am genuinely
  uncertain about the threshold — both the level and the design.
  Recommend:
  - Phase 1.1 ports flags 1-4 with the recommendations above.
  - `THIN_PUMP` stays **client-side only** until the schema extension
    (§6) accumulates 7+ days of `tags` data, then we can compute its
    actual co-occurrence with bad outcomes vs. `VERTICAL` alone.
  - If the deferral creates pressure to ship a 5-flag detector
    server-side, an acceptable compromise is to port it but **half-
    weight** it (`pdFlags += 0.5`), so it still contributes but
    cannot single-handedly trip the kill-line in combination with
    only one other flag.

Confidence **Low** — neither the threshold nor the design fully
defended.

---

## 4. Calibration of the kill-line itself

The current logic is:

```js
if (pdFlags >= 3)
  sc = Math.min(sc, -100); // hard kill
else if (pdFlags === 2) sc -= 25; // soft penalty
```

This is **independent of the validation** of individual flags, but
worth noting:

- **2 flags = -25** is a soft penalty (recoverable from with strong
  bullish signals).
- **3 flags = score floored at -100** is effectively a kill (the
  scanner's `qualityFilter` rejects anything below -50).
- The jump from -25 to -100 at 2 → 3 is the steepest cliff in the
  whole scorer. This is appropriate IF the flags are truly
  independent (low correlation), because three independent low-
  prior events firing simultaneously IS a different category from
  two. But if the flags are correlated (which `VERTICAL`/`FR_EXTREME`
  certainly are at market tops, and `VERTICAL`/`THIN_PUMP` certainly
  are by construction), the cliff is over-aggressive.

**Recommendation:** Phase 1.1 keeps the cliff as-is for the server
port (parity), but Phase 3.1's per-tag win-rate endpoint
(`/api/scanner/tag-stats`) should expose the correlation matrix
between P&D flags so we can revisit in Phase 4 with hard data.

---

## 5. Verdict for Phase 1.1

The compressed plan for Phase 1.1 should:

1. **Port flags 1, 2, 4 as-is** to the server (`VERTICAL`, `FR_EXTREME`,
   `SMART_VS_RETAIL`).
2. **Port flag 3 with a wider band** (`LS_RETAIL_LONG > 2.5` instead of
   `> 3`), documented in the commit message and CHANGELOG.
3. **Defer flag 5** (`THIN_PUMP`) as server-side until the schema
   extension yields data. Keep the client-side flag active for now.
4. **Keep the kill-line and soft-penalty unchanged** to preserve parity.
5. **Behind `SCANNER_SERVER_PD_ENABLED` flag** (already reserved in
   Phase 0). Default `true`. Toggle to `false` for instant rollback.
6. **Test coverage:** every flag gets at least 3 unit tests (fires
   correctly, doesn't fire below threshold, fires at exactly threshold).

This gives the server 4 of the 5 flags with documented rationale and
trades 1 flag for the validation discipline this whole exercise was
about.

---

## 6. Proposal: schema extension for quantitative re-validation

To close the loop and make a true quantitative pass possible, propose
extending `recordSignal()` and the persisted entry schema to include
the tag bag:

```js
// src/scanner-history.js — recordSignal()
history.push({
  s: sig.s,
  score: sig.score,
  tier: sig.tier,
  entryPrice: sig.price,
  sl: sig.sl || null,
  tp1: sig.tp1 || null,
  tp2: sig.tp2 || null,
  tags: Array.isArray(sig.tags) ? sig.tags.slice(0, 30) : [], // NEW
  recordedAt: ts,
  evaluated: false,
});
```

- **Cost:** ~30-40 bytes per entry × 1000 entries = ~30 KB on disk
  (vs. current ~150 KB ceiling). Negligible.
- **Cap at 30 tags** so a future bug that pushes hundreds of tags can't
  bloat the file.
- **Behind `SCANNER_TAG_HISTORY_ENABLED` flag** (env var, default
  `true`) per decision D.
- **Backfill:** new entries get `tags`, old entries have `tags:
undefined` — readers must `(entry.tags || [])`.

Once 7+ days of data accumulate post-deploy, write
`vps/validate-pd-thresholds.js` that loads the history, partitions
by P&D-flag presence, and reports per-flag suppression efficacy. That
report becomes the input for any future threshold tuning.

This proposal is implemented alongside this document in the same PR
(see commit P1.0b in the branch).

---

## 7. Out of scope

- **Reweighting `pdFlags` to floats** instead of integer counts — would
  let us express "this flag is worth 0.7 of a flag." Powerful but a
  bigger design change; Phase 4 candidate.
- **Time-decay on flags** — a `VERTICAL` reading from 22 hours ago is
  weaker evidence than one from 1 hour ago. Currently the detector is
  stateless. Phase 4 candidate.
- **Per-coin baselines** — applying `VERTICAL >= 15%` to BTC vs. a
  microcap is different. Cap-aware thresholds are out of scope here
  but listed as a known limitation.

---

## 8. Open question for Ziko

The verdicts in §2 are my best read given the data available. If you'd
rather the server port **all 5 flags as-is** (matching the external
plan's strict letter) and accept the residual risk on `THIN_PUMP`,
that's a defensible call too — confidence Low does not mean "bad,"
it means "I can't quantitatively show it's good." Reply with one of:

- `Approved §5 verdicts` — port 4 of 5, defer THIN_PUMP, widen LS to 2.5
- `Port all 5 as-is` — match external plan exactly, accept risk
- `Discuss <flag>` — call out specific flags you want to revisit
