// extension/test/hover-family-miss.test.js
//
// 202nd log (session rs-1791389593210-1, SHELL_ENTRIES death): the census
// timeHover had ALREADY captured author-card text on entity links
// (comecomeletstravel, "Media/News Company…") — but the artifact anchored
// $extractWithHover on MEDIA permalinks (/reel/, /photo/…), a different
// anchor family on which author/group cards never mount. observedPopover
// stayed 0 across 624 discover cycles; the picker grabbed remount noise;
// the model faked hoverCards from aria and SHELL_ENTRIES correctly vetoed.
// The user (eyes on screen) never saw an author/group popover — matching
// the evidence: wrong ANCHOR FAMILY, not broken hover machinery.
//
// Fixes pinned here:
//   A. cardAnchors — the census/timestamp receipt derives which anchors
//      MOUNTED popover text (captured + addedTexts non-empty), labeled as
//      the hoverCard anchor families. Pure evidence, zero vocabulary.
//   B. HOVER_ANCHORS_FAMILY_MISS — the sibling of HOVER_ANCHORS_BLIND for
//      anchors-found-but-no-popovers, with the anchor census embedded.
//   C. the content-script anchor census now also computes on
//      zero-capture batches (it was blind-only).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WU = require('../lib/wizard-utils');

const ANCHOR_LOG = [
  { anchor: 0, desc: null, href: 'https://example.com/comecomeletstravel', hovered: true, captured: true, reason: null, addedNodes: 3, addedTexts: [] },
  { anchor: 1, desc: '走咯 我们吃喝旅行去', href: 'https://example.com/comecomeletstravel', hovered: true, captured: true, reason: null, addedNodes: 3, addedTexts: [] },
  { anchor: 2, desc: 'Following', href: 'https://example.com/comecomeletstravel', hovered: true, captured: false, reason: 'no_hover_signal_early_exit', addedNodes: 3, addedTexts: ['走咯 我们吃喝旅行去', '走咯 我们吃喝旅行去 Media/News Company · Petaling Jaya'] }
];

describe('A. deriveCardAnchors — anchors whose hover MOUNTED popover text (202nd log)', () => {
  const { deriveCardAnchors } = require('../lib/probe-tools');
  it('lists only entries that captured AND mounted text, with desc/href/texts', () => {
    const r = deriveCardAnchors(ANCHOR_LOG);
    assert.ok(Array.isArray(r));
    assert.equal(r.length, 1, 'only anchor 2 has addedTexts; captured-but-textless entries are not card anchors');
    assert.equal(r[0].anchor, 2);
    assert.match(r[0].href, /comecomeletstravel/);
    assert.equal(r[0].texts.length, 2);
  });
  it('no text-bearing captures → empty array (not an error)', () => {
    assert.deepEqual(deriveCardAnchors(ANCHOR_LOG.slice(0, 2)), []);
    assert.deepEqual(deriveCardAnchors([]), []);
    assert.deepEqual(deriveCardAnchors(null), []);
  });
  it('source audit: probe.timestamp and census receipts attach cardAnchors', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'probe-tools.js'), 'utf8');
    const i = src.indexOf('anchorLog: anchorLog');
    assert.ok(i > -1);
    assert.match(src.slice(i, i + 900), /cardAnchors/, 'the receipt exposes the derived lane beside anchorLog');
  });
});

describe('B. detectHoverFamilyMiss — anchors found, popovers never mounted (202nd log)', () => {
  const ev = (over) => [{
    type: 'STEP_ITERATION', stepId: 's3',
    selectorDiagnostics: [Object.assign({
      api: 'extractWithHover', anchorSel: "a[href*='/reel/']",
      hoverSummary: { anchorsFound: 5, hovercardsCaptured: 0, processedContainers: 8 },
      anchorCensus: { families: { a: 29, 'a[href]': 29 }, hrefSamples: ['https://example.com/somepage', 'https://example.com/profile.php?id=1'] }
    }, over || {})]
  }];
  it('fires when anchors were found but zero popovers mounted', () => {
    const r = WU.detectHoverFamilyMiss(ev());
    assert.ok(r, 'family miss detected');
    assert.equal(r.stepId, 's3');
    assert.equal(r.anchorsFound, 5);
    assert.equal(r.hovercardsCaptured, 0);
  });
  it('partial captures do not fire (some popovers mounted — a different problem class)', () => {
    assert.equal(WU.detectHoverFamilyMiss(ev({ hoverSummary: { anchorsFound: 5, hovercardsCaptured: 2, processedContainers: 8 } })), null);
  });
  // 211th review F8: aggregation is per STEP TOTAL — a mixed step (one call
  // captured 0, a sibling call captured 4 on the same family) is a partial-
  // capture step, not a family miss.
  it('a MIXED step (one zero-capture call + one capturing call) does NOT fire', () => {
    const events = [{
      type: 'STEP_ITERATION', stepId: 's3',
      selectorDiagnostics: [
        { api: 'extractWithHover', anchorSel: "a[href*='/reel/']", hoverSummary: { anchorsFound: 5, hovercardsCaptured: 0, processedContainers: 4 }, anchorCensus: { families: { a: 29 }, hrefSamples: [] } },
        { api: 'extractWithHover', anchorSel: "a[href*='/reel/']", hoverSummary: { anchorsFound: 5, hovercardsCaptured: 4, processedContainers: 4 } }
      ]
    }];
    const r = WU.detectHoverFamilyMiss(events);
    assert.equal(r, null, 'the step total (4 captured) is not a family miss');
  });
  it('total-zero ACROSS calls still fires, and the census rides from any call', () => {
    const events = [{
      type: 'STEP_ITERATION', stepId: 's3',
      selectorDiagnostics: [
        { api: 'extractWithHover', anchorSel: 'h3 a', hoverSummary: { anchorsFound: 5, hovercardsCaptured: 0, processedContainers: 4 } },
        { api: 'extractWithHover', anchorSel: 'h3 a', hoverSummary: { anchorsFound: 3, hovercardsCaptured: 0, processedContainers: 4 }, anchorCensus: { families: { a: 29 }, hrefSamples: ['https://example.com/p/1'] } }
      ]
    }];
    const r = WU.detectHoverFamilyMiss(events);
    assert.ok(r, 'total zero across both calls fires');
    assert.equal(r.anchorsFound, 8, 'anchors accumulate across calls');
    assert.equal(r.hovercardsCaptured, 0);
    assert.ok(r.anchorCensus, 'the census from the second call is kept');
  });
  it('zero anchors is BLIND territory, not family-miss', () => {
    assert.equal(WU.detectHoverFamilyMiss(ev({ hoverSummary: { anchorsFound: 0, hovercardsCaptured: 0, processedContainers: 8 } })), null);
  });
  it('verify-runner emits HOVER_ANCHORS_FAMILY_MISS with the census embedded (red error, BLIND sibling)', async () => {
    const { createVerifyRunner } = require('../lib/verify-runner');
    const orchestrate = async (svc, input, d, opts) => {
      const tab = await d.createTab(svc.targetUrl);
      await d.waitForTabLoad(tab.id);
      opts.onEvent(ev()[0]);
      return {
        finalResult: { posts: [{ content: 'x' }] },
        steps: [{ stepId: 's3', stepName: 'extract', result: { done: true }, snapshot: null }],
        pages: [], pagesTruncated: false
      };
    };
    const runner = createVerifyRunner({
      orchestrate, ensureLock: async () => {}, getSignal: () => null, log: () => {}, onEvent: () => {},
      createTab: async (url) => ({ id: 11, url }), removeTab: async () => {}, waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true
    });
    const out = await runner({
      service: { targetUrl: 'https://example.com', steps: [{ id: 's3', name: 'extract', script: 'return 1', onSuccess: 'TERMINATE' }], config: {} },
      input: {}, outputSchema: { type: 'object', properties: { posts: { type: 'array', items: { type: 'object' } } } }
    });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /HOVER_ANCHORS_FAMILY_MISS/);
    assert.match(out.report.error.message, /entity/, 'teaches the entity-vs-permalink anchor distinction');
    assert.match(out.report.error.message, /href samples|anchor census/i, 'the census contrast is embedded');
  });
});

describe('C. anchor census also computes on zero-capture batches (202nd log)', () => {
  it('source audit: the blind-only condition gained the family-miss arm', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = src.indexOf('_diagnostics.anchorCensus = computeAnchorCensus');
    assert.ok(i > -1);
    const cond = src.slice(Math.max(0, i - 1000), i);
    assert.match(cond, /hovercardsCaptured\s*===\s*0/, 'census runs when captures are zero even with anchors found');
  });
});
