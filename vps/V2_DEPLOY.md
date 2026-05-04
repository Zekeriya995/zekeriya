# NEXUS v2 Quality Engine — VPS Deployment

## Step 1 — Transfer `v2_patch.py` via nano

On the VPS:

```bash
nano /root/v2_patch.py
```

Paste the **entire contents** of `vps/v2_patch.py` from this repo, then `Ctrl+O`, `Enter`, `Ctrl+X`.

Verify:

```bash
cd /root && python3 v2_patch.py
```

Expected: 6 self-test lines, the STRONG case shows `tier=Diamond score=95`.

## Step 2 — Wire it into `nexus_notifier.py`

Edit the file:

```bash
nano /root/nexus_notifier.py
```

**A.** Near the other imports at the top, add:

```python
from v2_patch import v2_pipeline, v2_log, v2_should_send
```

**B.** Inside `_check_ultra(self, symbol, metrics)` — at the **very top** of the function body, before the existing logic:

```python
ok, reason, tier, score, bd = v2_pipeline(symbol, metrics)
v2_log(symbol, "ULTRA", ok, reason, tier, score, bd)
if not v2_should_send(ok):
    return None
```

**C.** Same three lines at the top of `_check_gem(self, symbol, metrics)`, but use `"GEM"` as the kind:

```python
ok, reason, tier, score, bd = v2_pipeline(symbol, metrics)
v2_log(symbol, "GEM", ok, reason, tier, score, bd)
if not v2_should_send(ok):
    return None
```

> **Metric keys** the pipeline reads from `metrics`:
> `vol_24h_usd`, `change_24h`, `btc_change_1h`, `vol_mult`,
> `mom_5m`, `mom_15m`, `smart_ratio`, `liquidity`, `context`.
> If your existing metrics use different names, map them inside the dict you pass, or rename the `m.get(...)` calls inside `score_v2()`.

## Step 3 — DRY_RUN test (30 min)

```bash
sudo systemctl stop nexus-notifier
timeout 1800 env NEXUS_DRY_RUN=1 PYTHONUNBUFFERED=1 \
    python3 /root/nexus_notifier.py 2>&1 | tee /tmp/v2_dry.log | grep '\[V2'
```

`NEXUS_DRY_RUN=1` makes `v2_should_send()` return `False` for every signal, so **no Telegram messages are sent**. You should see `[V2-DRY] PASS ...` and `[V2-DRY] DROP ...` lines instead.

After 30 minutes, review:

```bash
echo '--- pass/drop counts ---'
grep -c '\[V2-DRY\] PASS' /tmp/v2_dry.log
grep -c '\[V2-DRY\] DROP' /tmp/v2_dry.log
echo '--- drop reasons ---'
grep '\[V2-DRY\] DROP' /tmp/v2_dry.log | sed 's/.*reason=//; s/ .*//' | sort | uniq -c | sort -rn
echo '--- tiers among PASS ---'
grep '\[V2-DRY\] PASS' /tmp/v2_dry.log | sed 's/.*tier=//; s/ .*//' | sort | uniq -c | sort -rn
```

**Healthy targets:**
- 10–20 PASS over 30 min (≈ 20–40/day, before quiet-hours suppression)
- Most PASS are Silver, a few Gold, rare Diamond
- Top drop reasons: `tier_bronze`, `hard_vol_low`, `rate_limited`

If counts look right, proceed to Step 4. If too many or too few PASS, tune brackets in `score_v2()` or thresholds at the top of `v2_patch.py`.

## Step 4 — Go live

```bash
sudo systemctl start nexus-notifier
sudo systemctl status nexus-notifier --no-pager
journalctl -u nexus-notifier -f | grep '\[V2\]'
```

Confirm one real Telegram notification arrives within an hour, then leave it running.

## Rollback

If anything breaks, revert the 3-line additions in `_check_ultra` / `_check_gem`, remove the `from v2_patch import ...` line, and restart:

```bash
sudo systemctl restart nexus-notifier
```

`v2_patch.py` is otherwise inert — leaving the file in place causes no side effects.
