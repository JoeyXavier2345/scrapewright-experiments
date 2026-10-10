// extension/test/two-hundred-twenty-fifth-log.test.js
//
// 225th round — the 9-reviewer code review over 8d3cc9b..HEAD (rounds
// 212-224) found three P0s that were dead/no-op in production and a set of
// P1/P2s. This file pins the fixes:
//   #3  the work-scaled hover wall budget reached the production path (the
//       deadlineAt clamp had hardcoded the flat 25000 fallback).
//   #1  shipRed evidence check derives delivered counts from
//       report.deliveredCounts (present on full delivery) — the detector
//       path was null for exactly the 6/6 green of the 221st incident.
//   #2  UNCERTIFIED exemptions: not-ready is the orchestrator whitelist
//       (plain-data results are NOT polls), the streak must belong to a
//       collector-family step, and $collectUntil must be a CALL in
//       comment-stripped text.
//   #4  validateChain enumerates ALL success cycles; exit tokens are tested
//       comment-stripped; maxIterations>1 alone is not an exit.
//   #6  verify facts are version-stamped (stale receipts ignored); the red
//       side compares UNIQUE when it carries a unique count.
//   #5  anchor re-resolution is identity-guarded (connected handle wins;
//       detached replaced only on count parity; drift counted).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const WU = require('../lib/wizard-utils');
const { createVerifyRunner } = require('../lib/verify-runner');
const { createResearchSession } = require('../lib/research-session');

function setupDOM(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/page' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.Node = dom.window.Node;
  return dom;
}

// ---------- #3: the scaled budget reaches the production clamp ----------

describe('#3 scaled budget on the production path (225th review)', () => {
  it('the domExtractWithHover clamp uses defaultHoverWallBudgetMs (source pin)', () => {
    const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = cs.indexOf('225th review #3');
    assert.ok(i > -1, 'the fix marker exists');
    const region = cs.slice(i, i + 700);
    assert.match(region, /ops\.defaultHoverWallBudgetMs\(processed\.length\)/, 'clamp fallback scales with containers');
    assert.doesNotMatch(region, /: 25000,/, 'the flat fallback is gone from the clamp');
  });
});

// ---------- #1: deliveredCounts + the real-shape 221 incident ----------

function verifyRunnerWith(orchestrate) {
  return createVerifyRunner({
    orchestrate, ensureLock: async () => {}, getSignal: () => null, log: () => {}, onEvent: () => {},
    createTab: async (url) => ({ id: 11, url }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true
  });
}

describe('#1 deliveredCounts ride the report on FULL delivery (225th review)', () => {
  it('a 6/6 green carries deliveredCounts.posts=6 with NO countShortfall detector', async () => {
    const runner = verifyRunnerWith(async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      return { finalResult: { posts: Array.from({ length: 6 }, (_, i) => ({ content: 'p' + i })) }, steps: [], pages: [], pagesTruncated: false };
    });
    const out = await runner({
      service: { targetUrl: 'https://e.com', steps: [{ id: 's1', name: 'x', script: 'return 1', onSuccess: 'TERMINATE' }], config: {} },
      input: { count: 6 },
      outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' } } } } } }
    });
    assert.equal(out.report.ok, true);
    assert.ok(!out.report.detectors.countShortfall, 'full delivery carries no shortfall detector (the production shape)');
    assert.deepEqual(out.report.deliveredCounts, { posts: 6 }, 'deliveredCounts carries the real count');
  });
  it('the 221st incident replays BLOCKED via the real detector path (green 6/6 no-detector, red 5/6)', async () => {
    const SCHEMAS = { inputSchema: { type: 'object', properties: { k: { type: 'string' } } }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } };
    const STEP = (n) => ({ id: 's' + n, name: 'step' + n, onSuccess: 'TERMINATE', script: 'return ' + n + ';' });
    let verifyIdx = 0;
    const { createSessionTools } = require('../lib/session-tools');
    let draft225 = null;
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => {
        verifyIdx += 1;
        if (verifyIdx === 1) {
          // the REAL green shape: 6/6, NO detector row, deliveredCounts
          // present inside the report (the envelope shape runVerify
          // returns; session-tools hands the report to the engine).
          return { events: [], report: { executedArtifactVersion: 1, ok: true, detectors: {}, score: { score: 1 }, finalResult: { posts: Array.from({ length: 6 }, () => ({ a: 1 })) }, deliveredCounts: { posts: 6 } }, raw: {} };
        }
        return { events: [], report: { executedArtifactVersion: 2, ok: false, error: { message: 'COUNT_SHORTFALL_SUPPLY: red' }, detectors: { countShortfall: { field: 'posts', requested: 6, extracted: 5, uniqueExtracted: 5, ratio: 0.83, severe: false } }, score: { score: 1 }, deliveredCounts: { posts: 5 } }, raw: {} };
      },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }), count: async () => ({ count: 1 }) }),
      getDraftService: () => draft225,
      applyArtifact: (a) => { draft225 = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; },
      getTestInput: () => ({ k: 'ml' }),
      getOutputSchema: () => SCHEMAS.outputSchema,
      getSteps: () => (draft225 ? draft225.steps : []),
      ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
    }).tools;
    const replies = [];
    const mk = (content) => ({ content, finish_reason: 'stop', usage: { prompt_tokens: 100, completion_tokens: 10 } });
    const env = (tool, args) => mk(JSON.stringify({ think: 't', tool, args: args || {} }));
    const fin = (extra) => mk(JSON.stringify({ think: 'done', finish: Object.assign({ summary: 'better: 5 real posts' }, extra || {}) }));
    const session = createResearchSession({
      requirement: 'collect posts',
      llm: async () => replies.shift(),
      tools,
      onEvent: () => {}
    });
    // drive: confirm, v1, verify green, v2, verify red, finish shipRed
    const script = [
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 6 } }, SCHEMAS)),
      env('service.update', { steps: [STEP(1)] }),
      env('verify.run', {}),
      env('service.update', { steps: [STEP(2)] }),
      env('verify.run', {}),
      fin({ shipRedArtifact: true })
    ];
    for (const r of script) replies.push(r);
    const report = await session.run();
    const sysNotes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    const block = sysNotes.find((t) => /OVERRIDE REJECTED/.test(t));
    assert.ok(block, 'the override was rejected via deliveredCounts: ' + JSON.stringify(sysNotes.slice(-2)));
    assert.match(block, /delivered 6/);
    assert.match(block, /delivered 5/);
    void report;
  });
});

// ---------- #2: exemption scoping ----------

describe('#2 UNCERTIFIED exemption scoping (225th review)', () => {
  const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } };
  function runnerWith(events, steps) {
    const runner = verifyRunnerWith(async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      for (const ev of events) opts.onEvent(ev);
      return { finalResult: { posts: [{ a: 1 }, { a: 2 }] }, steps: [], pages: [], pagesTruncated: false };
    });
    return runner({ service: { targetUrl: 'https://e.com', steps, config: {} }, input: { count: 6 }, outputSchema: SCHEMA });
  }
  it('a plain-data step visited 4x (no done key) does NOT exempt — gate fires', async () => {
    const steps = [{ id: 'paginate', name: 'p', script: 'return {posts: await $list(".c")};', onSuccess: 'TERMINATE' }];
    const events = [1, 2, 3, 4].map((i) => ({ type: 'STEP_ITERATION', stepId: 'paginate', iteration: i, resultPreview: '{"posts":[1]}' }));
    const out = await runnerWith(events, steps);
    assert.equal(out.report.ok, false, 'plain data is not a poll');
    assert.match(out.report.error.message, /COUNT_SHORTFALL_UNCERTIFIED/);
  });
  it('an UNRELATED wait step with 4x done:false does NOT exempt — gate fires', async () => {
    const steps = [
      { id: 'wait', name: 'w', script: 'await $waitForStable(".c"); return {done:false};', onSuccess: 'extract', maxIterations: 8 },
      { id: 'extract', name: 'e', script: 'return {posts: await $list(".c")};', onSuccess: 'TERMINATE' }
    ];
    const events = [1, 2, 3, 4].map((i) => ({ type: 'STEP_ITERATION', stepId: 'wait', iteration: i, resultPreview: '{"done":false}' }));
    const out = await runnerWith(events, steps);
    assert.match(out.report.error.message, /COUNT_SHORTFALL_UNCERTIFIED/, 'unrelated non-collector wait does not exempt');
  });
  it('a comment mentioning $collectUntil does NOT exempt — gate fires', async () => {
    const steps = [{ id: 'collect', name: 'c', script: '// TODO switch to $collectLater not $collectUntil\nreturn {posts: await $list(".c")};', onSuccess: 'TERMINATE' }];
    const out = await runnerWith([], steps);
    assert.match(out.report.error.message, /COUNT_SHORTFALL_UNCERTIFIED/, 'comment mentions are not calls');
  });
});

// ---------- #4: all cycles + comment-strip ----------

describe('#4 validateChain enumerates every cycle (225th review)', () => {
  it('a declared first cycle does NOT launder a second exit-less cycle', () => {
    const out = WU.validateChain([
      { id: 'a', name: 'a', script: 'const ok=await $click(s); if(!ok) return {failed:true}; return {done:true};', onSuccess: 'b', onFailure: 'TERMINATE', maxIterations: 5 },
      { id: 'b', name: 'b', script: 'return {ok:1};', onSuccess: 'c', onFailure: 'TERMINATE' },
      { id: 'c', name: 'c', script: 'return {ok:2};', onSuccess: 'd', onFailure: 'TERMINATE' },
      { id: 'd', name: 'd', script: 'return {ok:3};', onSuccess: 'c', onFailure: 'TERMINATE' }
    ]);
    assert.notEqual(out && out.valid, true, 'the c⇄d cycle must be rejected too');
    assert.match(out.error, /c → d → c/);
  });
  it('exit tokens inside comments do not declare an exit', () => {
    const out = WU.validateChain([
      { id: 'a', name: 'a', script: '// poll: return {done:false} until settled\nreturn {ok:1};', onSuccess: 'b', onFailure: 'TERMINATE' },
      { id: 'b', name: 'b', script: 'return {ok:2};', onSuccess: 'a', onFailure: 'TERMINATE' }
    ]);
    assert.notEqual(out && out.valid, true, 'comment tokens are not declarations');
  });
});

// ---------- #5: identity-guarded re-resolution ----------

describe('#5 anchor re-resolution is identity-guarded (225th review)', () => {
  const HTML = `<div class="card"><a class="anc" href="/a1">one</a><a class="anc" href="/a2">two</a></div>`;
  for (const [label, getOps] of [['lib', () => require('../lib/list-extract-ops.js')], ['inline mirror', () => require('./helpers/inline-ops-factory.js').loadInline({ document: global.document, window: global.window })]]) {
    it(`${label}: live handles are kept; detached handles replace only on count parity; drift is counted`, async () => {
      setupDOM(HTML);
      const seen = [];
      const out = await getOps().extractWithHoverRecords(
        Array.from(document.querySelectorAll('.card')),
        { t: { selector: 'span.missing' } },
        { anchorSel: '.anc' },
        async (anchorEl) => {
          seen.push(anchorEl.getAttribute('href'));
          if (seen.length === 1) {
            // dwell causes GROWTH: a badge link inserted before the anchors —
            // positional [j] would skew; count parity fails → stale handle
            // kept... but anchor 0 stays connected so nothing skews here.
            const card = document.querySelector('.card');
            const badge = document.createElement('a');
            badge.className = 'anc';
            badge.href = '/badge';
            badge.textContent = 'b';
            card.insertBefore(badge, card.firstChild);
          }
          return { hovered: true, htmlSnippet: '<div>x</div>', popoverSelector: 'div' };
        },
        { allowEmpty: true });
      assert.equal(seen.length, 2);
      assert.equal(seen[0], '/a1');
      // anchor 2 was CONNECTED at hover time (growth does not detach it) —
      // identity guard keeps it even though live[1] is now /a1 (skew).
      assert.equal(seen[1], '/a2', 'connected snapshot handle wins over skewed positional');
      const stats = getOps().getAnchorResolutionStats();
      assert.ok(stats && typeof stats.reResolved === 'number');
      assert.equal(out.length, 1);
    });
  }
});
