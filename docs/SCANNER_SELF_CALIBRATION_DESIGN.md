# Scanner Self-Calibration — Design (L2 → L3)

Blueprint for evolving the regime-adaptive scanner from **static profiles
chosen by regime** (today) into a **self-calibrating, guardrailed control
system** that tunes the platform per market regime (down / up / ranging /
volatile) from real forward outcomes.

This is a design reference, not a commitment to build now. Every level is
**gated by accumulated forward data and by proving an edge at the level
below it.** Nothing here ships until the data justifies it.

---

## 0. Maturity ladder & where we are

| Level  | Capability                                                                    | Status              |
| ------ | ----------------------------------------------------------------------------- | ------------------- |
| **L0** | Static weights, one profile for all markets                                   | superseded          |
| **L1** | Regime-adaptive **selection** among fixed profiles                            | **we are here**     |
| **L2** | Periodic re-calibration of a regime's weights, **human-approved**             | next                |
| **L3** | **Automated** walk-forward re-calibration with champion/challenger guardrails | after L2 proves out |
| **L4** | Richer policy: shorts, position sizing, more regimes, continuous adaptation   | future              |

You cannot skip levels. L3 without a validated L2 pipeline is "a complex
system that loses money with confidence."

### What already exists (the skeleton)

- **Sense** — `src/scanner-regime.js` `detectRegime()` → `trending` / `ranging` (+ `trendScore`, `inputs`).
- **Decide** — `WEIGHTS_V2` / `WEIGHTS_TREND` in `src/scoring-rules.js`; adaptive selection in `src/scanner-engine.js` (`passProfile`), client nudge in `src/scanner-helpers.js` (`regimeConfAdjustment`).
- **Measure** — `src/scanner-backtest.js`: `compareWeightProfiles()` (retrospective re-score / A/B) and `liveProfilePerformance()` (forward, by stamped `weightsProfile`).
- **Observe** — `vps/monitor-trend.sh` cron → `logs/scanner-report.log` time series.
- **Stamp** — `recordSignal()` persists `weightsProfile` per signal; `scoreSymbol` stamps the live profile; `/api/all` exposes `activeProfile`.

The **missing** pieces for L2/L3 are **Learn** (re-derive weights from
outcomes) and **Guardrail** (never promote an unproven profile).

---

## 1. Non-negotiable design principles

1. **Forward is the only judge.** Optimize on out-of-sample, net-of-fees,
   alpha-relative outcomes. Retrospective A/B is a hypothesis generator, not
   a verdict.
2. **Walk-forward, zero leakage.** Train on `[t0,t1]`, validate on `[t1,t2]`,
   roll forward. Any look-ahead invalidates the result. Enforce with tests.
3. **Champion / challenger.** A new profile never replaces the live one
   unless it beats it on **held-out forward** data, net of fees, by a margin
   `M`, over a minimum sample `N`, across `K` independent windows.
4. **Bounded change.** Cap the per-cycle weight delta; rate-limit promotions.
   Smooth, auditable steps — never a wholesale jump.
5. **Auto-rollback.** Continuously watch the live profile; if forward
   expectancy drops below a floor over a window, revert to the prior champion.
6. **Fail safe = do nothing.** If no profile has positive forward expectancy
   in the current regime, **raise the bar / suppress signals** (capital
   preservation). The system's most professional trait is knowing when not to
   trade.
7. **Human-in-the-loop until autonomy is earned.** Risk limits, the objective
   function, guardrail thresholds, and the kill switch always stay human.
8. **Interpretability over sophistication.** On this data scale, a transparent
   search beats an opaque deep net — it is debuggable and trustworthy. No
   price prediction; no black-box auto-trading.

---

## 2. L2 — Human-approved periodic re-calibration

Goal: from accumulated forward history, **propose** better weights for a
regime, prove the proposal out-of-sample, and let a human approve shipping it.

### 2.1 Inputs

- `data/scanner-history.json` — forward, evaluated signals, each stamped with
  `weightsProfile` and (already persisted) the profile-independent `ctx`.
- Grouped **by regime** (join each entry to the regime active at `recordedAt`;
  persist regime on the entry going forward to make this exact).
- Sample gate: per regime, require `≥ N_min` evaluated signals before
  calibrating (else: "keep accumulating").

### 2.2 Objective

Maximize forward, net-of-fees expectancy with a win-rate / alpha floor:

```
score(profile) = mean(net_alpha | surfaced under profile)
                 subject to  netWinRate ≥ floor  and  surfaced ≥ N_min
```

Net = gross − round-trip fee (default 0.2%). Alpha = signal return − basket
median (already computed in history stats).

### 2.3 Method (start simple, stay robust)

- Recover each candidate's profile-independent base features (already done in
  `compareWeightProfiles` base-score recovery).
- Search weight space with a **gradient-free, bounded** optimizer:
  coordinate search or Bayesian optimization. **Not** a deep NN — data is thin
  and interpretability matters.
- **Walk-forward** split with rolling windows; report in-sample vs
  out-of-sample to expose overfitting.
- **Regularize**: cap deltas from the incumbent; penalize the number of
  non-zero weight changes.

### 2.4 Output

- A candidate `WEIGHTS_<REGIME>` diff.
- A report: incumbent vs candidate on **held-out forward** data, per regime,
  net, with sample size and confidence.
- Human reviews → approves → ship as constants via a normal PR (the workflow
  we already use).

### 2.5 New surface

- `vps/calibrate-weights.js` (offline, read-only): reads history, emits a
  candidate + report. Reuses `scanner-backtest` helpers. Pure core, unit-tested.
- No live behavior change from running it — it only proposes.

### 2.6 Acceptance criteria

- Reproducible; strict temporal split; **unit-tested for leakage** on a
  synthetic dataset with a known optimum.
- Emits a candidate only when `sample ≥ N_min`.
- Never auto-ships.

---

## 3. L3 — Guardrailed automated re-calibration

Goal: close the loop — schedule L2, validate candidates **live in shadow**,
and promote/rollback automatically within hard guardrails.

### 3.1 Shadow scoring (the key new infrastructure)

- Extend the engine to score each pass under one or more **shadow profiles**
  in parallel and stamp their (hypothetical) outcomes — **without surfacing
  those signals to users.**
- This yields **forward, out-of-sample** data on a candidate profile **without
  risking a single trade.** It is the safe bridge between "looks good in
  backtest" and "live."

### 3.2 Control loop

1. **Calibrate** (scheduled, e.g., weekly) → candidate per regime (L2 core).
2. **Shadow** the candidate for a probation window; collect forward stamped
   outcomes.
3. **Promotion gate**: promote challenger → live **only if** it beats the
   champion on shadow-forward data, net, by margin `M`, over `≥ N`, across
   `≥ K` windows. Otherwise discard.
4. **Bounded apply**: cap per-cycle weight delta; rate-limit promotions.
5. **Auto-rollback**: if the live profile's forward expectancy falls below a
   floor over a window → revert to the prior champion (or to risk-off).

### 3.3 Fail-safe / risk-off

If neither the live nor any shadow profile has positive forward expectancy in
the current regime, the controller **raises the tier threshold / suppresses
signals** until conditions change. Doing nothing is a valid, often optimal,
action in a hostile regime.

### 3.4 Autonomy gating

- L3 enables **per regime**, and only after L2 has shipped `≥ X`
  human-approved calibrations for that regime that **held up forward** (trust
  is earned, not assumed).
- Global **kill switch** (env flag). Full **audit log** of every
  promotion / rollback with the evidence that triggered it.

### 3.5 Risk register

| Risk               | Mitigation                                              |
| ------------------ | ------------------------------------------------------- |
| Overfitting        | Walk-forward + held-out gate + delta caps + min sample  |
| Non-stationarity   | Rolling windows, fast rollback, regime conditioning     |
| Reflexivity        | Shadow-first, rate-limited promotions, bounded deltas   |
| Look-ahead leakage | Strict temporal splits, leakage unit tests              |
| Regime mislabel    | Robust detector, conservative defaults, fail-safe quiet |
| Silent live decay  | Continuous forward monitoring + auto-rollback floor     |

---

## 4. Regime policy matrix (what "control the whole platform" means)

Calibration **fills each cell with data**; the matrix is the policy skeleton.

| Regime                    | Posture          | Levers                                                                                          |
| ------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| **Downtrend**             | Defensive / cash | Higher threshold, fewer longs, reversal only on strong confirmation, ATR stops, (future) shorts |
| **Uptrend**               | Momentum         | Reward trend-aligned longs, more signals, wider targets                                         |
| **Ranging**               | Contrarian       | Mean-reversion / dip-buy (the validated `WEIGHTS_V2` edge)                                      |
| **Volatile / transition** | Reduced size     | Widen stops (ATR), fewer signals, demote confidence                                             |

---

## 5. Human vs autonomous boundary

- **Always human:** risk limits, the objective function, guardrail thresholds
  (`M`, `N`, `K`, floors), the kill switch.
- **Eventually autonomous (within bounds):** the weight values per regime, and
  profile promotion within the guardrails.

---

## 6. Sequencing (data-gated)

1. **Now (L1):** accumulate forward data; watch `logs/scanner-report.log`.
2. **When a regime clears `N_min`:** build + run L2 offline; ship the first
   data-derived profile by human approval.
3. **After several validated L2 cycles per regime:** build L3 shadow scoring +
   guardrails; enable per regime behind the kill switch.
4. **Continuously (L4):** add regimes, shorts, and position sizing.

---

## 7. Non-goals / anti-patterns

- No direct price prediction.
- No opaque black-box that trades without forward validation.
- No skipping the out-of-sample gate.
- No unbounded autonomy, ever.

---

## 8. The honest bottom line

This system makes the platform **more adaptive and self-correcting** — it does
**not** guarantee profit. Profit requires a real edge that survives forward,
net of fees; the system's job is to **find, validate, protect** that edge and
to **fail safely** when there is none. Sophistication is not the source of the
edge — **data quality, disciplined out-of-sample validation, and risk
management are.**
