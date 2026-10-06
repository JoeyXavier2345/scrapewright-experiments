// extension/lib/screen-state.js
//
// Spec §1 (environmental-failure resilience): the screen-state detector.
// Chrome stops producing compositor frames when the display is off or the
// OS session is locked — lazy-load sites then never mount content and hover
// popovers never appear. This module answers ONE question on demand:
// is the screen environment currently degraded (and how confident are we)?
//
// Two channels, same output shape {state, confidence, source}:
//   api        — chrome.idle.queryState ('locked' = OS lock, 'idle' =
//                display-off/no input; confidence 1, the extension API is
//                authoritative)
//   synthesis  — multi-signal fallback for unavailable/denied idle API,
//                calibrated on the Oct-4/5 journal: the 01:55 lock cluster
//                (focusedFalseDensity 0.9 + 5-failure cluster + 6x median
//                wall) classifies locked; the 15:28 user-present cluster
//                (timeouts with focus held) classifies active.
//                suspendCreditPresent means the MACHINE slept — the 148th
//                round already credits that back, so synthesis reports
//                active (not its business). The SW wires density + wall
//                from its TabActivation receipt window (dispatch failures
//                unknown there — see the lowered-bar note inside
//                synthesize); other hosts must inject the signals
//                themselves or the synthesis channel answers unknown.
//
// Pure/injectable: tests pass {idle, synthesis}; the browser passes
// chrome. IIFE-wrapped per RC30. Universality: generic web-extension
// mechanics only, no site tokens.

(function (global) {
  'use strict';

  function createScreenState(deps) {
    const d = deps || {};
    const idleApi = (d.idle && typeof d.idle.queryState === 'function') ? d.idle : null;
    const synthFn = (typeof d.synthesis === 'function') ? d.synthesis : null;

    // Signal synthesizer: consumes receipts the harness already produces.
    // Weights fixed by the journal calibration; the ambiguous middle stays
    // 'unknown' — a wrong lock verdict would park ops on a live screen.
    // Review #9 (SW live wiring): when the dispatch-failure counter is NOT a
    // wired signal (the SW feeds density + wall only), the calibrated
    // 4-point bar is unreachable (density caps at 2, wall adds 1) — lower
    // the locked bar to 3 for that mode and cap confidence at 0.75. The
    // fully-calibrated two-signal mode keeps its 0.8-confidence bar.
    function synthesize(signals) {
      const s = signals || {};
      if (s.suspendCreditPresent) {
        return { state: 'active', confidence: 1, source: 'synthesis',
          note: 'machine suspension was credited (148th round) — not a display-off window' };
      }
      let score = 0;
      if (s.focusedFalseDensity >= 0.8) score += 2;
      else if (s.focusedFalseDensity >= 0.5) score += 1;
      if ((s.consecutiveDispatchFailures || 0) >= 4) score += 2;
      else if ((s.consecutiveDispatchFailures || 0) >= 3) score += 1;
      if ((s.wallOverMedian || 0) >= 4) score += 1;
      if (score >= 4) return { state: 'locked', confidence: 0.8, source: 'synthesis' };
      const failuresWired = typeof s.consecutiveDispatchFailures === 'number';
      if (!failuresWired && score >= 3) {
        return { state: 'locked', confidence: 0.75, source: 'synthesis',
          note: 'density + wall signals only (dispatch-failure counter not wired) — lowered bar, capped confidence' };
      }
      if (score <= 1) return { state: 'active', confidence: 0.75, source: 'synthesis' };
      return { state: 'unknown', confidence: 0.3, source: 'synthesis' };
    }

    async function getScreenState() {
      if (idleApi) {
        try {
          const st = await new Promise((resolve, reject) => {
            try {
              // Dual-style call: chrome.idle is callback-based, but injected
              // test doubles are frequently async — a promise result ignores
              // the callback, so race both settlement paths.
              const maybe = idleApi.queryState(15, (v) => resolve(v));
              if (maybe && typeof maybe.then === 'function') {
                maybe.then(resolve, reject);
              }
            } catch (e) { reject(e); }
          });
          if (st === 'locked' || st === 'idle' || st === 'active') {
            return { state: st, confidence: 1, source: 'api' };
          }
          // 'unknown' from the API: fall through to synthesis once.
        } catch (e) { /* degrade to synthesis */ }
      }
      if (synthFn) {
        // Normalize the source label: injected synthesizers describe the
        // signals, not the channel they arrived on.
        const r = synthFn();
        if (r && typeof r === 'object' && !r.source) {
          return Object.assign({ source: 'synthesis' }, r);
        }
        return r;
      }
      return { state: 'unknown', confidence: 0, source: 'none' };
    }

    return { getScreenState, synthesize };
  }

  const api = { createScreenState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ScreenState = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self));
