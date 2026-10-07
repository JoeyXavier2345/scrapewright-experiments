// extension/test/live-rail-dead-tab.test.js
// 199th log: page.open returned {ready:false, warning:'content script not
// responding yet'} on tabs that NEVER got a content script (browser error
// pages — the site refused repeated heavy loads), kept the dead tab as the
// rail tab, and the next page.settle died "RELAY_FAILED … — settle needs an
// open page; call page.open first" — misleading guidance that burned model
// turns. The rail must retry once with a fresh tab, and fail honestly when
// two fresh tabs are both dead.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LiveRail = require('../lib/live-rail');

function makeRail(opts) {
  // opts: { pingOkTabs: Set, errorPageTabs: Set }
  const o = opts || {};
  const calls = { createTab: [], removeTab: [] };
  let nextId = 10;
  const deps = {
    createTab: async (url) => { nextId += 1; calls.createTab.push(nextId); return { id: nextId, url }; },
    removeTab: async (id) => { calls.removeTab.push(id); },
    waitForTabLoad: async () => {},
    execute: async () => ({ result: 'x', selectorDiagnostics: [] }),
    acquireLock: async () => {},
    releaseLock: async () => {},
    pingReady: async (tabId) => {
      if (!o.pingOkTabs) return true;
      return o.pingOkTabs.has(tabId);
    },
    probeTabHealth: async (tabId) => {
      if (o.errorPageTabs && o.errorPageTabs.has(tabId)) {
        return { reachable: false, errorPage: true, reason: 'Frame with ID 0 is showing error page' };
      }
      return { reachable: true, errorPage: false, readyState: 'complete', bodyChars: 4200 };
    }
  };
  const rail = LiveRail.createLiveRail(deps);
  return { rail, calls, deps };
}

describe('live-rail dead-tab retry (199th log)', () => {
  it('first fresh tab dead (error page) → retried with a second fresh tab, receipt discloses the retry, dead tab closed', async () => {
    const { rail, calls } = makeRail({ pingOkTabs: new Set([12]), errorPageTabs: new Set([11]) });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.equal(r.ready, true, 'second tab answers: ' + JSON.stringify(r));
    assert.equal(r.tabId, 12);
    assert.ok(r.tabRetry, 'retry disclosed on the receipt');
    assert.match(String(r.tabRetry), /fresh tab/i);
    assert.ok(calls.removeTab.includes(11), 'dead first tab closed, got ' + JSON.stringify(calls.removeTab));
    const st = await rail.pageState();
    assert.equal(st.open, true);
    assert.equal(st.tabId, 12);
  });

  it('TWO dead fresh tabs → honest error naming the error page, rail left with NO open page (not a zombie currentTab)', async () => {
    const { rail, calls } = makeRail({ pingOkTabs: new Set(), errorPageTabs: new Set([11, 12, 13]) });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.ok(r.error, 'double-dead open must be an error receipt');
    assert.match(r.error, /error page/i, 'names the error-page mechanism: ' + r.error);
    assert.match(r.error, /two fresh tabs/i);
    const st = await rail.pageState();
    assert.equal(st.open, false, 'no zombie currentTab');
  });

  it('two dead fresh tabs, page REACHABLE (no error page) → error names the not-responding content script', async () => {
    const { rail } = makeRail({ pingOkTabs: new Set(), errorPageTabs: null });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.ok(r.error);
    assert.match(r.error, /content script/i);
    assert.doesNotMatch(r.error, /error page/i);
  });

  it('healthy first tab → single createTab, no retry noise', async () => {
    const { rail, calls } = makeRail({ pingOkTabs: null });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.equal(r.ready, true);
    assert.equal(r.tabRetry, undefined);
    assert.deepEqual(calls.createTab, [11]);
  });
});
