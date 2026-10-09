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
const fs = require('node:fs');
const path = require('node:path');
const LiveRail = require('../lib/live-rail');

function makeRail(opts) {
  // opts: { pingOkTabs: Set, errorPageTabs: Set, loadFailTabs: Set,
  //         nowFn: () => ms, loadHook: (tabId) => void }
  const o = opts || {};
  const calls = { createTab: [], removeTab: [], order: [] };
  const removed = new Set();
  let nextId = 10;
  const deps = {
    createTab: async (url) => { nextId += 1; calls.createTab.push(nextId); return { id: nextId, url }; },
    removeTab: async (id) => { calls.removeTab.push(id); removed.add(id); },
    waitForTabLoad: async (tabId) => {
      if (o.loadHook) o.loadHook(tabId);
      if (o.loadFailTabs && o.loadFailTabs.has(tabId)) {
        throw new Error('Page load timeout (120s): readyState=loading, bodyChars=0');
      }
    },
    execute: async () => ({ result: 'x', selectorDiagnostics: [] }),
    acquireLock: async () => {},
    releaseLock: async () => {},
    pingReady: async (tabId) => {
      if (!o.pingOkTabs) return true;
      return o.pingOkTabs.has(tabId);
    },
    // 199th review F1: model tab liveness — a removed tab can no longer be
    // probed, so probeTabHealth must answer "no tab with id" for it (this is
    // exactly what the old probe-after-removeTab ordering hit in production).
    probeTabHealth: async (tabId) => {
      calls.order.push('probe:' + tabId);
      if (removed.has(tabId)) return { reachable: false, errorPage: false, reason: 'no tab with id ' + tabId };
      if (o.errorPageTabs && o.errorPageTabs.has(tabId)) {
        return { reachable: false, errorPage: true, reason: 'Frame with ID 0 is showing error page' };
      }
      return { reachable: true, errorPage: false, readyState: 'complete', bodyChars: 4200 };
    }
  };
  if (o.nowFn) deps.now = o.nowFn;
  const rail = LiveRail.createLiveRail(deps);
  return { rail, calls, deps };
}

describe('live-rail dead-tab retry (199th log)', () => {
  it('first fresh tab dead (error page) → retried with a second fresh tab, receipt discloses the retry, dead tab closed', async () => {
    const { rail, calls } = makeRail({ pingOkTabs: new Set([12]), errorPageTabs: new Set([11]) });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.equal(r.ready, true, 'second tab answers: ' + JSON.stringify(r));
    assert.equal(r.tabId, 12);
    assert.ok(r.tabRetryNote, 'retry disclosed on the receipt');
    assert.match(String(r.tabRetryNote), /fresh tab/i);
    assert.ok(calls.removeTab.includes(11), 'dead first tab closed, got ' + JSON.stringify(calls.removeTab));
    const st = await rail.pageState();
    assert.equal(st.open, true);
    assert.equal(st.tabId, 12);
  });

  it('TWO dead fresh tabs (both error pages) → error names the error-page cause even though the tabs are already removed', async () => {
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
    assert.equal(r.tabRetryNote, undefined);
    assert.deepEqual(calls.createTab, [11]);
  });

  it('F1: probeTabHealth is consulted BEFORE removeTab closes the dead tab', async () => {
    // Interleaved order log: record every probe and every remove in ONE
    // sequence so the ordering assertion is direct.
    const seq = [];
    const o = { pingOkTabs: new Set(), errorPageTabs: new Set([11, 12, 13]) };
    const base = makeRail(o);
    base.deps.probeTabHealth = async (tabId) => {
      seq.push('probe:' + tabId);
      return (o.errorPageTabs.has(tabId))
        ? { reachable: false, errorPage: true, reason: 'error page' }
        : { reachable: true, errorPage: false };
    };
    base.deps.removeTab = async (id) => { seq.push('remove:' + id); base.calls.removeTab.push(id); };
    const r = await base.rail.pageOpen({ url: 'https://example.com/search' });
    assert.ok(r.error);
    assert.match(r.error, /error page/i);
    const probeIdx = seq.indexOf('probe:11');
    const removeIdx = seq.indexOf('remove:11');
    assert.ok(probeIdx !== -1 && removeIdx !== -1, 'both recorded: ' + JSON.stringify(seq));
    assert.ok(probeIdx < removeIdx, 'health probe must precede tab removal, got ' + JSON.stringify(seq));
  });

  it('F5: load timeout + dead ping → NO second createTab; error names the timeout', async () => {
    const { rail, calls } = makeRail({ pingOkTabs: new Set(), loadFailTabs: new Set([11, 12, 13]) });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.ok(r.error, 'expected error receipt, got ' + JSON.stringify(r));
    assert.match(r.error, /load timeout/i, 'error carries the load-timeout warning: ' + r.error);
    assert.match(r.error, /never finished loading/i);
    assert.equal(calls.createTab.length, 1, 'no second 120s budget for a page that never loaded');
  });

  it('F5: load timeout + ping ALIVE → old behavior preserved (tab kept, warning on the receipt)', async () => {
    const { rail, calls } = makeRail({ pingOkTabs: new Set([11]), loadFailTabs: new Set([11]) });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.equal(r.ready, true, 'ready path unchanged: ' + JSON.stringify(r));
    assert.match(String(r.warning), /load timeout/i);
    assert.deepEqual(calls.createTab, [11]);
    assert.deepEqual(calls.removeTab, [], 'the loaded tab is kept');
  });

  it('F10: a first attempt that consumed the open budget (>150s) gets NO second attempt', async () => {
    let clock = 1000000;
    const { rail, calls } = makeRail({
      pingOkTabs: new Set(),
      nowFn: () => clock,
      loadHook: (tabId) => { if (tabId === 11) clock += 151000; }
    });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.ok(r.error, 'budget-capped open must be an error receipt');
    assert.match(r.error, /open budget/i, r.error);
    assert.equal(calls.createTab.length, 1, 'no second attempt past the cap, got ' + JSON.stringify(calls.createTab));
  });

  // 211th review F10: the cap only gates the RETRY DECISION — attempt 2
  // itself still rides a full waitForTabLoad budget, so when the remaining
  // open budget is under one load budget (120s) the receipt must say so.
  it('F10: attempt 2 started with <120s of open budget remaining discloses it on the receipt', async () => {
    let clock = 1000000;
    const { rail } = makeRail({
      pingOkTabs: new Set([12]),
      errorPageTabs: new Set([11]),
      nowFn: () => clock,
      loadHook: (tabId) => { if (tabId === 11) clock += 50000; }
    });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.equal(r.ready, true, 'attempt 2 succeeds: ' + JSON.stringify(r));
    assert.ok(r.tabRetryNote, 'retry disclosed');
    assert.match(String(r.tabRetryNote), /100s of open budget remaining/, 'names the remaining budget: ' + r.tabRetryNote);
    assert.match(String(r.tabRetryNote), /slow load may exceed it/, 'teaches the risk');
  });

  it('F10: attempt 2 with ample remaining budget carries no budget warning', async () => {
    let clock = 1000000;
    const { rail } = makeRail({
      pingOkTabs: new Set([12]),
      errorPageTabs: new Set([11]),
      nowFn: () => clock,
      loadHook: (tabId) => { if (tabId === 11) clock += 20000; }
    });
    const r = await rail.pageOpen({ url: 'https://example.com/search' });
    assert.equal(r.ready, true);
    assert.doesNotMatch(String(r.tabRetryNote || ''), /open budget remaining/, 'no warning when the budget is ample: ' + r.tabRetryNote);
  });
});

// 199th re-review F1/F4: the top-level probeTabHealth helper and the rail's
// pingReady live embedded in wizard.js (not exported), so pin them by source
// audit — the repo's standard pattern for wizard.js internals.
describe('wizard.js probeTabHealth / rail pingReady (199th re-review source audit)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'wizard.js'), 'utf8');

  function fnBody(marker, span) {
    const i = src.indexOf(marker);
    assert.ok(i !== -1, 'marker found: ' + marker);
    return src.slice(i, i + (span || 2000));
  }

  it('F1: probeTabHealth races executeScript against a 4s timer and clears the loser', () => {
    const body = fnBody('async function probeTabHealth(', 2200);
    assert.match(body, /Promise\.race/, 'the executeScript await is raced');
    assert.match(body, /4000/, 'against a 4s timeout');
    assert.match(body, /clearTimeout|clearInterval/, 'the loser timer is cleared (no dangling timer)');
    assert.match(body, /health probe timed out/, 'timeout reason discloses the wedged-renderer diagnosis');
  });

  it('F4: rail pingReady probes tab health after the first failed PING and bails early on an error page', () => {
    const body = fnBody('pingReady: async (tabId) => {', 1600);
    assert.match(body, /probeTabHealth/, 'the health probe is consulted inside the readiness loop');
    assert.match(body, /errorPage/, 'the early exit keys on the error-page discriminator');
    assert.match(body, /return false/, 'and returns false instead of sleeping the full window');
  });
});
