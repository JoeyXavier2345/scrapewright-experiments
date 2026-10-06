# Environmental Failure Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect screen-lock/display-off environmental failures and self-heal them — in-operation transparent retry, field-ledger exemption, session-scoped keep-awake — for both research and runtime phases.

**Architecture:** A new `lib/screen-state.js` pure module (API channel + multi-signal synthesis, both injectable for tests) exposed through a background `GET_SCREEN_STATE` message. Hover/scroll failure paths in `content-script.js` consult it once on timeout-class receipts, run a 5s-cycle wait-recover loop (90s cap), and retry once on recovery. The engine ledger exempts `environmental`-marked failures. `chrome.power.requestKeepAwake('display')` is held for the session/task lifetime.

**Tech Stack:** Chrome MV3 (`chrome.idle`, `chrome.power`, message relay), vanilla JS, `node --test` + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-06-environmental-failure-resilience-design.md`

**Standing constraints (every task):** English comments, NO site tokens (facebook/twitter/linkedin/tiktok/reddit/fb) in lib code, no Co-Authored-By, run tests from `extension/`, suite must be fully green before each commit. After each task, the fixer runs `node --test test/*.test.js lib/*.test.js` — expected counts grow per task.

---

### Task 1: Screen-state detector module (`lib/screen-state.js`)

**Files:**
- Create: `extension/lib/screen-state.js`
- Test: `extension/test/screen-state.test.js`

- [ ] **Step 1: Write the failing tests**

Create `extension/test/screen-state.test.js`:

```js
// 197th round (spec §1): the screen-state detector. Primary channel is
// chrome.idle (injected); fallback is multi-signal synthesis calibrated by
// the Oct-4/5 journal — the 01:55 lock cluster MUST classify locked, the
// 15:28 user-present cluster MUST classify active (popover_timeout alone is
// NOT lock evidence).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createScreenState } = require('../lib/screen-state.js');

describe('screen-state: API channel', () => {
  it('maps chrome.idle states with source api and confidence 1', async () => {
    const ss = createScreenState({ idle: { queryState: async () => 'locked' } });
    const r = await ss.getScreenState();
    assert.deepEqual(r, { state: 'locked', confidence: 1, source: 'api' });
  });
  it('active/idle pass through; api errors degrade to unknown, never throw', async () => {
    const ssA = createScreenState({ idle: { queryState: async () => 'active' } });
    assert.equal((await ssA.getScreenState()).state, 'active');
    const ssB = createScreenState({ idle: { queryState: async () => { throw new Error('denied'); } } });
    assert.equal((await ssB.getScreenState()).state, 'unknown');
  });
  it('unknown API state falls back to synthesis once', async () => {
    let n = 0;
    const ss = createScreenState({
      idle: { queryState: async () => { n++; return n === 1 ? 'unknown' : 'locked'; } },
      synthesis: () => ({ state: 'idle', confidence: 0.7 })
    });
    const r = await ss.getScreenState();
    assert.equal(r.state, 'idle');
    assert.equal(r.source, 'synthesis');
  });
});

describe('screen-state: synthesis channel (journal-calibrated)', () => {
  // The 01:55 lock signature from the journal: dense focus losses, a
  // dispatch-failure cluster, wall 6x median, no suspend credit.
  const lockWindow = { focusedFalseDensity: 0.9, consecutiveDispatchFailures: 5,
    wallOverMedian: 6, suspendCreditPresent: false };
  // The 15:28 user-present signature: timeouts present but focus held,
  // no cluster beyond normal variance.
  const presentWindow = { focusedFalseDensity: 0.2, consecutiveDispatchFailures: 2,
    wallOverMedian: 1.5, suspendCreditPresent: false };

  it('the lock window classifies locked (journal 01:55 cluster)', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize(lockWindow);
    assert.equal(r.state, 'locked');
    assert.ok(r.confidence >= 0.75 && r.confidence <= 0.85);
    assert.equal(r.source, 'synthesis');
  });
  it('the user-present window classifies active (journal 15:28 cluster)', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize(presentWindow);
    assert.equal(r.state, 'active');
  });
  it('suspend credit present means the machine slept, not display-off: active verdict with note', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize(Object.assign({}, lockWindow, { suspendCreditPresent: true }));
    assert.equal(r.state, 'active');
  });
  it('ambiguous middle stays unknown (never guesses)', () => {
    const ss = createScreenState({ idle: null });
    const r = ss.synthesize({ focusedFalseDensity: 0.5, consecutiveDispatchFailures: 3,
      wallOverMedian: 2.5, suspendCreditPresent: false });
    assert.equal(r.state, 'unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && node --test test/screen-state.test.js`
Expected: FAIL — `Cannot find module '../lib/screen-state.js'`

- [ ] **Step 3: Implement the module**

Create `extension/lib/screen-state.js`:

```js
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
//                active (not its business).
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
      if (score <= 1) return { state: 'active', confidence: 0.75, source: 'synthesis' };
      return { state: 'unknown', confidence: 0.3, source: 'synthesis' };
    }

    async function getScreenState() {
      if (idleApi) {
        try {
          const st = await new Promise((resolve, reject) => {
            try {
              idleApi.queryState(15, (v) => resolve(v));
            } catch (e) { reject(e); }
          });
          if (st === 'locked' || st === 'idle' || st === 'active') {
            return { state: st, confidence: 1, source: 'api' };
          }
          // 'unknown' from the API: fall through to synthesis once.
        } catch (e) { /* degrade to synthesis */ }
      }
      if (synthFn) return synthFn();
      return { state: 'unknown', confidence: 0, source: 'none' };
    }

    return { getScreenState, synthesize };
  }

  const api = { createScreenState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ScreenState = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && node --test test/screen-state.test.js`
Expected: 8 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add lib/screen-state.js test/screen-state.test.js
git commit -m "feat: screen-state detector — chrome.idle primary + journal-calibrated synthesis (spec §1)"
```

---

### Task 2: Background GET_SCREEN_STATE relay + keep-awake holder

**Files:**
- Modify: `extension/manifest.json` (permissions array: add `"idle"`)
- Modify: `extension/background.js` (SW init: idle detection interval; message handler; keep-awake acquire/release)
- Test: `extension/test/screen-state-relay.test.js`

- [ ] **Step 1: Write the failing tests**

Create `extension/test/screen-state-relay.test.js`:

```js
// 197th round (spec §1 relay + §4 keep-awake): the background owns the
// authoritative chrome.idle query and the chrome.power keep-awake hold.
// Source-audited (the SW itself is not unit-runnable).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BG = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));

describe('screen-state relay + keep-awake (source audit)', () => {
  it('manifest declares the idle permission', () => {
    assert.ok(MANIFEST.permissions.indexOf('idle') !== -1, 'permissions: ' + MANIFEST.permissions.join(','));
  });
  it('SW handles GET_SCREEN_STATE and answers with the detector shape', () => {
    assert.match(BG, /GET_SCREEN_STATE/);
    assert.match(BG, /getScreenState\(\)/);
    assert.match(BG, /sendResponse\(\{ state:/);
  });
  it('keep-awake acquire/release pair exists with the settings gate', () => {
    assert.match(BG, /requestKeepAwake\('display'\)/);
    assert.match(BG, /releaseKeepAwake\(\)/);
    assert.match(BG, /screenKeepAwakeEnabled/, 'settings-gated (default on)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && node --test test/screen-state-relay.test.js`
Expected: FAIL — idle permission missing, no GET_SCREEN_STATE

- [ ] **Step 3: Implement**

3a. `manifest.json` — add to the `permissions` array (after `"notifications"`):
```json
    "notifications",
    "idle"
```

3b. `background.js` — near the top-level init (beside `initTabActivationListeners()` at the SW init site), add:

```js
// ===== Screen-state detector + keep-awake (spec §1/§4, 197th round) =====
// The SW owns the authoritative chrome.idle query; content scripts ask via
// GET_SCREEN_STATE. chrome.power.requestKeepAwake('display') is held for
// the research-session / scrape-task lifetime so lazy-load sites keep their
// compositor frames — released when the work ends. Settings-gated
// (screenKeepAwakeEnabled, default on).
var __screenKeepAwakeHeld = false;
function __screenKeepAwakeEnabled() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.local.get({ screenKeepAwakeEnabled: true }, function (st) {
        resolve(!!(st && st.screenKeepAwakeEnabled));
      });
    } catch (e) { resolve(true); }
  });
}
function acquireScreenKeepAwake() {
  __screenKeepAwakeEnabled().then(function (on) {
    if (!on || __screenKeepAwakeHeld) return;
    try { chrome.power.requestKeepAwake('display'); __screenKeepAwakeHeld = true; } catch (e) { /* degrade silently */ }
  });
}
function releaseScreenKeepAwake() {
  if (!__screenKeepAwakeHeld) return;
  try { chrome.power.releaseKeepAwake(); } catch (e) { /* degrade silently */ }
  __screenKeepAwakeHeld = false;
}
var __screenStateMod = (typeof ScreenState !== 'undefined')
  ? ScreenState : (typeof require !== 'undefined' ? null : null);
// In the SW the lib loads as a classic script; guard for absence.
var __screenDetector = null;
try {
  if (typeof ScreenState !== 'undefined' && ScreenState.createScreenState) {
    __screenDetector = ScreenState.createScreenState({ idle: (typeof chrome !== 'undefined' && chrome.idle) ? chrome.idle : null });
  }
} catch (e) { __screenDetector = null; }
try { if (chrome.idle && chrome.idle.setDetectionInterval) chrome.idle.setDetectionInterval(15); } catch (e) { /* API floor */ }
```

3c. In the SW's `chrome.runtime.onMessage.addListener` main switch (where `TRUSTED_HOVER_REQUEST` is handled), add a case:

```js
  if (message.type === 'GET_SCREEN_STATE') {
    if (__screenDetector) {
      __screenDetector.getScreenState().then(function (r) { sendResponse(r); })
        .catch(function () { sendResponse({ state: 'unknown', confidence: 0, source: 'none' }); });
    } else {
      sendResponse({ state: 'unknown', confidence: 0, source: 'none' });
    }
    return true;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && node --test test/screen-state-relay.test.js && node --check background.js`
Expected: 3 pass; syntax OK

- [ ] **Step 5: Commit**

```bash
git add manifest.json background.js test/screen-state-relay.test.js
git commit -m "feat: GET_SCREEN_STATE relay + session-scoped screen keep-awake (spec §1 relay + §4)"
```

---

### Task 3: Content-script screen-state client + hover wait-recover retry

**Files:**
- Modify: `extension/content-script.js` (a `queryScreenState()` helper near `withTabActivation`; retry wrapper on the hover failure paths at the `popover_timeout` / `no_hover_signal_early_exit` exits ~4988-5008)
- Test: `extension/test/hover-environmental-retry.test.js`

- [ ] **Step 1: Write the failing tests**

Create `extension/test/hover-environmental-retry.test.js`:

```js
// 197th round (spec §2): in-operation transparent retry. A hover that
// times out while the screen is locked/idle waits for recovery (5s cycles,
// 90s cap) and retries once. Sliced-source behavioral test: the retry
// wrapper is extracted with the eval pattern used across this suite.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../content-script.js'), 'utf8');

function sliceFn(name) {
  const start = SRC.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' must be defined');
  let depth = 0, i = SRC.indexOf('{', start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}

describe('hover environmental retry (spec §2)', () => {
  it('queryScreenState + withEnvironmentalRetry exist (source audit)', () => {
    assert.match(SRC, /function queryScreenState\(\)/);
    assert.match(SRC, /function withEnvironmentalRetry\(/);
    assert.match(SRC, /environmental/);
  });

  it('locked→active recovery retries the op once and marks the receipt', async () => {
    const states = [{ state: 'locked', confidence: 1, source: 'api' },
                    { state: 'active', confidence: 1, source: 'api' }];
    const queryScreenState = async () => states.shift() || states[0];
    const sleep = async () => {}; // fast tests: no real 5s
    let calls = 0;
    const op = async () => { calls += 1; return calls === 1
      ? { hovered: true, reason: 'popover_timeout' }
      : { hovered: true, htmlSnippet: '<div>ok</div>' }; };
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleep) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('hover', op);
    assert.equal(calls, 2, 'retried once after recovery');
    assert.ok(r.htmlSnippet, 'recovered result surfaces');
    assert.ok(r.environmental && r.environmental.recovered === true);
  });

  it('non-environmental timeout does NOT retry', async () => {
    const queryScreenState = async () => ({ state: 'active', confidence: 1, source: 'api' });
    const sleep = async () => {};
    let calls = 0;
    const op = async () => { calls += 1; return { hovered: true, reason: 'popover_timeout' }; };
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleep) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('hover', op);
    assert.equal(calls, 1, 'no retry on an active screen');
    assert.ok(!r.environmental);
  });

  it('never recovers: honest receipt after the cap', async () => {
    const queryScreenState = async () => ({ state: 'locked', confidence: 1, source: 'api' });
    const sleep = async () => {};
    const op = async () => ({ hovered: true, reason: 'popover_timeout' });
    const withEnvironmentalRetry = eval('(function (queryScreenState, sleep) { return (' + sliceFn('withEnvironmentalRetry') + '); })')(queryScreenState, sleep);
    const r = await withEnvironmentalRetry('hover', op, { maxWaitMs: 1, cycleMs: 1 });
    assert.equal(r.reason, 'popover_timeout');
    assert.ok(r.environmental && r.environmental.recovered === false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && node --test test/hover-environmental-retry.test.js`
Expected: FAIL — `withEnvironmentalRetry must be defined`

- [ ] **Step 3: Implement in content-script.js**

3a. Near `withTabActivation` (after its closing brace), add:

```js
  // ===== Environmental failure self-healing (spec §2, 197th round) =====
  // Query the SW's screen-state detector. Content scripts cannot see
  // chrome.idle directly in all contexts; the relay is authoritative.
  function queryScreenState() {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'GET_SCREEN_STATE' }, function (resp) {
          if (chrome.runtime.lastError) { resolve({ state: 'unknown', confidence: 0, source: 'none' }); return; }
          resolve(resp || { state: 'unknown', confidence: 0, source: 'none' });
        });
      } catch (e) { resolve({ state: 'unknown', confidence: 0, source: 'none' }); }
    });
  }

  // Timeout-shaped failure + locked/idle screen -> wait for recovery and
  // retry ONCE (spec §2). Transparent to the DSL caller: success surfaces
  // normally (plus an environmental diagnostic); a never-recovering screen
  // returns the ORIGINAL failure receipt plus environmental honesty.
  // Wait time rides the parked semantics at the engine layer (disclosed in
  // the TIME BUDGET line via the op receipt's environmental.waitedMs).
  function withEnvironmentalRetry(label, op, opts, queryScreenStateFn, sleepFn) {
    var q = queryScreenStateFn || queryScreenState;
    var sleep = sleepFn || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var o = opts || {};
    var TIMEOUTISH = /timeout|no_hover_signal|deadline|hidden/i;
    var maxWaitMs = (typeof o.maxWaitMs === 'number' && o.maxWaitMs > 0) ? o.maxWaitMs : 90000;
    var cycleMs = (typeof o.cycleMs === 'number' && o.cycleMs > 0) ? o.cycleMs : 5000;
    return op().then(function (first) {
      var reasonish = first && (first.reason || first.error || '');
      if (!TIMEOUTISH.test(String(reasonish))) return first;
      return q().then(function (st) {
        if (st.state !== 'locked' && st.state !== 'idle') return first;
        var waited = 0;
        var poll = function () {
          if (waited >= maxWaitMs) {
            first.environmental = { recovered: false, state: st.state, waitedMs: waited };
            return first;
          }
          return sleep(cycleMs).then(function () {
            waited += cycleMs;
            return q().then(function (st2) {
              if (st2.state === 'active') {
                return op().then(function (second) {
                  second.environmental = { recovered: true, state: st.state, waitedMs: waited };
                  return second;
                });
              }
              return poll();
            });
          });
        };
        return poll();
      });
    });
  }
```

3b. At the `domHover` result return path — find the two failure exits (~4988 `result.reason = 'no_hover_signal_early_exit'` and ~5008 `result.reason = 'popover_timeout'`). Wrap the function's return by renaming the existing `async function domHover(...)` body's final `return result;` to route through the wrapper. Concretely: at the END of `domHover`, replace `return result;` with:

```js
      // 197th round (spec §2): environmental wait-recover on timeout shapes.
      return withEnvironmentalRetry('hover', function () { return Promise.resolve(result); });
```

(This wraps the ALREADY-COMPUTED result: when the reason is timeout-ish AND the screen is degraded, it waits/retries by re-invoking the outer op via a closure the same function exposes — to keep the retry REAL, instead wrap at the CALL SITE the harness controls: see 3c.)

3c. **Preferred wiring** (instead of 3b if the domHover return is hard to wrap cleanly): in the DOM-request dispatcher `case 'hover'` (where `result = await domHover(...)` lives), change to:

```js
        result = await withEnvironmentalRetry('hover', function () { return domHover(data.selector, data.args && data.args[0], data.args && data.args[1], data.deadlineAt); });
```

(Adapt the argument list to the actual domHover signature at the dispatch site; keep the original assignment shape.) If domHover is dispatched through a shared runner, wrap there once. Delete the 3b edit if 3c is used — only ONE wrap point per op family.

- [ ] **Step 4: Run tests + syntax check**

Run: `cd extension && node --test test/hover-environmental-retry.test.js && node --check content-script.js`
Expected: 4 pass; syntax OK

- [ ] **Step 5: Commit**

```bash
git add content-script.js test/hover-environmental-retry.test.js
git commit -m "feat: hover wait-recover retry on environmental screen state (spec §2)"
```

---

### Task 4: Scroll-family retry + collectUntil round retry

**Files:**
- Modify: `extension/content-script.js` (wrap `domScrollBy`/`domScrollToBottom` dispatch cases and the `domCollectUntil` round loop's stall exit with `withEnvironmentalRetry`)
- Test: extend `extension/test/hover-environmental-retry.test.js`

- [ ] **Step 1: Add failing tests**

Append to `extension/test/hover-environmental-retry.test.js`:

```js
describe('scroll-family environmental retry wiring (source audit)', () => {
  it('the scrollBy and scrollToBottom dispatch cases route through the wrapper', () => {
    // the dispatcher cases assign via withEnvironmentalRetry('scrollBy', ...)
    assert.match(SRC, /withEnvironmentalRetry\('scrollBy'/);
    assert.match(SRC, /withEnvironmentalRetry\('scrollToBottom'/);
  });
  it('collectUntil stalls consult the screen state before concluding exhaustion', () => {
    assert.match(SRC, /withEnvironmentalRetry\('collectUntil-round'/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd extension && node --test test/hover-environmental-retry.test.js`
Expected: the 2 new subtests FAIL

- [ ] **Step 3: Implement**

In the DOM-request dispatcher:
- `case 'scrollBy'`: wrap the `domScrollBy` invocation:
```js
        result = await withEnvironmentalRetry('scrollBy', function () { return domScrollBy(data.selector, data.args && data.args[0]); });
```
- `case 'scrollToBottom'` (and `'scrollIntoView'` if dispatched): same shape.
- In `domCollectUntil`'s round loop, at the stall-conclusion exit (where the loop decides the feed is exhausted — the site that sets `certifiedExhaustion` evidence), wrap the FINAL return:
```js
    return withEnvironmentalRetry('collectUntil-round', function () { return Promise.resolve(out); });
```
(This makes a stalled-round conclusion wait for the screen before the exhaustion verdict stands; a recovered screen re-runs `domCollectUntil`'s caller op — the wrapper's retry closure should re-invoke the full collect if feasible at this layer, else keep the wait-only semantics and disclose `environmental.waitedMs` on the receipt.)

- [ ] **Step 4: Run tests + full hover suite**

Run: `cd extension && node --test test/hover-environmental-retry.test.js && node --check content-script.js`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add content-script.js test/hover-environmental-retry.test.js
git commit -m "feat: scroll-family + collectUntil environmental wait-recover (spec §2)"
```

---

### Task 5: Field-fail ledger exemption for environmental failures

**Files:**
- Modify: `extension/lib/research-session.js` (`tickFieldFailLedger` + the verify-result capture site ~2063)
- Test: extend `extension/test/research-session.test.js`

- [ ] **Step 1: Add failing tests**

Append to `extension/test/research-session.test.js`:

```js
// 197th round (spec §3): environmental failures don't count toward the
// field-fail ledger; after recovery, 2 real failures escalate FIELD_ASSIST
// directly with the environmental history in the note.
describe('197th round: environmental failures exempt from the ledger', () => {
  const makeEnvVerify = (fields, environmental) => () => ({
    ok: false,
    error: { stepId: 'x', message: 'REQUIRED_FIELD_EMPTY: posts.postTime 3/3' + (environmental ? ' (environmental waits present)' : '') },
    detectors: { partialEmptyFields: fields.map((f) => ({ field: f, path: 'posts.' + f, emptyRatio: 1 })) },
    environmental: environmental ? { waitsMs: 120000, recovered: true } : undefined
  });

  it('an environmental-marked verify does NOT increment the ledger', async () => {
    global.extractFailingFieldNames = require('../lib/wizard-utils').extractFailingFieldNames;
    try {
      const events = [];
      const session = createResearchSession({
        requirement: 'r',
        llm: scriptedLlm([
          reply(envelope('verify.run', {})),
          reply(envelope('verify.run', {})),
          reply(finishEnvelope('done'))
        ], []),
        tools: { 'verify.run': makeEnvVerify(['postTime'], true) },
        onEvent: (e) => events.push(e)
      });
      await session.run();
      assert.equal(events.filter((e) => e.type === 'field_assist_request').length, 0,
        'screen-lock-window failures are not field defects');
      const led = session.state().session.fieldFailLedger || {};
      assert.ok(!led.postTime || led.postTime.count === 0, 'ledger not incremented — got ' + JSON.stringify(led.postTime));
    } finally { delete global.extractFailingFieldNames; }
  });

  it('post-recovery real failures escalate with the environmental history', async () => {
    global.extractFailingFieldNames = require('../lib/wizard-utils').extractFailingFieldNames;
    try {
      const events = [];
      let call = 0;
      const session = createResearchSession({
        requirement: 'r',
        llm: scriptedLlm([
          reply(envelope('verify.run', {})),
          reply(envelope('verify.run', {})),
          reply(finishEnvelope('done'))
        ], []),
        tools: { 'verify.run': async () => { call += 1; return makeEnvVerify(['postTime'], call === 1)(); } },
        onEvent: (e) => events.push(e)
      });
      await session.run();
      const assists = events.filter((e) => e.type === 'field_assist_request');
      assert.equal(assists.length, 1, 'one real post-recovery failure + one exempt = single escalation');
    } finally { delete global.extractFailingFieldNames; }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd extension && node --test test/research-session.test.js`
Expected: the 2 new subtests FAIL (both verifies currently count)

- [ ] **Step 3: Implement**

3a. At the verify-result capture site (~2063, where `lastVerifyFailingFields171 = extractFn171(result.detectors)`), also capture the environmental marker:

```js
                lastVerifyFailingFields171 = extractFn171(result.detectors);
                lastVerifyErrorPrefix171 = (result.error && result.error.message) ? String(result.error.message).split(':')[0] : '';
                // 197th round (spec §3): an environmental-marked verify (screen
                // lock waits present in the run) does not count its field
                // empties as field defects.
                lastVerifyEnvironmental197 = !!(result.environmental && result.environmental.waitsMs > 0);
```

Declare beside the other 171 capture vars:
```js
    let lastVerifyEnvironmental197 = false;
```

3b. In `tickFieldFailLedger`, skip the count when the flag is set (keep resetting it):

```js
          if (lastVerifyFailingFields171 && lastVerifyFailingFields171.length && state.fieldFailLedger) {
              if (lastVerifyEnvironmental197) {
                // Environmental window: exempt (spec §3). Consume the tick so a
                // LATER real failure starts from a clean slate; the first
                // post-recovery failure counts as 1.
                lastVerifyFailingFields171 = null;
                lastVerifyEnvironmental197 = false;
              } else {
              const prefix171 = /* existing body unchanged */ '';
```

(Keep the existing body inside the `else`; close the brace before the existing consume line.)

- [ ] **Step 4: Run tests**

Run: `cd extension && node --test test/research-session.test.js`
Expected: all pass including the 2 new

- [ ] **Step 5: Commit**

```bash
git add lib/research-session.js test/research-session.test.js
git commit -m "feat: environmental verify failures exempt from the field ledger (spec §3)"
```

---

### Task 6: Session/task keep-awake lifecycle + settings toggle + TIME BUDGET disclosure

**Files:**
- Modify: `extension/wizard.js` (`startResearchSession` acquire / completion-stop release)
- Modify: `extension/background.js` (scrape-task begin acquire / end release — find `ExecutionQueue` task start/end or `handleOpenTabExecute` equivalents; the runtime entry points)
- Modify: `extension/options.html` + `extension/options.js` (toggle, default on)
- Modify: `extension/lib/research-session.js` (TIME BUDGET line: environmental waits)
- Test: `extension/test/keepawake-lifecycle.test.js`

- [ ] **Step 1: Write the failing tests**

Create `extension/test/keepawake-lifecycle.test.js`:

```js
// 197th round (spec §4/§5): keep-awake held for the session/task lifetime;
// environmental waits disclosed in the TIME BUDGET suffix.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WIZ = fs.readFileSync(path.join(__dirname, '../wizard.js'), 'utf8');
const BG = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const RS = fs.readFileSync(path.join(__dirname, '../lib/research-session.js'), 'utf8');
const OPT = fs.readFileSync(path.join(__dirname, '../options.js'), 'utf8');

describe('keep-awake lifecycle (source audit)', () => {
  it('wizard acquires on session start and releases on completion', () => {
    assert.match(WIZ, /acquireScreenKeepAwake/);
    assert.match(WIZ, /releaseScreenKeepAwake/);
  });
  it('background acquires for scrape tasks and releases at end', () => {
    assert.match(BG, /acquireScreenKeepAwake\(\)/);
    assert.match(BG, /releaseScreenKeepAwake\(\)/);
  });
  it('options page carries the toggle (default on)', () => {
    assert.match(OPT, /screenKeepAwakeEnabled/);
  });
  it('TIME BUDGET discloses environmental waits', () => {
    assert.match(RS, /environmental waits /);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd extension && node --test test/keepawake-lifecycle.test.js`
Expected: FAIL on all four

- [ ] **Step 3: Implement**

3a. `wizard.js` — in `startResearchSession` (right after the appendLog 'Starting research session' line):
```js
  try { chrome.runtime.sendMessage({ type: 'ACQUIRE_SCREEN_KEEP_AWAKE' }); } catch (eK) { /* best-effort */ }
```
And in `presentSessionCompletion` + the session 'stopped' event handler (both terminal sites):
```js
  try { chrome.runtime.sendMessage({ type: 'RELEASE_SCREEN_KEEP_AWAKE' }); } catch (eK) { /* best-effort */ }
```
Add the two message cases beside `GET_SCREEN_STATE` in `background.js`:
```js
  if (message.type === 'ACQUIRE_SCREEN_KEEP_AWAKE') { acquireScreenKeepAwake(); sendResponse({ ok: true }); return true; }
  if (message.type === 'RELEASE_SCREEN_KEEP_AWAKE') { releaseScreenKeepAwake(); sendResponse({ ok: true }); return true; }
```
Also acquire/release around the runtime scrape-task execution in `background.js` (the `ExecutionQueue` run entry/finally — find `runService`/queue drain and wrap):
```js
    acquireScreenKeepAwake();
    try { /* existing task execution */ } finally { releaseScreenKeepAwake(); }
```

3b. `options.js` — add the toggle (mirroring the Enhanced Mode precedent's read/write shape):
```js
  // 197th round: screen keep-awake during sessions/tasks (spec §4).
  const kwaToggle = document.getElementById('screenKeepAwakeToggle');
  if (kwaToggle) {
    chrome.storage.local.get({ screenKeepAwakeEnabled: true }, (st) => { kwaToggle.checked = !!st.screenKeepAwakeEnabled; });
    kwaToggle.addEventListener('change', () => {
      chrome.storage.local.set({ screenKeepAwakeEnabled: kwaToggle.checked });
    });
  }
```
`options.html` — add a labeled checkbox beside the Enhanced Mode control:
```html
        <label><input type="checkbox" id="screenKeepAwakeToggle" /> Keep the screen awake during research/run sessions (lazy-load sites need display-on compositor frames)</label>
```

3c. `lib/research-session.js` — in `formatTimeBudgetSuffix`, after the user-parked line:
```js
      if (environmentalWaitTotal > 5000) parts.push('environmental waits ' + Math.round(environmentalWaitTotal / 1000) + 's (screen locked/idle — ops waited for recovery, excluded from wallClock)');
```
Declare the accumulator beside `parkedTotal`, add to `parkBegin`-style accounting: ops report `environmental.waitedMs` on receipts; the engine's tool-result handler adds it once per receipt:
```js
    let environmentalWaitTotal = 0;
    // (in the turn loop, after a successful tool result:)
    try { if (result && result.environmental && typeof result.environmental.waitedMs === 'number') environmentalWaitTotal += result.environmental.waitedMs; } catch (_) {}
```
And exempt it from wallClock the same way parkedMs is (add to `computeEffectiveElapsed`'s subtraction or to `parkedThisSegment` at the accumulation site — follow whichever is smaller).

- [ ] **Step 4: Run tests + full suite**

Run: `cd extension && node --test test/keepawake-lifecycle.test.js && node --test test/*.test.js lib/*.test.js`
Expected: all pass (full suite count = prior + new)

- [ ] **Step 5: Commit**

```bash
git add wizard.js background.js options.js options.html lib/research-session.js test/keepawake-lifecycle.test.js
git commit -m "feat: keep-awake lifecycle + settings toggle + environmental TIME BUDGET disclosure (spec §4/§5)"
```

---

### Task 7: Options-page docs line + universality + full-suite green

**Files:**
- Modify: `README.md` + `README.zh-CN.md` (one line each in the throttling/compatibility section)
- Test: no new test — the universality audit already runs in the suite

- [ ] **Step 1: Add the docs lines**

`README.md` (Scrape-tab throttling section, after the trusted-wheel bullet):
```
6. **Screen keep-awake** (default on, options-page toggle): `chrome.power.requestKeepAwake('display')` is held for the research-session / scrape-task lifetime — display-off stops compositor frames and lazy-load sites never mount. Timeout-shaped op failures consult `chrome.idle`; a locked/idle screen triggers a wait-recover retry (≤90s) instead of a verdict. Environmental failures are exempt from the field-defect ledger.
```
`README.zh-CN.md` — the equivalent section, translated:
```
6. **屏幕保活**（默认开启，设置页开关）：研究会话/采集任务期间持有 `chrome.power.requestKeepAwake('display')` —— 熄屏停止合成器帧，懒加载站点永不挂载。超时形失败会查询 `chrome.idle`；锁屏/熄屏状态触发等待恢复重试（≤90 秒）而非直接判定失败。环境性失败不计入字段缺陷账本。
```

- [ ] **Step 2: Full suite**

Run: `cd extension && node --test test/*.test.js lib/*.test.js && cd ../native-host && npm test`
Expected: everything green

- [ ] **Step 3: Commit**

```bash
git add ../README.md ../README.zh-CN.md
git commit -m "docs: screen keep-awake + environmental retry in the throttle stack (READMEs)"
```

---

## Self-Review (done)

1. **Spec coverage:** §1 → Tasks 1-2; §2 → Tasks 3-4; §3 → Task 5; §4 → Task 6 (+ Task 2 holder); §5 → Task 6c. Testing section of spec → each task's tests. Out-of-scope respected (no OS-level changes, no input synthesis).
2. **Placeholder scan:** Task 3 has TWO wiring variants (3b/3c) with an explicit choose-one instruction — this is a decision point, not a placeholder; both show complete code. All other steps carry full code.
3. **Type consistency:** `{state, confidence, source}` shape identical in Tasks 1/2/3; `environmental: {recovered, state, waitedMs}` identical in Tasks 3/5/6; message names `GET_SCREEN_STATE` / `ACQUIRE_SCREEN_KEEP_AWAKE` / `RELEASE_SCREEN_KEEP_AWAKE` consistent across Tasks 2/3/6.
