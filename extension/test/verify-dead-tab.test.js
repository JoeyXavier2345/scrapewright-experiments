// extension/test/verify-dead-tab.test.js
// 199th log: two consecutive verify.run calls died "RELAY_FAILED: Could not
// establish connection. Receiving end does not exist." after burning ~84s
// each. Root cause: the fresh verify tab landed on a browser ERROR PAGE
// (the site refused the load after ~15 heavy loads in 40 minutes) — error
// pages never receive a content script, the PING loop already knew
// ("Warning: content script not responding; proceeding anyway"), and the
// step's first $ op then rode the 4x1s relay retry into a red verify.
// These tests pin the dead-tab guard: fail fast with a named cause, retry
// once with a fresh tab, disclose the retry.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createVerifyRunner } = require('../lib/verify-runner');

// 199th review F2: the tests above mock d.orchestrate, so nothing proves the
// REAL StepOrchestrator surfaces the runner-built waitForTabLoad wrapper's
// VERIFY_TAB_ERROR_PAGE throw — a future tolerant catch inside execute()
// would silently convert the named cause back into a downstream RELAY_FAILED.
// Mirror the SW globals step-orchestrator resolves at call time.
global.debugLogger = global.debugLogger || { log: () => {} };
global.UrlTemplate = global.UrlTemplate || require('../lib/url-template');
const { StepOrchestrator } = require('../lib/step-orchestrator');

const SERVICE = { targetUrl: 'https://example.com', steps: [{ id: 's1', name: 'one', script: 'return 1', onSuccess: 'TERMINATE' }], config: {} };

// A minimal orchestrate stand-in: creates the tab through the runner-built
// deps (so the PING/health guard in the waitForTabLoad dep actually runs),
// then returns a green shape. `failOnce` makes the FIRST orchestrate's
// waitForTabLoad throw by having the PING fail (mocked below), which the
// runner dep converts to a named error.
function greenOrchestrate(throws) {
  return async (svc, input, d, opts) => {
    const tab = await d.createTab(svc.targetUrl);
    await d.waitForTabLoad(tab.id); // runner-built wrapper: PING + health guard
    if (throws && throws.count > 0) {
      throws.count -= 1;
      throw new Error('RELAY_FAILED: Could not establish connection. Receiving end does not exist.');
    }
    return {
      finalResult: { posts: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }] },
      steps: [{ stepId: 's1', stepName: 'one', result: { done: true }, snapshot: null }],
      pages: [], pagesTruncated: false
    };
  };
}

function makeRunner(opts) {
  // opts: { pingOkTabs: Set<number>, errorPageTabs: Set<number>, throwsLeft: number,
  //         orchestrate: fn override, signal: abort signal shape }
  const o = opts || {};
  let nextId = 10;
  const calls = { removeTab: [], logs: [], order: [] };
  const deps = {
    orchestrate: o.orchestrate || greenOrchestrate({ count: o.throwsLeft || 0 }),
    wizardUtils: o.wizardUtils,
    ensureLock: async () => {},
    getSignal: () => o.signal || null,
    log: (msg, level) => { calls.logs.push(String(msg)); },
    onEvent: () => {},
    createTab: async (url) => { nextId += 1; return { id: nextId, url }; },
    removeTab: async (id) => { calls.removeTab.push(id); },
    waitForTabLoad: async () => {},
    sendMessage: async (tabId, msg) => {
      if (msg && msg.type === 'PING') {
        calls.order.push('ping:' + tabId);
        const okTabs = o.pingOkTabs;
        if (!okTabs || okTabs.has(tabId)) return { pong: true };
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return { pong: true };
    },
    probeTabHealth: async (tabId) => {
      calls.order.push('probe:' + tabId);
      if (o.errorPageTabs && o.errorPageTabs.has(tabId)) {
        return { reachable: false, errorPage: true, reason: 'Frame with ID 0 is showing error page' };
      }
      return { reachable: true, errorPage: false, readyState: 'complete', bodyChars: 5231 };
    },
    // test seam: the PING backoff loop is 20x300ms in production; 1ms keeps tests fast
    csPingIntervalMs: 1,
    executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }),
    evaluateCondition: async () => true
  };
  return { runner: createVerifyRunner(deps), calls };
}

describe('verify dead-tab guard (199th log)', () => {
  it('error-page verify tab: first orchestrate fails fast with VERIFY_TAB_ERROR_PAGE, retry with a fresh tab goes green, retry disclosed', async () => {
    // tab 11 = first fresh tab (error page, PING dead); tab 12 = retry tab (healthy)
    const { runner, calls } = makeRunner({ pingOkTabs: new Set([12]), errorPageTabs: new Set([11]) });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, true, 'second attempt must go green, got error ' + JSON.stringify(out.report.error));
    assert.ok(out.report.tabRetry, 'retry is disclosed on the report');
    assert.match(out.report.tabRetry.firstError, /VERIFY_TAB_ERROR_PAGE/);
    assert.deepEqual(calls.removeTab.sort(), [11, 12], 'both tabs cleaned up');
  });

  it('error-page on BOTH fresh tabs: honest named error, no proceed-anyway RELAY_FAILED', async () => {
    const { runner } = makeRunner({ pingOkTabs: new Set([]), errorPageTabs: new Set([11, 12, 13]) });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /VERIFY_TAB_ERROR_PAGE/, 'error names the error-page cause, got: ' + out.report.error.message);
    assert.match(out.report.error.message, /error page/i);
  });

  it('page reachable but content script dead: VERIFY_TAB_CONTENT_SCRIPT_NOT_READY (not the misleading RELAY_FAILED)', async () => {
    const { runner } = makeRunner({ pingOkTabs: new Set([]), errorPageTabs: null });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /VERIFY_TAB_CONTENT_SCRIPT_NOT_READY/, 'got: ' + out.report.error.message);
    assert.match(out.report.error.message, /reachable/);
  });

  it('mid-run RELAY_FAILED with no data yet retries once (CS died between PING and first op)', async () => {
    // PING answers everywhere (tab healthy at load), but orchestrate throws
    // RELAY_FAILED once — the runner must retry with a fresh tab and go green.
    const { runner } = makeRunner({ pingOkTabs: null, throwsLeft: 1 });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, true, 'got error ' + JSON.stringify(out.report.error));
    assert.ok(out.report.tabRetry, 'retry disclosed');
    assert.match(out.report.tabRetry.firstError, /RELAY_FAILED/);
  });

  it('a data-producing run is never retried (side-effect safety)', async () => {
    // throwsLeft=0 → orchestrate succeeds on the first attempt; no retry machinery may fire.
    const { runner, calls } = makeRunner({ pingOkTabs: null, throwsLeft: 0 });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, true);
    assert.equal(out.report.tabRetry, undefined);
    assert.equal(calls.removeTab.length, 1);
  });

  it('non-tab errors do not burn a second orchestrate', async () => {
    let orchestrateCalls = 0;
    const base = makeRunner({ pingOkTabs: null, throwsLeft: 0 });
    const deps = base.depsUnused; // placeholder to keep shape obvious
    void deps; void base;
    const calls = { removeTab: [] };
    let nextId = 10;
    const { createVerifyRunner: cvr } = require('../lib/verify-runner');
    const runner2 = cvr({
      orchestrate: async () => { orchestrateCalls += 1; throw new Error('STEP_FAILED: selector matched nothing'); },
      ensureLock: async () => {},
      getSignal: () => null,
      log: () => {},
      onEvent: () => {},
      createTab: async (url) => { nextId += 1; return { id: nextId, url }; },
      removeTab: async (id) => { calls.removeTab.push(id); },
      waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }),
      executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }),
      evaluateCondition: async () => true
    });
    const out = await runner2({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, false);
    assert.equal(orchestrateCalls, 1, 'script-shape errors are not tab-state errors — one attempt only');
    assert.match(out.report.error.message, /STEP_FAILED/);
  });

  it('REAL StepOrchestrator.execute propagates the VERIFY_TAB_ERROR_PAGE rejection from deps.waitForTabLoad', async () => {
    const calls = { removeTab: [] };
    const deps = {
      createTab: async (url) => ({ id: 21, url }),
      // MUST resolve — the orchestrator runs the sandbox scrub through
      // executeScript BEFORE waitForTabLoad (best-effort, but keep it clean
      // so the only throw under test is the wrapper's).
      executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      waitForTabLoad: async () => {
        throw new Error('VERIFY_TAB_ERROR_PAGE: the fresh verify tab landed on a browser error page');
      },
      removeTab: async (id) => { calls.removeTab.push(id); },
      captureSnapshot: async () => ({ html: '<html></html>' }),
      evaluateCondition: async () => true,
      getDomActivity: async () => [],
      resetDomActivity: async () => {}
    };
    await assert.rejects(
      StepOrchestrator.execute(SERVICE, {}, deps),
      (err) => /VERIFY_TAB_ERROR_PAGE/.test(err.message),
      'the named error-page cause must escape execute() unswallowed'
    );
    assert.deepEqual(calls.removeTab, [21], 'the orchestrator still cleans up the dead tab');
  });

  it('F2: retry starts clean — attempt-1 events do not ride the attempt-2 report', async () => {
    let calls = 0;
    const orchestrate = async (svc, input, d, opts) => {
      calls += 1;
      if (calls === 1) {
        opts.onEvent({ type: 'STEP_ITERATION', stepId: 's1', iteration: 1, resultPreview: '{"posts":[]}' });
        throw new Error('RELAY_FAILED: Could not establish connection. Receiving end does not exist.');
      }
      return {
        finalResult: { posts: [{ a: 1 }, { a: 2 }] },
        steps: [{ stepId: 's1', stepName: 'one', result: { done: true }, snapshot: null }],
        pages: [], pagesTruncated: false
      };
    };
    const { runner } = makeRunner({ pingOkTabs: null, orchestrate });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, true, 'attempt 2 goes green, got ' + JSON.stringify(out.report.error));
    assert.equal(out.report.eventCount, 0, 'attempt-1 events must be dropped on retry, got ' + out.report.eventCount);
    assert.equal(out.events.length, 0, 'raw event log is attempt-2 only');
  });

  it('F4: probeTabHealth consulted after the FIRST failed PING (before the 2nd PING attempt)', async () => {
    const { runner, calls } = makeRunner({ pingOkTabs: new Set([]), errorPageTabs: null });
    await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    const pings11 = calls.order.map((x, i) => (x === 'ping:11' ? i : -1)).filter((i) => i >= 0);
    const firstProbe = calls.order.indexOf('probe:11');
    assert.ok(pings11.length >= 2, 'a dead-but-reachable tab keeps PINGing');
    assert.ok(firstProbe !== -1 && firstProbe < pings11[1],
      'health probe must fire before the 2nd PING, order: ' + JSON.stringify(calls.order.slice(0, 5)));
  });

  it('F4: proven error page breaks the PING loop early — exactly ONE PING before the named error', async () => {
    const { runner, calls } = makeRunner({ pingOkTabs: new Set([]), errorPageTabs: new Set([11, 12, 13]) });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /VERIFY_TAB_ERROR_PAGE/);
    const pingCount = calls.order.filter((x) => x === 'ping:11').length;
    assert.equal(pingCount, 1, 'no full PING window on a proven error page, got ' + pingCount + ' PINGs');
  });

  it('F6: an aborted signal kills the fresh-tab retry — TEST_ABORTED surfaces, orchestrate ran exactly once', async () => {
    let orchestrateCalls = 0;
    const orchestrate = async () => {
      orchestrateCalls += 1;
      throw new Error('RELAY_FAILED: Could not establish connection. Receiving end does not exist.');
    };
    const { runner } = makeRunner({ pingOkTabs: null, orchestrate, signal: { aborted: true } });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /TEST_ABORTED/, 'got: ' + out.report.error.message);
    assert.equal(out.report.aborted, true);
    assert.equal(orchestrateCalls, 1, 'no fresh-tab retry after an abort, got ' + orchestrateCalls + ' orchestrates');
  });

  it('F7: bare CONTENT_SCRIPT_NOT_READY (dead $openTab sub-tab) is retried once with a fresh tab', async () => {
    let calls = 0;
    const orchestrate = async (svc, input, d) => {
      calls += 1;
      const tab = await d.createTab(svc.targetUrl);
      await d.waitForTabLoad(tab.id);
      if (calls === 1) throw new Error('CONTENT_SCRIPT_NOT_READY');
      return {
        finalResult: { posts: [{ a: 1 }] },
        steps: [{ stepId: 's1', stepName: 'one', result: { done: true }, snapshot: null }],
        pages: [], pagesTruncated: false
      };
    };
    const { runner } = makeRunner({ pingOkTabs: null, orchestrate });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, true, 'retry fires and goes green, got ' + JSON.stringify(out.report.error));
    assert.ok(out.report.tabRetry, 'retry disclosed');
    assert.match(out.report.tabRetry.firstError, /CONTENT_SCRIPT_NOT_READY/);
  });

  it('F7 drift guard: background.js still throws the strings the retry regex keys on', () => {
    const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
    assert.match(bg, /RELAY_FAILED:/, 'RELAY_FAILED producer must remain in background.js');
    assert.match(bg, /CONTENT_SCRIPT_NOT_READY/, 'CONTENT_SCRIPT_NOT_READY producer must remain (handleOpenTabExecute dead sub-tab)');
  });

  it('199th re-review: attempt-1 frozen-zero streaks must not carry into attempt 2 (the reset clears more than events)', async () => {
    // Thresholds injected at streak 3 / elapsed 0: attempt 1 emits 2 frozen-zero
    // events (streak 2, below trip) then RELAY_FAILED; attempt 2 emits 2 more
    // then goes green. WITHOUT zeroCounterStreaks.clear(), attempt-2's second
    // event completes a CROSS-ATTEMPT streak of 4 → breaker trips → the mock's
    // next d.executeScript (the runner dep, which checks signalAborted) throws
    // TEST_ABORTED and a recovering retry dies.
    const WU = require('../lib/wizard-utils');
    let calls = 0;
    const orchestrate = async (svc, input, d, opts) => {
      const tab = await d.createTab(svc.targetUrl);
      await d.waitForTabLoad(tab.id);
      calls += 1;
      if (calls === 2) {
        // deterministic elapsed ≥ MIN_ELAPSED (1ms) — without a sleep the two
        // attempts can complete inside the same millisecond and the trip
        // condition never fires, making the test vacuously green.
        await new Promise((r) => setTimeout(r, 3));
      }
      opts.onEvent({ type: 'STEP_ITERATION', stepId: 's1', iteration: 1, resultPreview: '{"done":false,"uniqueCount":0,"noGrowth":0}' });
      opts.onEvent({ type: 'STEP_ITERATION', stepId: 's1', iteration: 2, resultPreview: '{"done":false,"uniqueCount":0,"noGrowth":0}' });
      await d.executeScript(tab.id, 'scrub', {}, 10000); // signalAborted check point (as the real orchestrator runs it)
      if (calls === 1) throw new Error('RELAY_FAILED: Could not establish connection. Receiving end does not exist.');
      return {
        finalResult: { posts: [{ a: 1 }] },
        steps: [{ stepId: 's1', stepName: 'one', result: { done: true }, snapshot: null }],
        pages: [], pagesTruncated: false
      };
    };
    const { runner } = makeRunner({
      pingOkTabs: null, orchestrate,
      // MIN_ELAPSED_MS must be 1, not 0 — the resolveWU bag builds it with
      // `w.X || 60000`, and a falsy 0 falls back to the 60s production floor
      // (the trip then never fires in test time and the test would pass
      // vacuously — proven by mutation: removing the .clear() kept it green
      // until this value was 1).
      wizardUtils: Object.assign({}, WU, { FROZEN_ZERO_STREAK_THRESHOLD: 3, FROZEN_ZERO_MIN_ELAPSED_MS: 1 })
    });
    const out = await runner({ service: SERVICE, input: {}, outputSchema: { type: 'object' } });
    assert.equal(out.report.ok, true, 'attempt 2 must complete green — a cross-attempt streak must not trip the breaker, got ' + JSON.stringify(out.report.error));
    assert.equal(out.raw.breaker, null, 'no breaker on a healthy retried run');
    assert.equal(out.report.eventCount, 2, 'attempt-2 events only');
  });

  it('199th re-review: REAL StepOrchestrator passes a bare CONTENT_SCRIPT_NOT_READY rejection through unswallowed', async () => {
    // F7's retry keys on the BARE token surviving the orchestrator's per-step
    // catch. A future rewrap in step-orchestrator.js would disarm the retry
    // while every mock-level test stayed green — pin the real propagation.
    const deps = {
      createTab: async (url) => ({ id: 31, url }),
      executeScript: async () => { throw new Error('CONTENT_SCRIPT_NOT_READY'); },
      waitForTabLoad: async () => {},
      removeTab: async () => {},
      captureSnapshot: async () => ({ html: '<html></html>' }),
      evaluateCondition: async () => true,
      getDomActivity: async () => [],
      resetDomActivity: async () => {}
    };
    await assert.rejects(
      StepOrchestrator.execute(SERVICE, {}, deps),
      (err) => /CONTENT_SCRIPT_NOT_READY/.test(err.message),
      'the bare sub-tab token must escape execute() intact (TAB_STATE_RETRY_RE keys on it)'
    );
  });
});
