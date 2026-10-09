// extension/test/two-hundred-fifteenth-log.test.js
//
// 215th log (session rs-1791554571255-1, travel keyword, ship-red finish
// at turn ~56 with honest disclosures — the gates all fired). Two harness
// gaps surfaced:
//
//   A. PREMATURE_EXHAUSTION (145th) never fired on this session's collect:
//      the script exited `return {done:true}` — BARE, no numeric counter —
//      after ONE no-growth round, delivering 2 of 6. The veto required a
//      numeric field in the step preview (the 145th incident carried
//      {done, n}); a counter-less done preview skipped the veto entirely,
//      so the model only learned "exhaustion NOT certified" from the
//      shortfall lane, never the named one-round self-declared-done bug
//      (its own finish note: "collect returned done:true after 1 iteration
//      despite shortfall").
//
//   B. page.open blessed a RAW-SOURCE dump as ready+hydrated: body text was
//      3,500,036 chars of unrendered `{"require":[["qplTimingsServerJS"...`
//      payload (the site serving degraded/plain-text loads under repeated
//      heavy opens) with ZERO rendered articles — bodyTextChars>200 read as
//      "hydrated", the model probed a dead tab for ~25 turns across three
//      re-opens before the site recovered.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyRunner } = require('../lib/verify-runner');
const { createLiveRail } = require('../lib/live-rail');

// ---------- A. counter-less done previews still veto ----------

function makeRunner(orch, service, input, schema) {
  const deps = {
    ensureLock: async () => {},
    releaseLock: async () => {},
    createTab: async () => ({ id: 1 }),
    removeTab: async () => {},
    waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }),
    executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }),
    evaluateCondition: async () => true,
    orchestrate: orch
  };
  return createVerifyRunner(deps);
}

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } };

// The 215th shape: bare {done:true} on one no-growth round — no counter.
const SERVICE_215 = {
  targetUrl: 'https://example.com/search?q=x',
  steps: [
    { id: 'collect', name: 'scroll collect', script: 'const c=await $count(".card");if(c<__input__.count){await $scrollBy(900);await new Promise(r=>setTimeout(r,2000));const c2=await $count(".card");if(c2===c)return{done:true};return{done:false};}return{done:true};', onSuccess: 'extract', maxIterations: 12 },
    { id: 'extract', name: 'extract', script: 'return {posts: await $list(".card")};', onSuccess: 'TERMINATE' }
  ],
  config: {}
};

function orch215(collectPreviews, posts) {
  return async (svc, input, d, opts) => {
    await d.createTab(svc.targetUrl);
    opts.onEvent({ type: 'EXECUTION_START' });
    let i = 0;
    for (const pv of collectPreviews) {
      opts.onEvent({ type: 'STEP_ITERATION', stepId: 'collect', iteration: ++i, resultPreview: pv });
    }
    opts.onEvent({ type: 'STEP_ITERATION', stepId: 'extract', iteration: 1, resultPreview: '{"done":true,"posts":[...]}' });
    return { finalResult: { posts: posts }, steps: [], pages: [], pagesTruncated: false };
  };
}

describe('A. PREMATURE_EXHAUSTION fires on counter-less done previews (215th log)', () => {
  it('bare {done:true} after 1 iteration + severe shortfall is RED with the named bug', async () => {
    const runner = makeRunner(orch215(['{"done":true}'], [{ a: 1 }]));
    const out = await runner({ service: SERVICE_215, input: { count: 6 }, outputSchema: SCHEMA });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /PREMATURE_EXHAUSTION/);
    assert.match(out.report.error.message, /"collect"/);
    assert.match(out.report.error.message, /\$collectUntil/);
  });
  it('a preview counter at/above the ask still exempts (counter-present path unchanged)', async () => {
    const runner = makeRunner(orch215(['{"done":true,"n":9}'], [{ a: 1 }]));
    const out = await runner({ service: SERVICE_215, input: { count: 6 }, outputSchema: SCHEMA });
    assert.doesNotMatch(String((out.report.error && out.report.error.message) || ''), /PREMATURE_EXHAUSTION/);
  });
  it('the 145th counter-present incident shape stays RED (regression pin)', async () => {
    const runner = makeRunner(orch215(['{"done":true,"n":1}'], [{ a: 1 }]));
    const out = await runner({ service: SERVICE_215, input: { count: 10 }, outputSchema: SCHEMA });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /PREMATURE_EXHAUSTION/);
  });
});

// ---------- B. page.open names the raw-source dump ----------

function railDeps(bodyText) {
  return {
    defaultUrl: 'https://example.com/search',
    createTab: async (url) => ({ id: 7, url }),
    removeTab: async () => {},
    waitForTabLoad: async () => {},
    getTab: async (id) => ({ id, url: 'https://example.com/search', title: 'S', status: 'complete' }),
    pingReady: async () => true,
    execute: async (tabId, snippet) => ({ result: bodyText, snippet }),
    acquireLock: async () => {},
    releaseLock: async () => {},
    log: () => {}
  };
}

describe('B. page.open raw-source dump detection (215th log)', () => {
  it('a markup-dump body (DOCTYPE/tag head) draws the PLAIN TEXT warning', async () => {
    const rail = createLiveRail(railDeps('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div class="x">{"require":[["qplTimingsServerJS"' + 'x'.repeat(900)));
    const r = await rail.pageOpen({});
    assert.match(r.warning || '', /PLAIN TEXT|RAW SOURCE/i);
    assert.match(r.warning || '', /re-open|dead/i);
  });
  it('a huge JSON-module dump (no tags in head) also draws the warning', async () => {
    const rail = createLiveRail(railDeps('{"require":[["qplTimingsServerJS",null,null,["1","2"]]]}' + 'y'.repeat(200000)));
    const r = await rail.pageOpen({});
    assert.match(r.warning || '', /PLAIN TEXT|RAW SOURCE/i);
  });
  it('normal rendered text stays silent; a short body keeps the unhydrated-shell warning', async () => {
    const rail = createLiveRail(railDeps(' '.repeat(60) + 'Posts about travel, listed below with authors and timestamps. ' + 'z'.repeat(300)));
    const r = await rail.pageOpen({});
    assert.ok(!/PLAIN TEXT|RAW SOURCE/i.test(r.warning || ''), 'no raw warning: ' + (r.warning || ''));
    const rail2 = createLiveRail(railDeps('short'));
    const r2 = await rail2.pageOpen({});
    assert.match(r2.warning || '', /UNHYDRATED SHELL/i, 'shell warning preserved');
  });
});
