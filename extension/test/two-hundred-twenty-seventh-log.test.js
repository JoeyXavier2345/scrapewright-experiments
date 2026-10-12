// extension/test/two-hundred-twenty-seventh-log.test.js
//
// 227th log (session rs-1791681881708-1, build 226, 33 min, completed with
// a disclosed no-green ship). The gates all fired correctly — ZERO_COUNTER
// breaker on the v1 hand-rolled count loop, DUPLICATE_ID_REQUIRED with the
// samplesDiffer teaching on v4's regex-extracted id ("2CP-R" ×2), the
// implausible-time census naming postTime="Ad" 6/6 — but ONE verify names
// ONE required-field defect: the model fixes the id, burns another 90s
// verify, and only then discovers the postTime veto (which was in the
// detectors all along). Under time pressure it shipped both disclosed.
//
// Fix: when a required-field veto already fired, the OTHER required-field
// violation classes append a one-line ALSO RED cross-reference to the same
// error — a single verify teaches everything to fix together.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyRunner } = require('../lib/verify-runner');

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['id', 'postTime', 'content'],
  properties: { id: { type: 'string' }, postTime: { type: 'string' }, content: { type: 'string' } } } } } };

function makeRunner(posts) {
  return createVerifyRunner({
    ensureLock: async () => {}, releaseLock: async () => {},
    createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }),
    executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }),
    evaluateCondition: async () => true,
    getSignal: () => null, log: () => {}, onEvent: () => {},
    orchestrate: async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      return { finalResult: { posts }, steps: [], pages: [], pagesTruncated: false };
    }
  });
}

const RUN = {
  service: { targetUrl: 'https://example.com/', steps: [{ id: 's1', name: 's', script: 'return {};', onSuccess: 'TERMINATE' }], config: {} },
  input: { count: 6 }, outputSchema: SCHEMA
};

// the 227th shape: duplicated id + postTime="Ad" on every record
const POSTS_227 = [
  { id: '2CP-R', postTime: 'Ad', content: 'Get a FREE 132 Page Coastal Travel Guide' },
  { id: 'zionpark', postTime: 'Ad', content: 'Water slides, a lazy river' },
  { id: '2CP-R', postTime: 'Ad', content: 'In the next 24 hours I am catching three' },
  { id: 'lakepowell', postTime: 'Ad', content: 'Lake Powell houseboat week recap' },
  { id: 'roadtrip', postTime: 'Ad', content: 'The ultimate desert road trip map' },
  { id: 'camping', postTime: 'Ad', content: 'Best camping spots near the canyon' }
];

describe('227th round — one verify teaches ALL required-field vetoes', () => {
  it('DUPLICATE_ID fires AND the message cross-references the postTime shape veto', async () => {
    const runner = makeRunner(POSTS_227);
    const out = await runner(RUN);
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /DUPLICATE_ID_REQUIRED/);
    assert.match(out.report.error.message, /ALSO RED — fix together/);
    // 241st round: the implausible-time cross-reference now rides as the
    // composed TIME_SHAPE_VIOLATION gate (full decoy-read teaching) instead
    // of the old one-line census — same class coverage, richer exit.
    assert.match(out.report.error.message, /TIME_SHAPE_VIOLATION: posts\.postTime/);
    assert.match(out.report.error.message, /"Ad"/);
  });
  it('when the time veto fires first, the duplicate id rides the cross-reference', async () => {
    const runner = makeRunner(POSTS_227);
    const out = await runner(RUN);
    // ordering depends on gate sequence; assert the OTHER class is present either way
    const msg = out.report.error.message;
    assert.ok(/DUPLICATE_ID_REQUIRED/.test(msg) || (/ALSO RED/.test(msg) && /repeats/.test(msg)),
      'both classes visible in one receipt: ' + msg.slice(0, 160));
  });
  it('a single-defect run carries no ALSO RED line (regression pin)', async () => {
    const mk227 = (i, when) => ({ id: 'https://example.com/posts/pfbid.ok' + i, postTime: when, content: 'organic post number ' + i });
    const posts = [
      mk227(1, 'Friday, October 9, 2026 at 8:29 PM'),
      mk227(2, 'Saturday, October 10, 2026 at 9:12 AM'),
      mk227(3, 'Friday, October 9, 2026 at 10:01 AM'),
      mk227(4, 'Thursday, October 8, 2026 at 7:45 PM'),
      mk227(5, 'Wednesday, October 7, 2026 at 6:30 AM'),
      mk227(6, 'Tuesday, October 6, 2026 at 5:15 PM')
    ];
    const runner = makeRunner(posts);
    const out = await runner(RUN);
    assert.equal(out.report.ok, true, 'clean records stay green: ' + JSON.stringify(out.report.error || {}));
    assert.ok(!/ALSO RED/.test(String((out.report.error || {}).message || '')));
  });
});
