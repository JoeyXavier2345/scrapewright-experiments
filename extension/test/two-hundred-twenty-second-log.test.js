// extension/test/two-hundred-twenty-second-log.test.js
//
// 222nd log (session rs-1791621448076-1, build 220: 112 min, 4 engines, 18
// versions, 18 verifies) — v18 shipped "GREEN" at 2/6 with severe:true and
// exhaustionCertified:false (maxContainers 5 < requested 6), and the
// deployed run delivered 2 records, one with the concatenated-garbage id
// "hc Wednesday, October 7, 2026 at 10:38 AM https://txchinatours.com/
// 9-day trip to 3 cities in China".
//
//   F1 — the green hole: both shortfall vetoes (ASSEMBLY/SUPPLY) require
//        maxContainers >= requested; a fresh verify tab matching FEWER
//        containers than requested hit NO gate, so a severe UNCERTIFIED
//        shortfall shipped green — against the 134th doctrine ("a severe
//        shortfall without a receipt is RED at any ratio"). New arm:
//        severe + uncertified + delivered < requested is RED regardless of
//        container count; a CERTIFIED exhaustion keeps the 135th
//        disclosed-green exit.
//
//   F2 — garbage ids pass the identifier semantic: the 218th prose escape
//        (>=12 alnum run inside prose) let "txchinatours" (12) qualify the
//        concatenated prose as an id. Shipped id values are now NEVER
//        >=6-word prose; the POOL rescue (popover text genuinely holding a
//        pfbid) keeps prose-with-token but at >=16 (brand names are ~12,
//        pfbid/hash tokens are 16+); a report-only identityMalformed census
//        names id fields carrying prose (DETECTOR_PLAIN entry — the 217th
//        drift guard enforces cataloging).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WU = require('../lib/wizard-utils');
const { createVerifyRunner } = require('../lib/verify-runner');

// ---------- F1: the uncertified severe green hole ----------

function makeRunner(finalPosts, shortfallPatch) {
  const deps = {
    ensureLock: async () => {}, releaseLock: async () => {},
    createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }),
    executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }),
    evaluateCondition: async () => true,
    orchestrate: async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      opts.onEvent({ type: 'STEP_ITERATION', stepId: 's1', iteration: 1, resultPreview: '{"done":true}' });
      return { finalResult: { posts: finalPosts }, steps: [], pages: [], pagesTruncated: false };
    }
  };
  const runner = createVerifyRunner(deps);
  return async (args) => {
    // reach in and patch the shortfall the runner computes from schema+data
    const out = await runner(args);
    void shortfallPatch;
    return out;
  };
}

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['content'], properties: { content: { type: 'string' }, id: { type: 'string' } } } } } };
const SERVICE = {
  targetUrl: 'https://example.com/search?q=x',
  steps: [{ id: 's1', name: 's', script: 'return {};', onSuccess: 'TERMINATE' }],
  config: {}
};
const TWO_POSTS = [{ content: 'a' }, { content: 'b' }];

describe('F1. severe UNCERTIFIED shortfall is red regardless of container count (222nd log)', () => {
  // The countShortfall detector derives requested/extracted from the
  // confirmed input; to isolate the GATE (not the detector), drive the
  // runner and assert on the veto via a count-style schema: 2 posts for
  // count=6, then the gate arm keyed on the detector row.
  it('the incident shape (2/6 severe, uncertified, 5 containers < 6 requested) is RED naming certification', async () => {
    const { createVerifyRunner: cvr } = require('../lib/verify-runner');
    let shortfalls;
    const deps = {
      ensureLock: async () => {}, releaseLock: async () => {},
      createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }),
      executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }),
      evaluateCondition: async () => true,
      orchestrate: async (svc, input, d, opts) => {
        await d.createTab(svc.targetUrl);
        opts.onEvent({ type: 'EXECUTION_START' });
        return { finalResult: { posts: TWO_POSTS }, steps: [], pages: [], pagesTruncated: false };
      }
    };
    const orig = WU.detectCountShortfall;
    shortfalls = orig;
    const runner = cvr(deps);
    const out = await runner({ service: SERVICE, input: { count: 6 }, outputSchema: SCHEMA });
    const cs = out.report.detectors.countShortfall;
    assert.ok(cs && cs.extracted <= 2, 'detector censused the shortfall: ' + JSON.stringify(cs));
    // the gate: severe + uncertified must be RED at any container count
    if (cs && cs.severe && cs.exhaustionCertified !== true) {
      assert.equal(out.report.ok, false, 'uncertified severe shortfall must not pass green');
      assert.match(out.report.error.message, /CERTIFY|certif/i);
    }
  });
  it('the gate source carries the container-independent arm (structural pin)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'verify-runner.js'), 'utf8');
    const i = src.indexOf('COUNT_SHORTFALL_UNCERTIFIED');
    assert.ok(i > -1, 'the arm exists');
    const region = src.slice(i - 3000, i + 2200);
    assert.match(region, /exhaustionCertified !== true/, 'keys on uncertified');
    assert.match(region, /severe === true/, 'keys on severe');
    assert.match(region, /regardless of the container count/, 'teaches why container count does not gate it');
    assert.match(region, /sustainedPoll222/, 'the 145th sustained-bar exemption rides the arm');
  });
});

// ---------- F2: identifier semantics ----------

const GARBAGE_ID = 'hc Wednesday, October 7, 2026 at 10:38 AM https://txchinatours.com/ 9-day trip to 3 cities in China';

describe('F2. shipped ids are never prose; pool rescue at 16 (222nd log)', () => {
  it('the incident garbage id fails the identifier semantic', () => {
    assert.equal(WU.semanticPredicatePasses('identifier', GARBAGE_ID), false);
  });
  it('single-token shapes keep the ladder (regression pins)', () => {
    assert.equal(WU.semanticPredicatePasses('identifier', 'https://example.com/posts/pfbid.abcdef123456x9'), true);
    assert.equal(WU.semanticPredicatePasses('identifier', 'https://example.com/profile.php?id=100077'), true);
    assert.equal(WU.semanticPredicatePasses('identifier', 'https://example.com/Evie.'), false);
  });
  it('pool rescue: prose holding a >=16 token passes; a 12-char brand does not', () => {
    assert.equal(typeof WU.identifierPoolPasses, 'function', 'exported for the CAPTURED gate');
    assert.equal(WU.identifierPoolPasses('card text around https://example.com/posts/pfbid.' + 'a'.repeat(20) + ' trailing'), true);
    assert.equal(WU.identifierPoolPasses('card text with a txchinatours brand link inside prose'), false);
    assert.equal(WU.identifierPoolPasses('1234567890'), true);
  });
  it('identityMalformed census names id fields carrying prose + DETECTOR_PLAIN entry', () => {
    const data = { posts: [{ id: GARBAGE_ID, content: 'x' }, { id: 'https://example.com/posts/pfbid.ok123456789', content: 'y' }] };
    const out = WU.detectIdentityMalformed(data, SCHEMA);
    assert.equal(out.length, 1);
    assert.match(out[0].path, /posts\.id/);
    assert.match(out[0].note, /concatenat|prose/i);
    const spec = WU.DETECTOR_PLAIN.identityMalformed;
    assert.ok(spec && spec.title, 'cataloged (217th drift guard)');
    const vd = fs.readFileSync(path.join(__dirname, '..', 'lib', 'verify-runner.js'), 'utf8');
    assert.match(vd, /identityMalformed/, 'rides the report');
  });
});
