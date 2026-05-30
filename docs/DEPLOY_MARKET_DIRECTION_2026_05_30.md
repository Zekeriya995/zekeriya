# NEXUS PRO — Deploy & Verify: Market Direction epic (2026-05-30)

Step-by-step deploy + verification of the Market Direction / auto-summary
work merged this session. Comprehensive: every command, every check, every
rollback — execute top-to-bottom on the VPS without referring back to chat.

**What landed (all in `main`, all additive — no behaviour of the live chart
changed yet; these are new server endpoints + a new PWA panel):**

| PR   | What                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------ |
| #149 | Market-movement auto-summary — engine + server monitor + panel + `/api/market-summary`           |
| #150 | Data layer Phase 1 — multi-venue funding/OI + `/api/market-direction`                            |
| #151 | `scoreDirection` core (de-biased ts + normalized sc) — module only, not yet wired into the chart |
| #152 | Relative-band iceberg detector (now works for BTC/ETH)                                           |
| #153 | Direction accuracy loop, wired into the summary                                                  |

> **Not in this deploy** (deliberately): wiring `scoreDirection` into the
> live chart and the PWA consuming `/api/market-direction`. Those change the
> on-screen reading and are the NEXT step — verify this deploy first.

---

## 0. Pre-deploy sanity

```bash
ssh root@212.47.64.8
cd /root/zekeriya
sudo -u nexus pm2 status      # confirm nexus-proxy online before changes
```

Expect `nexus-proxy … online`. If not, STOP and investigate first.

---

## 1. Sync git to the merged `main`

```bash
sudo chown -R nexus:nexus /root/zekeriya/.git        # known ownership-drift guard
sudo -u nexus git -C /root/zekeriya fetch origin main
sudo -u nexus git -C /root/zekeriya log --oneline HEAD..origin/main
```

The `log` should list this session's squash commits (market-summary, data
layer, scoreDirection, iceberg, accuracy). If it looks right, pull:

```bash
sudo -u nexus git -C /root/zekeriya pull origin main   # expect a fast-forward
```

---

## 2. Dependencies (no new runtime deps, but safe)

```bash
sudo -u nexus npm --prefix /root/zekeriya ci
# optional but reassuring — mirrors CI (lint + format + 927 tests):
sudo -u nexus npm --prefix /root/zekeriya run check
```

`npm run check` must end green. If it fails, **do not reload** — rollback (§6).

---

## 3. Reload the server

```bash
sudo -u nexus pm2 startOrReload /root/zekeriya/ecosystem.config.cjs
sudo -u nexus pm2 status        # nexus-proxy should be 'online', restart count +1
```

---

## 4. Verify the server (new endpoints + monitor)

PORT defaults to 3000. Give the boot timers a moment (the monitor seeds its
first sample ~8s after start; Bybit funding ~6s).

```bash
# health first
curl -s localhost:3000/api/health | head -c 200 ; echo

# NEW — market direction snapshot (computed on demand from caches)
curl -s localhost:3000/api/market-direction | head -c 600 ; echo
```

**Expect** for `/api/market-direction` → `{ "BTC": { … }, "ETH": { … } }` where each has:

- `signals.funding.perVenue` with **`binance`** immediately and **`bybit`** within ~5 min (the Bybit fetcher runs on a 5-min timer + a 6s seed),
- `signals.funding.agreement` and `confidence` in 0..1,
- `health.completeness` (e.g. `0.7`) with a `degraded` list of any down sources.

```bash
# NEW — the auto-summary (AR + EN per symbol)
curl -s localhost:3000/api/market-summary | head -c 600 ; echo
```

**Expect**: initially `{}` or summaries with `"enough": false` — the monitor
needs several samples over time before the narrative fills in (and ≥5 for the
accuracy %). This is correct, not a failure. Re-check after a few hours.

```bash
# logs — the new timers should be active, with NO errors
sudo -u nexus pm2 logs nexus-proxy --lines 80 --nostream | grep -iE "MKT-SUMMARY|BYBIT|market|Error" | tail -30
```

**Expect**: no `[MKT-SUMMARY] tick failed` lines. A `FR-BYBIT` fetch that
fails just means Bybit is unreachable — the snapshot degrades to Binance-only
and `completeness` reflects it (by design).

```bash
# confirm the monitor is persisting its time-series
ls -la /root/zekeriya/data/market-summary.json     # appears after the first tick
```

---

## 5. Verify the PWA (browser)

Open `https://shamcyrpto.com`, go to **اتجاه السوق → BTC**, scroll to the end:

- A new **«📜 ملخّص حركة السوق (آلي)»** section appears just before the
  signature. First load shows "يتراكم السجلّ…"; after a few refreshes (or
  once the server has history) it shows the narrative, with a source line
  ("مراقبة الخادم المستمرة" vs "محلّي").
- Repeat on the **ETH** tab.

(The iceberg fix #152 is internal — no visible element — but it now
contributes to the existing signals for BTC/ETH instead of being dead.)

---

## 6. Rollback

If anything looks wrong:

```bash
# back to the commit you were on before §1 (capture it first with `git rev-parse HEAD`)
sudo -u nexus git -C /root/zekeriya reset --hard <PREV_SHA>
sudo -u nexus pm2 reload nexus-proxy
```

All new endpoints are additive, so a rollback simply removes them — nothing
else regresses. `data/market-summary.json` is a runtime file; leaving it is
harmless.

---

## 7. After verifying

Once `/api/market-direction`, `/api/market-summary`, and the panel are
confirmed live and healthy, the **next** PR (live-chart wiring of
`scoreDirection` + scenarios/`bearP`, and the PWA consuming
`/api/market-direction`) can be built and validated against this running
deploy.
