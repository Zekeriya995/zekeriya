/* NEXUS PRO — pure trade-monitor decision helper.

   Extracted from the inline block that lived in app.js's monitorTrades()
   loop. Given a trade, the current ticker price, the current BTC market
   change, and `now`, returns:

     {
       t1JustHit:        boolean   // first tick to cross target1
       newBreakevenStop: number?   // entry * 1.005 if t1JustHit, else null
       close:            string?   // null | 'TARGET_FULL' | 'TRAILING_STOP'
                                   //      | 'BREAKEVEN_STOP' | 'STOP_LOSS'
                                   //      | 'TIMEOUT' | 'MARKET_CRASH'
     }

   The caller (app.js:monitorTrades) is still responsible for the
   side-effects: applying t1JustHit / newBreakevenStop to the trade,
   firing the popup, and invoking closeTrade() with the chosen reason.

   THIS FILE IS A FAITHFUL REFACTOR OF THE EXISTING LOGIC. It
   intentionally preserves two known issues raised by the engineering
   audit, both of which are addressed in a separate fix PR alongside an
   updated test file:

     - AUDIT-F1  long-side TP/SL ordering: a single price observation
                 may credit `TARGET_FULL` even when the same candle
                 would have wicked through `STOP_LOSS` first. The fix
                 takes a per-candle high/low and assumes worst-case.
     - AUDIT-F5  long-only assumptions: `tr.target1`/`tr.target2` are
                 expected to be ABOVE entry, `tr.stop` BELOW. A SHORT
                 trade routed through this helper today closes
                 immediately on stop. The fix branches on `tr.type`. */

function monitorTradeDecision(tr, currentPrice, btcChangePct, now) {
  /* Exit 1: target1 reached for the first time → not a close, but the
     caller upgrades the trailing stop to breakeven. We still continue
     evaluating so that a single observation crossing both target1 and
     target2 also closes the trade — same as the original inline code. */
  var t1JustHit = !tr.t1Hit && currentPrice >= tr.target1;
  var newBreakevenStop = t1JustHit ? tr.entry * 1.005 : null;

  /* Subsequent checks see the upgraded state (mirrors the original
     where T1 mutated `tr` before the next `if`). */
  var t1Hit = tr.t1Hit || t1JustHit;
  var trailingStop = tr.trailingStop || newBreakevenStop;

  /* Exit 2: full target. */
  if (currentPrice >= tr.target2) {
    return { t1JustHit: t1JustHit, newBreakevenStop: newBreakevenStop, close: 'TARGET_FULL' };
  }

  /* Exit 3: trailing stop, only after T1 + 3 % gain on the books. */
  if (t1Hit && tr.maxGain > 3) {
    var trail = tr.maxGainPrice * 0.98;
    if (currentPrice <= trail) {
      return {
        t1JustHit: t1JustHit,
        newBreakevenStop: newBreakevenStop,
        close: 'TRAILING_STOP',
      };
    }
  }

  /* Exit 4: stop loss / breakeven stop. */
  var stopLevel = trailingStop || tr.stop;
  if (currentPrice <= stopLevel) {
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

  /* Exit 7: BTC market crash (-5 % from entry-time market state). */
  if (tr.marketAtEntry && btcChangePct - tr.marketAtEntry.btc < -5) {
    return { t1JustHit: t1JustHit, newBreakevenStop: newBreakevenStop, close: 'MARKET_CRASH' };
  }

  return { t1JustHit: t1JustHit, newBreakevenStop: newBreakevenStop, close: null };
}
