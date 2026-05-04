"""
NEXUS PRO v2 Quality Engine - Layers 1-5
Drop-in module: place at /root/v2_patch.py and import from nexus_notifier.py.

Integration in nexus_notifier.py (3 lines per check function):
    from v2_patch import v2_pipeline, v2_log

    # Inside _check_ultra(self, symbol, metrics):
    ok, reason, tier, score, bd = v2_pipeline(symbol, metrics)
    v2_log(symbol, "ULTRA", ok, reason, tier, score, bd)
    if not ok:
        return None
    # ... existing message-building code, but use `tier` and `score` from above ...

    # Same pattern inside _check_gem(...).
"""
import os
import time
from datetime import datetime, timezone, timedelta
from collections import defaultdict, deque

# ============================================================
# Layer 1: Hard Filters (instant rejection)
# ============================================================
HARD_MIN_VOL_24H_USD = 20_000_000
HARD_MAX_DROP_24H = -10.0
HARD_MAX_PUMP_24H = 30.0
HARD_MAX_BTC_DROP_1H = -3.0


def hard_filters(vol_24h_usd, change_24h, btc_change_1h):
    if vol_24h_usd < HARD_MIN_VOL_24H_USD:
        return False, "vol_low"
    if change_24h <= HARD_MAX_DROP_24H:
        return False, "dropping"
    if change_24h >= HARD_MAX_PUMP_24H:
        return False, "already_pumped"
    if btc_change_1h <= HARD_MAX_BTC_DROP_1H:
        return False, "btc_falling"
    return True, "pass"


# ============================================================
# Layer 2: Score Breakdown (0-100)
#   base = Volume(20) + Momentum(20) + SmartMoney(20)
#        + Liquidity(15) + Context(10)         = 85 max
#   bonus = convergence boost                   = up to +15
# ============================================================
_MAXES = {"volume": 20, "momentum": 20, "smart_money": 20,
          "liquidity": 15, "context": 10}


def _grade(v, brackets):
    """brackets sorted high-to-low: [(threshold, points), ...]"""
    for thr, pts in brackets:
        if v >= thr:
            return pts
    return 0


def score_v2(m):
    """m: metrics dict. Returns (total, breakdown_dict)."""
    bd = {
        "volume": _grade(m.get("vol_mult", 1.0),
                         [(10, 20), (5, 15), (3, 10), (2, 5)]),
        "momentum": _grade(min(m.get("mom_5m", 0.0), m.get("mom_15m", 0.0)),
                           [(2.0, 20), (1.0, 15), (0.5, 10), (0.2, 5)]),
        "smart_money": _grade(m.get("smart_ratio", 0.0),
                              [(0.70, 20), (0.55, 15), (0.40, 10), (0.25, 5)]),
        "liquidity": _grade(m.get("liquidity", 0.0),
                            [(0.90, 15), (0.75, 12), (0.60, 8), (0.40, 4)]),
        "context": _grade(m.get("context", 0.0),
                          [(0.80, 10), (0.60, 7), (0.40, 4)]),
    }
    base = sum(bd.values())
    strong = sum(1 for k, v in bd.items() if v >= _MAXES[k] * 0.75) / 5.0
    bonus = 15 if strong >= 1.0 else 10 if strong >= 0.8 else 5 if strong >= 0.6 else 0
    bd["bonus"] = bonus
    return base + bonus, bd


# ============================================================
# Layer 3: Tier Gate (Bronze rejected)
# ============================================================
def get_tier(score):
    if score >= 90:
        return "Diamond"
    if score >= 80:
        return "Gold"
    if score >= 70:
        return "Silver"
    return "Bronze"


# ============================================================
# Layer 4: Rate Limits (per tier, sliding 1h window)
# ============================================================
RATE_LIMITS = {"Silver": 5, "Gold": 3, "Diamond": 9999}
_RATE_BUCKETS = defaultdict(deque)


def rate_limit_ok(tier):
    now = time.time()
    bucket = _RATE_BUCKETS[tier]
    while bucket and bucket[0] < now - 3600:
        bucket.popleft()
    if len(bucket) >= RATE_LIMITS.get(tier, 0):
        return False
    bucket.append(now)
    return True


# ============================================================
# Layer 5: Quiet Hours (Mecca / UTC+3, 23:00-07:00 = Diamond only)
# ============================================================
def in_quiet_hours():
    mecca = datetime.now(timezone.utc) + timedelta(hours=3)
    h = mecca.hour
    return h >= 23 or h < 7


def quiet_ok(tier):
    return (not in_quiet_hours()) or tier == "Diamond"


# ============================================================
# Master pipeline + logger
# ============================================================
def v2_pipeline(symbol, metrics):
    """Run all 5 layers. Returns (passed, reason, tier, score, breakdown)."""
    ok, reason = hard_filters(metrics.get("vol_24h_usd", 0),
                              metrics.get("change_24h", 0),
                              metrics.get("btc_change_1h", 0))
    if not ok:
        return False, f"hard_{reason}", None, 0, {}
    score, bd = score_v2(metrics)
    tier = get_tier(score)
    if tier == "Bronze":
        return False, "tier_bronze", tier, score, bd
    if not quiet_ok(tier):
        return False, "quiet_hours", tier, score, bd
    if not rate_limit_ok(tier):
        return False, "rate_limited", tier, score, bd
    return True, "pass", tier, score, bd


def v2_log(symbol, kind, passed, reason, tier, score, bd):
    dry = os.getenv("NEXUS_DRY_RUN", "0") == "1"
    tag = "[V2-DRY]" if dry else "[V2]"
    mark = "PASS" if passed else "DROP"
    print(f"{tag} {mark} {kind} {symbol:<14} tier={tier} score={score} "
          f"reason={reason} bd={bd}", flush=True)


def v2_should_send(passed):
    """In DRY_RUN mode, always return False so notifier never sends."""
    if os.getenv("NEXUS_DRY_RUN", "0") == "1":
        return False
    return passed


# ============================================================
# Self-test
# ============================================================
if __name__ == "__main__":
    print("[V2] self-test starting", flush=True)
    cases = [
        ("STRONG", {"vol_24h_usd": 80_000_000, "change_24h": 6.0,
                    "btc_change_1h": 0.4, "vol_mult": 8.0,
                    "mom_5m": 2.1, "mom_15m": 3.2, "smart_ratio": 0.72,
                    "liquidity": 0.92, "context": 0.85}),
        ("MEDIUM", {"vol_24h_usd": 30_000_000, "change_24h": 3.0,
                    "btc_change_1h": 0.1, "vol_mult": 3.5,
                    "mom_5m": 1.1, "mom_15m": 1.5, "smart_ratio": 0.5,
                    "liquidity": 0.7, "context": 0.55}),
        ("WEAK", {"vol_24h_usd": 25_000_000, "change_24h": 1.0,
                  "btc_change_1h": 0.0, "vol_mult": 1.5,
                  "mom_5m": 0.3, "mom_15m": 0.4, "smart_ratio": 0.2,
                  "liquidity": 0.3, "context": 0.3}),
        ("LOW_VOL", {"vol_24h_usd": 5_000_000, "change_24h": 5.0,
                     "btc_change_1h": 0.0, "vol_mult": 5.0}),
        ("BTC_DROP", {"vol_24h_usd": 50_000_000, "change_24h": 5.0,
                      "btc_change_1h": -3.5, "vol_mult": 5.0}),
        ("PUMPED", {"vol_24h_usd": 50_000_000, "change_24h": 35.0,
                    "btc_change_1h": 0.0, "vol_mult": 5.0}),
    ]
    for name, m in cases:
        ok, reason, tier, score, bd = v2_pipeline(name, m)
        v2_log(name, "TEST", ok, reason, tier, score, bd)
    print(f"[V2] quiet_hours_now={in_quiet_hours()}", flush=True)
    print("[V2] self-test done", flush=True)
