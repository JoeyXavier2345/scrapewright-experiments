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
const { createVerifyRunner } = require('../lib/verify-runner');

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
  // opts: { pingOkTabs: Set<number> of tab ids where PING answers, errorPageTabs: Set<number>, throwsLeft: number }
  const o = opts || {};
  let nextId = 10;
  const calls = { removeTab: [], logs: [] };
  const deps = {
    orchestrate: greenOrchestrate({ count: o.throwsLeft || 0 }),
    ensureLock: async () => {},
    getSignal: () => null,
    log: (msg, level) => { calls.logs.push(String(msg)); },
    onEvent: () => {},
    createTab: async (url) => { nextId += 1; return { id: nextId, url }; },
    removeTab: async (id) => { calls.removeTab.push(id); },
    waitForTabLoad: async () => {},
    sendMessage: async (tabId, msg) => {
      if (msg && msg.type === 'PING') {
        const okTabs = o.pingOkTabs;
        if (!okTabs || okTabs.has(tabId)) return { pong: true };
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return { pong: true };
    },
    probeTabHealth: async (tabId) => {
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
});
