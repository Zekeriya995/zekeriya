# Phase 2.A.2 Design — PWA consumes server-side signals

> **Status:** Design proposal — awaiting Ziko's call on the 3
> decisions in §3 before implementation begins.
>
> **Date:** 2026-05-20
> **Phase:** 2.A.2 (per `SCANNER_AUDIT_2026_05_15.md` §6, Option A path)
> **Estimate:** 1.5-2 days post-decisions
> **Audit spec:** "PWA `loadTk()` consumes `all.signals` as primary;
> falls back to local `quickScan` only when `all.scannerTs` is >
> 60s stale."

---

## 1. Why this is non-trivial

When I first sized this as "wire `loadTk` to read server signals," it
sounded like a one-day plumbing job. After tracing the actual PWA scan
pipeline, the wiring is straightforward — but the **architectural
question** behind it isn't:

> The PWA's local scanner does more than the server does. What happens
> to the extra work?

This doc lays out three concrete decisions Ziko needs to make before
the implementation starts. Each has a recommendation; none is
controversial. ~10 minutes of review unblocks 1.5-2 days of code.

---

## 2. Current state (verified by reading `app.js`)

The PWA's scan pipeline is **three stages** chained behind `getScanResults`:

```
loadTk()  ────────────────────────────►  fetches /api/all every ~5s
                                          updates T, FR, OI, LS, takerData,
                                          depthSnapshots, whaleWaves, etc.
                                          DOES NOT today touch all.signals
                                          (the audit's "Wasted Pipeline" finding)

getScanResults(forceFresh)  ─────────►  returns cache.scan if < CACHE_TTL
       │                                  else awaits the inflight scan
       ▼
quickScan()  ────────────────────────►  iterates T (~800 symbols), filters by
   (app.js:2343, ~150 lines)             volume + tier + stables, scores each
                                          with the client's full rule-bag (P&D,
                                          MANIP, FR, LS, OBI, etc.), returns
                                          a ranked array of candidates with
                                          {s, score, tags, c, v, p} shape.

deepAnalyze(cands)  ─────────────────►  takes top-30 candidates, fetches
   (app.js:2505, ~250 lines)              5m/15m/1h/4h klines from Binance
                                          directly, computes VPIN, iceberg,
                                          absorption, multi-TF alignment,
                                          stronger SL/TP via atrZones (browser),
                                          returns enriched signals with shape
                                          {s, score, tier, sl, tp1, tp2,
                                           direction, signals: [...]}.
                                          THE OUTPUT IS THE FINAL UI SIGNAL.
```

The server's `/api/all.signals` payload is structurally **the output of
`scoreSymbol` for each symbol** — same fields as `quickScan` output
PLUS the few server-only fields (`manipulationRisk`, `📐ATR_ZONES`
when applicable). It's **not** equivalent to `deepAnalyze`'s output —
server has no klines / VPIN / iceberg / absorption / MTF.

So a naive "swap quickScan with all.signals" would **lose** the
deepAnalyze enrichment. That's not what the audit intends.

---

## 3. Three decisions Ziko needs to make

### 3.1 Decision A — Replacement scope

**Question:** When the server signals are fresh (< 60s), what runs on
the client?

| Option                                                                                                  | Behavior                                                                                            | Pros                                                                      | Cons                                                                                          |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **A1.** Server primary, deepAnalyze on top of server.signals                                            | Server emits the candidate list with score+tags; client runs deepAnalyze for kline-based enrichment | Best of both: server-side parity for scoring, client-side depth for top-3 | Two scoring passes (server then client adds atrZones/MTF); could disagree on borderline cases |
| **A2.** Server primary, deepAnalyze runs only when server stale                                         | When fresh, render server.signals directly; deepAnalyze becomes the fallback path                   | Cleanest path; fewest moving parts; matches the audit's wording literally | Loses MTF / VPIN / iceberg / atrZones enrichment for the 95% case where server is fresh       |
| **A3.** Server primary always, deepAnalyze gets its OWN entry point (e.g., "Deep Dive" button on top-3) | Server signals power the home tab; deepAnalyze available on-demand for top-3 details                | Best UX (zero waste, on-demand depth)                                     | Adds a UI affordance + lazy loader; design + render work                                      |

**Recommendation: A2** — match the audit's literal wording, defer
the enrichment question to a follow-up. Phase 2.A.4 already brought
ATR zones server-side, so the only remaining client-only enrichment
is MTF / VPIN / iceberg / absorption — useful but not on the critical
path of the home-tab UX.

Decision needed: **A1 / A2 / A3.**

---

### 3.2 Decision B — Default state of the rollout

**Question:** Should `nxScannerFix_server_signals` default to **ON** or
**OFF** for the first deploy?

| Option                          | Behavior                                                                                                                                      | Pros                                                                                                           | Cons                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **B1.** Default ON (convention) | Every user on shamcyrpto.com immediately uses server signals after they fetch the new app.js                                                  | Matches every other scanner-fix flag; ships the value to users on day one                                      | User-facing change rolls to everyone at once; if anything regresses, every user sees it before we notice |
| **B2.** Default OFF (cautious)  | Existing users keep client-side scan; Ziko (or anyone else who knows) opts in via `localStorage.setItem('nxScannerFix_server_signals', 'on')` | Zero blast radius on first deploy; lets Ziko test in his own browser for ~7 days; flip default in follow-up PR | Inconsistent with the existing flag convention; needs a 2nd PR to flip ON                                |

**Recommendation: B2 (default OFF for first deploy)** — this is a
user-facing change touching the entire UX surface. Every other
flag we've shipped tonight was server-side (no end-user visibility
until Ziko deploys). Server-side flags can default ON safely because
Ziko deploys + watches. The client flag would reach every user on
shamcyrpto.com on the next app.js fetch — much higher blast radius.
Default OFF for one week, then flip default ON in a 5-line follow-up
PR after Ziko verifies.

Decision needed: **B1 / B2.**

---

### 3.3 Decision C — Transition UX

**Question:** When does the client switch between server-primary and
local-fallback modes?

| Option                                                                                                | Behavior                                                                                | Pros                                             | Cons                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **C1.** Hard switch on every refresh tick                                                             | Each `getScanResults` call re-evaluates: fresh server → server; stale → local quickScan | Simplest implementation                          | User on the Top-3 page may see SOL appear-disappear-reappear if server drops to stale-then-fresh repeatedly |
| **C2.** Hysteresis — once switched to local, stay there until server is fresh for 2 consecutive ticks | Smoother transitions; rare but visible                                                  | Stable UX; one extra state var                   | Slightly more complex                                                                                       |
| **C3.** Show the source in the UI (small badge, "📡 server" / "🖥️ local")                             | Same as C1 but transparent                                                              | User sees the data lineage; debugging is trivial | Visual clutter; might confuse non-engineers                                                                 |

**Recommendation: C1 + tag-based transparency** — start with the
simplest path (re-evaluate every tick). Tag the signals with
`📡SRC_SERVER` or `🖥️SRC_LOCAL` (already in tag-bag, no UI work
needed beyond the existing tag renderer). Hysteresis can come later
if Ziko sees flicker in practice.

Decision needed: **C1 / C2 / C3.**

---

## 4. Implementation plan (post-decisions)

Assuming defaults (A2, B2, C1 + tags):

### 4.1 Branch & PR structure

Single PR, 3 commits:

1. **Commit 1 — Plumbing.** In `loadTk()`, after the existing
   `if(all){...}` block, capture `all.signals` and `all.scannerTs`
   into globals `serverScanData` and `serverScanTs`. No
   consumer yet. Push & verify nothing breaks.

2. **Commit 2 — Wiring.** In `getScanResults`, branch:

   ```js
   var enabled = localStorage.getItem('nxScannerFix_server_signals') === 'on';
   var fresh = serverScanTs && Date.now() - serverScanTs < 60_000;
   if (enabled && fresh && serverScanData && serverScanData.length) {
     // Adapt server.signals to the cache.scan shape and short-circuit.
     return Promise.resolve(_adaptServerSignals(serverScanData));
   }
   // else: existing quickScan + deepAnalyze path
   ```

   Adapter: rename `change` → `c`, `volume` → `v`, `price` → `p`,
   add `📡SRC_SERVER` tag, preserve everything else.

3. **Commit 3 — Source tags + docs.** Add `🖥️SRC_LOCAL` tag to the
   quickScan path output. Update `app.js` header. CHANGELOG entry.

### 4.2 Files touched

| File                                        | Change                                                      | Lines |
| ------------------------------------------- | ----------------------------------------------------------- | ----- |
| `app.js`                                    | `loadTk` capture + `getScanResults` branch + adapter        | ~30   |
| `app.js` (header)                           | Document the flag's default-OFF state for the first release | ~5    |
| `CHANGELOG.md`                              | Phase 2.A.2 entry with the 3 decisions recorded             | ~40   |
| `docs/SCANNER_PWA_SERVER_SIGNALS_DESIGN.md` | This doc, with §3 marked "resolved"                         | ~5    |

### 4.3 Test plan

- **Unit:** none feasible (browser globals, async pipeline). The
  helper `_adaptServerSignals` could be extracted to `src/scanner-adapter.js`
  and unit-tested if Ziko wants — adds ~30 mins.
- **Manual (Ziko in his browser):**
  1. Deploy with flag default OFF.
  2. Verify zero regression on shamcyrpto.com (existing scan still
     works, no missing signals).
  3. Open DevTools, run `localStorage.setItem('nxScannerFix_server_signals',
'on')`, reload.
  4. Verify Top-3 carries `📡SRC_SERVER` tag and matches `/api/all`'s
     `signals` array.
  5. Stop the proxy on VPS for 90s, reload PWA. Verify fallback
     kicks in (signals carry `🖥️SRC_LOCAL` tag) and scan still
     produces results.
- **CI:** Existing `npm run check` (lint + format + 674 tests). No
  new test failures expected since the change is browser-side.

### 4.4 Rollback

| Scenario                                      | Action                                                                                  | Time             |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------- |
| Server signals wrong / missing tags           | Set `localStorage.setItem('nxScannerFix_server_signals', 'off')` in any browser, reload | <30s per user    |
| Catastrophic — wrong signals on every browser | Revert the PR. Service worker cache TTL means worst-case 1h staleness.                  | 2-30 min         |
| Want to test before public flip               | Default stays OFF; testers opt-in individually                                          | Always available |

---

## 5. Known unknowns

1. **`deepAnalyze`'s output shape vs server's signal shape.** I traced
   the structural fields but did NOT exhaustively compare every key in
   every render path. The adapter needs to be careful — best to add it
   alongside a `console.assert(typeof s.score === 'number')` in each
   render hot-spot during the first week.
2. **Service worker caching of app.js.** If the SW caches an old
   app.js, users may see the new flag exposed but no consuming code.
   Trivial regression — flag has no effect with no consumer — but worth
   a quick check in the SW config.
3. **Push notifications.** Server already triggers ULTRA pushes
   independently of the PWA. No client-side change needed for that
   path.

---

## 6. Why this isn't bundled with 2.A.1 (Unified Rules Registry)

Phase 2.A.1 unifies the **scoring logic** (one rule registry imported
by both server and client). Phase 2.A.2 makes the **PWA consume the
server's output**. They're independent:

- 2.A.2 ships first → PWA reads server signals. If 2.A.1 hasn't
  shipped yet, the two scoring engines may still disagree on edge
  cases; the tag-based source label (`📡SRC_SERVER` / `🖥️SRC_LOCAL`)
  surfaces which is in use.
- 2.A.1 ships later → the two engines converge. The source label
  becomes pure documentation; can be removed later.

Doing 2.A.2 first is the right ordering because it has higher UX value
(consistency across devices, server-side ULTRA matches in-app ULTRA)
and lower architectural risk.

---

## 7. Asks for Ziko

When ready, reply with three letters: e.g. **`A2 B2 C1`** (or any
combination from §3.1–§3.3). I open the PR within 30 minutes of the
reply and the work lands in 1.5-2 days.

If you want me to start ANY of the decisions on defaults (A2/B2/C1)
without explicit approval, say **`Approved defaults`**.

If you want to discuss any decision before committing, just call it
out — `Discuss A` or similar.
