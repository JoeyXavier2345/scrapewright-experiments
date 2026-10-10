// extension/test/two-hundred-twenty-sixth-log.test.js
//
// 226th log (session rs-1791645560949-1, build 225, 80 turns, maxTurns
// death): two FAMILY_MISS verifies (15:37/15:43, hovered 5-7 anchors, 0
// popovers on the cold verify tab) carried NO WARM-vs-COLD contrast —
// although the census timeHover at 15:21 had captured a FULL absolute
// ("Friday, October 9, 2026 at 8:29 PM") on the warm research tab. The
// 224th contrast keyed ONLY on sessionEvidence.popoverSamples; the warm
// evidence of this session lived in tooltipRoute (census absolute), so the
// model got a bare negative and burned its remaining budget rewriting
// anchors/containers until the final verify matched ZERO containers
// (SELECTOR_OVERFILTERED).
//
//   A. the contrast fires on EITHER warm-evidence channel (popover LRU or
//      tooltipRoute.lastFullAbsolute), quoting whichever proof exists.
//   B. probe.timestamp ran its hover dance on the bare rail default (30s)
//      — the 15:37 call died SANDBOX_DEADLINE mid-dance. It now passes a
//      hover-aware 60s budget (caller timeoutMs honored, capped).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createVerifyRunner } = require('../lib/verify-runner');

const FM_EVENT = {
  type: 'STEP_ITERATION', stepId: 's3',
  selectorDiagnostics: [{
    api: 'extractWithHover', anchorSel: 'h2 span a',
    hoverSummary: { anchorsFound: 5, hovercardsCaptured: 0, processedContainers: 4 },
    anchorCensus: { families: { a: 33 }, hrefSamples: ['https://example.com/profile.php?id=1'] }
  }]
};

function makeRunner() {
  const orchestrate = async (svc, input, d, opts) => {
    const tab = await d.createTab(svc.targetUrl);
    await d.waitForTabLoad(tab.id);
    opts.onEvent(FM_EVENT);
    return {
      finalResult: { posts: [{ content: 'x' }] },
      steps: [{ stepId: 's3', stepName: 'extract', result: { done: true }, snapshot: null }],
      pages: [], pagesTruncated: false
    };
  };
  return createVerifyRunner({
    orchestrate, ensureLock: async () => {}, getSignal: () => null, log: () => {}, onEvent: () => {},
    createTab: async (url) => ({ id: 11, url }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true
  });
}

const RUN = {
  service: { targetUrl: 'https://example.com', steps: [{ id: 's3', name: 'extract', script: 'return 1', onSuccess: 'TERMINATE' }], config: {} },
  input: {}, outputSchema: { type: 'object', properties: { posts: { type: 'array', items: { type: 'object' } } } }
};

describe('A. the warm-vs-cold contrast fires on EITHER warm channel (226th log)', () => {
  it('census-absolute-only evidence (empty popoverSamples) draws the contrast naming the absolute', async () => {
    const runner = makeRunner();
    const out = await runner(Object.assign({}, RUN, {
      sessionEvidence: { probeTimestampCalls: 1, lastFullAbsolute: 'Friday, October 9, 2026 at 8:29 PM', popoverSamples: [] }
    }));
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /WARM-vs-COLD/);
    assert.match(out.report.error.message, /FULL absolute timestamp captured via hover/);
    assert.match(out.report.error.message, /Friday, October 9/);
    assert.match(out.report.error.message, /do NOT abandon the hover route/);
  });
  it('popover-sample evidence keeps the original contrast shape (regression pin)', async () => {
    const runner = makeRunner();
    const out = await runner(Object.assign({}, RUN, {
      sessionEvidence: { probeTimestampCalls: 0, lastFullAbsolute: null, popoverSamples: ['warm card text sample'] }
    }));
    assert.match(out.report.error.message, /WARM-vs-COLD/);
    assert.match(out.report.error.message, /popover sample/);
  });
  it('no warm evidence on either channel stays silent (regression pin)', async () => {
    const runner = makeRunner();
    const out = await runner(Object.assign({}, RUN, {
      sessionEvidence: { probeTimestampCalls: 3, lastFullAbsolute: null, popoverSamples: [] }
    }));
    assert.doesNotMatch(out.report.error.message, /WARM-vs-COLD/);
  });
});

describe('B. probe.timestamp runs the dance on a hover-aware budget (226th log)', () => {
  it('the call passes a budget to runSnippet — default 60s, caller timeoutMs honored (source pin)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'probe-tools.js'), 'utf8');
    const i = src.indexOf('226th log: the dance ran on the bare rail default');
    assert.ok(i > -1, 'the fix marker exists');
    const region = src.slice(i, i + 800);
    assert.match(region, /runSnippet\(snippet, hoverBudget226\)/, 'budget forwarded');
    assert.match(region, /: 60000/, 'hover-aware default');
    assert.match(region, /SNIPPET_MAX_TIMEOUT_MS/, 'caller timeoutMs capped like snippet');
  });
});
