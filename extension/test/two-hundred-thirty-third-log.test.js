// extension/test/two-hundred-thirty-third-log.test.js
//
// 233rd log (session rs-1791729939699-1, build 232). The v1 verify
// returned ok:true (GREEN) over ZERO records — 0/10, score 0, isData —
// because certified exhaustion + maxContainers(1) < requested(10) skipped
// every veto arm; it then became greenArtifactVersion, and the maxTurns
// death detail pointed "[LAST GREEN = v1 — restoreVersion:1]" at a
// ZERO-RECORD artifact. The certification itself came from a
// $collectUntil stall on a near-empty (1-container) verify tab — starved
// evidence per the 230th directive (the user's ground truth: scrolling
// loads more posts).
//
//   A. ZERO_DELIVERED: a verify shipping 0 of a requested count is RED
//      regardless of certification; the starved-certification case is
//      named; the genuine-zero exit routes to INPUT_VALUE_SUSPECT /
//      discrimination / io.confirm renegotiation.
//   B. the engine never sets greenArtifactVersion from a zero-delivered
//      verify (the restore pointer can never name a zero-record version).
//   C. hoverAwareTimeoutMs scales with the COUNT of $extractWithHover
//      calls — the v2 hover step's three sequential calls exceeded the
//      flat 120s and died SANDBOX_DEADLINE.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyRunner } = require('../lib/verify-runner');
const WU = require('../lib/wizard-utils');

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } };

function runnerWith(posts) {
  const runner = createVerifyRunner({
    ensureLock: async () => {}, releaseLock: async () => {},
    createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
    getSignal: () => null, log: () => {}, onEvent: () => {},
    orchestrate: async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      opts.onEvent({ type: 'STEP_ITERATION', stepId: 's1', iteration: 1, resultPreview: '{"done":true,"collectUntil":{"certified":true,"collected":1}}', selectorDiagnostics: [{ api: 'collectUntil', certified: true, collected: 1, targetCount: 10, finalCount: 1 }] });
      // posts===undefined reproduces the REAL v1: the terminal (hover) step
      // returned {done, hoverData} — the posts key absent entirely.
      const finalResult = (posts === undefined) ? { done: true, hoverData: [] } : { posts };
      return { finalResult, steps: [], pages: [], pagesTruncated: false };
    }
  });
  return runner({ service: { targetUrl: 'https://e.com', steps: [{ id: 's1', name: 's', script: 'await $collectUntil(".c",{targetCount:10}); return {done:true};', onSuccess: 'TERMINATE' }], config: {} }, input: { count: 10 }, outputSchema: SCHEMA });
}

describe('A. the REAL incident: terminal step returns the wrong shape (233rd log)', () => {
  it('RESULT_KEY_MISSING — the schema-required [posts] absent from the result is RED naming the graph fix', async () => {
    const out = await runnerWith(undefined); // undefined posts → finalResult {done,hoverData} — the real v1 shape
    assert.equal(out.report.ok, false, 'green over a missing required key');
    assert.match(out.report.error.message, /RESULT_KEY_MISSING/);
    assert.match(out.report.error.message, /TERMINAL step/);
    assert.match(out.report.error.message, /no \[posts\] at all/);
  });
  it('ZERO_DELIVERED — key present but 0 items is RED (EMPTY_EXTRACTION owns this shape; the zero gate owns the key-missing shape)', async () => {
    const out = await runnerWith([]);
    assert.equal(out.report.ok, false, '0-of-N is never green');
    assert.match(out.report.error.message, /ZERO_DELIVERED|EMPTY_EXTRACTION/, 'a zero-count veto fires: ' + (out.report.error || {}).message.slice(0, 80));
  });
  it('a nonzero certified shortfall keeps the 135th disclosed-green exit (regression pin)', async () => {
    const out = await runnerWith(Array.from({ length: 4 }, (_, i) => ({ id: 'p' + i })));
    assert.equal(out.report.ok, true, '4/10 certified stays green: ' + JSON.stringify(out.report.error || {}));
  });
});

describe('B. the engine never greens a zero-delivered verify (233rd log, source pin)', () => {
  it('greenArtifactVersion requires delivered > 0', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    const i = src.indexOf('233rd: a zero-delivered verify is never the green restore target');
    assert.ok(i > -1);
    const region = src.slice(i - 200, i + 200);
    assert.match(region, /delivered225 !== 0/, 'the guard keys on delivered');
  });
});

describe('C. hoverAwareTimeoutMs scales with the call count (233rd log)', () => {
  const mk = (n) => [{ script: 'const pre = 1; ' + Array.from({ length: n }, (_, i) => 'await $extractWithHover(s' + i + ',{});').join('') }];
  it('0 calls → base; 1 call → 120s; 3 calls → 270s; 5+ calls → 300s cap', () => {
    assert.equal(WU.hoverAwareTimeoutMs(mk(0), 30000), 30000);
    assert.equal(WU.hoverAwareTimeoutMs(mk(1), 30000), 120000);
    assert.equal(WU.hoverAwareTimeoutMs(mk(3), 30000), 270000);
    assert.equal(WU.hoverAwareTimeoutMs(mk(5), 30000), 300000);
    assert.equal(WU.hoverAwareTimeoutMs(mk(9), 30000), 300000);
  });
  it('the step-executor path honors it (a 3-call step is not killed at 120s — source pin)', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'wizard-utils.js'), 'utf8');
    const i = src.indexOf('233rd log: sequential $extractWithHover calls ADD');
    assert.ok(i > -1, 'the marker exists');
    // 240th log: the sizing grew from calls233*90000 to the family ladder —
    // extractWithHover keeps its 90s seat verbatim inside HOVER_COST_240.
    assert.match(src, /extractWithHover: 90000/, '90s per extractWithHover call (HOVER_COST_240)');
  });
});
