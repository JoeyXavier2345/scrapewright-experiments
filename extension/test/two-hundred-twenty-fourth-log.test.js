// extension/test/two-hundred-twenty-fourth-log.test.js
//
// 224th log (session rs-1791633756884-1, build 223). The user watched the
// final verify mount ZERO popovers — because the final artifact had
// ABANDONED the hover route entirely (pure $extractList + aria/labelledby)
// after the 12:29-12:55 hover batches failed (no_hover_signal_early_exit,
// popover_timeout, 0 captured; dispatch layer healthy — every hover_request
// dispatched:true with per-anchor-varying coordinates, validating the 223rd
// re-resolution). The model chose anchors that worked on the WARM research
// tab; the FRESH verify tab mounted no popovers for them — but no receipt
// ever told it the difference, so it concluded "hover route does not work"
// and pivoted to weaker routes (postTime then shipped as an aria label and
// failed TIME_SHAPE_VIOLATION with "Ad").
//
// Fix: the FAMILY_MISS lane (and its BLIND sibling) appends a WARM-vs-COLD
// contrast when the SESSION's popover-capture evidence (sessionEvidence.
// popoverSamples, already passed through since the 87th round) is
// non-empty: name a warm sample, teach that a fresh tab mounting 0 for the
// same family is cold-tab hover divergence — keep the anchor family,
// preflight warm, ship via preflight evidence with the cold-tab limit
// disclosed, instead of abandoning the hover route.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyRunner } = require('../lib/verify-runner');

const FM_EVENT = {
  type: 'STEP_ITERATION', stepId: 's3',
  selectorDiagnostics: [{
    api: 'extractWithHover', anchorSel: 'h2 span a',
    hoverSummary: { anchorsFound: 5, hovercardsCaptured: 0, processedContainers: 8 },
    anchorCensus: { families: { a: 29, 'a[href]': 29 }, hrefSamples: ['https://example.com/profile.php?id=1'] }
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

describe('224th round — FAMILY_MISS carries the warm-vs-cold contrast', () => {
  it('with session popover evidence the error names the divergence + a warm sample + the keep-route exits', async () => {
    const runner = makeRunner();
    const out = await runner(Object.assign({}, RUN, {
      sessionEvidence: { probeTimestampCalls: 2, lastFullAbsolute: null, popoverSamples: ['Warm page card sample text with name and follower count'] }
    }));
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /HOVER_ANCHORS_FAMILY_MISS/);
    assert.match(out.report.error.message, /WARM-vs-COLD/i);
    assert.match(out.report.error.message, /cold-tab hover divergence/i);
    assert.match(out.report.error.message, /Warm page card sample/);
    assert.match(out.report.error.message, /preflight/i);
    assert.match(out.report.error.message, /instead of abandoning the hover route|do NOT abandon/i);
  });
  it('without session evidence the lane is unchanged (regression pin)', async () => {
    const runner = makeRunner();
    const out = await runner(RUN);
    assert.match(out.report.error.message, /HOVER_ANCHORS_FAMILY_MISS/);
    assert.doesNotMatch(out.report.error.message, /WARM-vs-COLD/);
  });
});
