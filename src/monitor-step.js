/* NEXUS PRO — pure trade-monitor decision helper.

   Given a trade, the current observation, the current BTC market
   change, and `now`, returns:

     {
       t1JustHit:        boolean   // first tick to cross target1
       newBreakevenStop: number?   // entry-side breakeven if t1JustHit
       close:            string?   // null | 'TARGET_FULL' | 'TRAILING_STOP'
                                   //      | 'BREAKEVEN_STOP' | 'STOP_LOSS'
                                   //      | 'TIMEOUT' | 'MARKET_CRASH'
     }

   The current observation is `{ price, high, low }`. `high` and `low`
   are the candle bounds since the previous tick (for tighter exit
   accuracy); they default to the current price if the caller only has
   a single point.

   Side handling: a LONG trade has target1/target2 ABOVE entry and
   stop BELOW. A SHORT trade has them inverted. The helper now reads
   `tr.type` ('LONG' or 'SHORT', default 'LONG') and inverts every
   comparator + breakeven offset. AUDIT-F5.

   Worst-case execution: when a single candle's `low` and `high` would
   have hit BOTH the stop AND the target on a LONG (or stop AND target
   on a SHORT), STOP_LOSS wins. This protects the user from a phantom
   "+target" credit on a candle that wicked through the stop first.
   AUDIT-F1.

   The caller (app.js:monitorTrades) is still responsible for the
   side-effects: applying t1JustHit / newBreakevenStop to the trade,
   firing the popup, and invoking closeTrade() with the chosen reason. */

function monitorTradeDecision(tr, observation, btcChangePct, now) {
  /* Backwards-compatible: callers passing a bare `currentPrice` still
     work — coerce to the {price, high, low} shape with degenerate
     bounds. */
  var price, candleHigh, candleLow;
  if (observation && typeof observation === 'object') {
    price = +observation.price;
    candleHigh = observation.high != null ? +observation.high : price;
    candleLow = observation.low != null ? +observation.low : price;
  } else {
    price = +observation;
    candleHigh = price;
    candleLow = price;
  }

  var isShort = tr.type === 'SHORT';

  /* Direction-aware predicates. For a LONG: target1/2 above, stop
     below. For a SHORT: target1/2 below, stop above. */
  function targetReached(level) {
    return isShort ? candleLow <= level : candleHigh >= level;
  }
  function stopBreached(level) {
    return isShort ? candleHigh >= level : candleLow <= level;
  }
  /* Worst-direction price within the candle. For a LONG that's the
     low (price retraced); for a SHORT that's the high (price
     bounced against us). Used by the trailing-stop check. */
  function adverseExtreme() {
    return isShort ? candleHigh : candleLow;
  }

  /* Worst-case ordering (AUDIT-F1) — checked FIRST against the
     stop that was in place BEFORE this candle (not the new breakeven
     a same-candle T1 hit would set). If a single bar's high reached
     target2 AND its low pierced the original stop, we assume the
     stop fired first and the trade closes as a loss. T1 is NOT
     credited because, under that pessimistic ordering, it never
     actually held. */
  var preCandleStop = tr.trailingStop || tr.stop;
  var bothHit = targetReached(tr.target2) && stopBreached(preCandleStop);
  if (bothHit) {
    return {
      t1JustHit: false,
      newBreakevenStop: null,
      close: tr.trailingStop ? 'BREAKEVEN_STOP' : 'STOP_LOSS',
    };
  }

  /* Exit 1: target1 reached for the first time → not a close, but the
     caller upgrades the trailing stop to breakeven (slightly inside
     entry on the favourable side). */
  var t1JustHit = !tr.t1Hit && targetReached(tr.target1);
  var newBreakevenStop = t1JustHit ? (isShort ? tr.entry * 0.995 : tr.entry * 1.005) : null;

  var t1Hit = tr.t1Hit || t1JustHit;
  var trailingStop = tr.trailingStop || newBreakevenStop;

  /* Exit 2: full target. */
  if (targetReached(tr.target2)) {
    return { t1JustHit: t1JustHit, newBreakevenStop: newBreakevenStop, close: 'TARGET_FULL' };
  }

  /* Exit 3: trailing stop, only after T1 + 3 % gain on the books. */
  if (t1Hit && tr.maxGain > 3) {
    var trail = isShort ? tr.maxGainPrice * 1.02 : tr.maxGainPrice * 0.98;
    var trailHit = isShort ? adverseExtreme() >= trail : adverseExtreme() <= trail;
    if (trailHit) {
      return {
        t1JustHit: t1JustHit,
        newBreakevenStop: newBreakevenStop,
        close: 'TRAILING_STOP',
      };
    }
  }

  /* Exit 4: stop loss / breakeven stop. Uses the post-candle stop
     level (which now includes any breakeven set by a same-candle T1
     hit). */
  var stopLevel = trailingStop || tr.stop;
  if (stopBreached(stopLevel)) {
    return {
      t1JustHit: t1JustHit,
      newBreakevenStop: newBreakevenStop,
      close: trailingStop ? 'BREAKEVEN_STOP' : 'STOP_LOSS',
    };
  }

  /* Exit 6: 24 h timeout. */
  if (now - tr.entryTime > 24 * 3600 * 1000) {
    return { t1JustHit: t1JustHit, newBreakevenStop: newBreakevenStop, close: 'TIMEOUT' };
  }

  /* Exit 7: BTC market crash (-5 % from entry-time market state).
     Direction-aware: a SHORT actually benefits from a BTC crash, so
     this exit only fires for LONGs. */
  if (!isShort && tr.marketAtEntry && btcChangePct - tr.marketAtEntry.btc < -5) {
    return { t1JustHit: t1JustHit, newBreakevenStop: newBreakevenStop, close: 'MARKET_CRASH' };
  }

  return { t1JustHit: t1JustHit, newBreakevenStop: newBreakevenStop, close: null };
}
