// extension/test/two-hundred-fortieth-log.test.js
//
// 240th log (session rs-1791809802354-1, build 239). The 239th teaching
// landed — the model DID hover time anchors this time (per-record
// `await $timestamp(...)` inside a for-loop) — and the step died
// SANDBOX_DEADLINE: hoverAwareTimeoutMs counted ONLY syntactic
// $extractWithHover call sites, so one loop-wrapped $timestamp sized the
// budget as if a single hover ran (the PER_RECORD_TIMESTAMP lint had
// warned; advisories get ignored — the budget must defend for the script
// AS WRITTEN). v1 before it burned a full verify on a count-selector
// blind poll (known teaching), and the model finished honestly with no
// green and no turns left.
//
//   A. hoverAwareTimeoutMs counts ALL hover-family wall drivers and
//      multiplies loop-body call sites by ten (the lint's own
//      "10-record loop" arithmetic). The 233rd extractWithHover-only
//      ladder is preserved verbatim.
//   B. A SANDBOX_DEADLINE verify error now carries the budget arithmetic
//      and the batch/split exits — the bare deadline text named none.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const WU = require('../lib/wizard-utils');
const { createVerifyRunner } = require('../lib/verify-runner');

describe('240th round — loop-aware hover budget', () => {
  const step = (script) => [{ id: 's1', name: 's', script, onSuccess: 'TERMINATE' }];
  it('A: a $timestamp inside a loop costs ten seats; plain calls keep the 233rd ladder', () => {
    // 233rd ladder preserved (no loops, extractWithHover only)
    const mk = (n) => step('const pre = 1; ' + Array.from({ length: n }, (_, i) => 'await $extractWithHover(s' + i + ',{});').join(''));
    assert.equal(WU.hoverAwareTimeoutMs(mk(0), 30000), 30000);
    assert.equal(WU.hoverAwareTimeoutMs(mk(1), 30000), 120000);
    assert.equal(WU.hoverAwareTimeoutMs(mk(3), 30000), 270000);
    assert.equal(WU.hoverAwareTimeoutMs(mk(5), 30000), 300000);
    // 240th: the incident shape — one loop-wrapped $timestamp
    // (30000 × 10 = 300000 → the 300s cap instead of the old 30s base)
    const loopTs = step('for (const c of cards) { const t = await $timestamp(c, {}); }');
    assert.equal(WU.hoverAwareTimeoutMs(loopTs, 30000), 300000);
    // plain (non-loop) $timestamp still counts its own seat, no 120s floor for the first one... floor applies when any hover budget exists
    const plainTs = step('const a = await $timestamp(c1, {}); const b = await $timestamp(c2, {});');
    assert.equal(WU.hoverAwareTimeoutMs(plainTs, 30000), 120000); // 2×30000=60000 → floored to 120000
    // a loop-wrapped $hover: 10000×10 = 100000 → floored to 120000
    const loopHover = step('while (i < n) { await $hover(a[i]); i++; }');
    assert.equal(WU.hoverAwareTimeoutMs(loopHover, 30000), 120000);
    // comments do not fake loop spans (comment-stripped before scanning)
    const fakeLoop = step('// for (x of y) { await $timestamp(x); }');
    assert.equal(WU.hoverAwareTimeoutMs(fakeLoop, 30000), 30000);
  });
});

describe('240th round — SANDBOX_DEADLINE verify error carries the exits', () => {
  it('B: the deadline error names the budget, read:hoverPopover batching, and containerRange', async () => {
    const runner = createVerifyRunner({
      ensureLock: async () => {}, releaseLock: async () => {},
      createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
      getSignal: () => null, log: () => {}, onEvent: () => {},
      orchestrate: async (svc, input, d, opts) => {
        await d.createTab(svc.targetUrl);
        opts.onEvent({ type: 'EXECUTION_START' });
        const err = new Error('SANDBOX_DEADLINE: the script exceeded its own execution budget and was abandoned in the sandbox (the caller already timed out) — in-flight $ calls were rejected.');
        err.stepId = 'extract';
        throw err;
      }
    });
    const out = await runner({
      service: { targetUrl: 'https://e.com', steps: [{ id: 'extract', name: 'e', script: 'return 1;', onSuccess: 'TERMINATE' }], config: { timeoutMs: 120000 } },
      input: { count: 6 },
      outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } },
      sessionEvidence: {}
    });
    assert.equal(out.report.ok, false);
    const msg = String(out.report.error.message);
    assert.match(msg, /SANDBOX_DEADLINE/);
    assert.match(msg, /120000ms budget/);
    assert.match(msg, /ten seats/);
    assert.match(msg, /read:'hoverPopover'/);
    assert.match(msg, /containerRange/);
    assert.equal(out.report.error.stepId, 'extract', 'the stepId survives the note append');
  });
});
