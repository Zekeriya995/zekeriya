/* NEXUS PRO — visibility-aware interval registry.

   The browser keeps `setInterval` callbacks running even while the tab
   is in the background, draining battery and burning mobile data on a
   tab the user can't see. This module owns one document-level
   visibilitychange handler and a `bgInterval(fn, ms)` registration
   helper that cooperates with it:

     - Tab visible:   the interval runs at its declared cadence.
     - Tab hidden:    the timer is cleared and the callback is paused.
     - Tab returns:   the callback fires once immediately (so the UI
                      catches up after a long gap), then the interval
                      resumes.

   Stop-the-world is the right behaviour here because the app's
   scanners, dashboards, and validator have no business burning CPU
   for a user who can't see them — the data model catches up via the
   one-shot fire on resume.

   Public surface (browser globals, picked up by app.js + tests):
     - bgInterval(fn, ms)     register a paused-when-hidden interval
     - bgClearAll()           clear and forget every registered timer
     - bgIsVisible()          true if the tab is currently visible
     - _bgHandleVisibility()  test seam — invoke the visibility logic
                              without dispatching a real event */

'use strict';

var _bgSpecs = []; /* [{ id, fn, ms }]  — id is a small monotonic int */
var _bgNextId = 1;
var _bgPaused = false;

function bgIsVisible() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

function _bgArm(spec) {
  if (spec.handle) return;
  spec.handle = setInterval(spec.fn, spec.ms);
}

function _bgDisarm(spec) {
  if (!spec.handle) return;
  clearInterval(spec.handle);
  spec.handle = null;
}

function bgInterval(fn, ms) {
  if (typeof fn !== 'function' || !(ms > 0)) return 0;
  var spec = { id: _bgNextId++, fn: fn, ms: ms, handle: null };
  _bgSpecs.push(spec);
  if (!_bgPaused && bgIsVisible()) _bgArm(spec);
  return spec.id;
}

function bgClearAll() {
  for (var i = 0; i < _bgSpecs.length; i++) _bgDisarm(_bgSpecs[i]);
  _bgSpecs.length = 0;
}

function _bgHandleVisibility() {
  if (!bgIsVisible()) {
    _bgPaused = true;
    for (var i = 0; i < _bgSpecs.length; i++) _bgDisarm(_bgSpecs[i]);
    return;
  }
  if (!_bgPaused) return;
  _bgPaused = false;
  for (var j = 0; j < _bgSpecs.length; j++) {
    var spec = _bgSpecs[j];
    /* Catch-up tick: fire once immediately so the UI doesn't show a
       stale snapshot for up to `ms` after returning. Errors must not
       break the resume of sibling timers. */
    try {
      spec.fn();
    } catch (e) {
      /* swallow */
    }
    _bgArm(spec);
  }
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', _bgHandleVisibility);
}
