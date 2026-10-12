// extension/test/two-hundred-thirty-seventh-log.test.js
//
// 237th log (session rs-1791779529734-1, build 235, user report: the
// popovers opened on the page — time and author cards visible — yet the
// shipped result carried postTime "2 days ago"/"August 15" for 4/6 records
// and likeCount/commentCount/shareCount as hardcoded '' in 6/6). Root cause
// adjudicated against the log: the final artifact v3 hardcodes
// `likeCount:'', commentCount:'', shareCount:''` (no fieldMap entry — the
// update-time staticLint named all three, advisory-only), and postTime falls
// back to the visible relative text whenever the hover batch missed the
// timestamp popover. The green verify fired FIVE advisory signals
// (RELATIVE_TIMESTAMP with mixedCompleteness — its own note says "the partial
// card(s) are capture failures, not page truth" — plus PARTIAL_EMPTY_FIELDS
// naming the counts 6/6) and shipped anyway: red vetoes get fixed, advisories
// get ignored. But the requirement text EXPLICITLY lists 点赞数、评论数、
// 转发数 among the fields to return, and designates the 时间戳悬浮窗 as the
// postTime source. When the requirement itself mandates the data/source, an
// advisory-only lane is not a sanctioned exit — same family as the 236th's
// REQUIREMENT_EXPAND_DROPPED.
//
//   A. REQUIREMENT_FIELD_DROPPED: schema field carried ONLY as hardcoded
//      literals + empty on ALL records + requirement names its data
//      category (点赞数 → likeCount) → RED naming the field and the
//      binding exit. Multiple dropped fields join one error.
//   B. REQUIREMENT_TIME_SOURCE_DROPPED: relativeTimestamps shows FULL
//      absolutes coexisting with relative/partial (capture failures, not
//      page truth) + requirement designates the popover timestamp as the
//      time source → RED; disclosure alone is not the exit.
//   C. No requirementText (legacy callers) → both lanes stay advisory.
//   D. A category the requirement itself waives (地点（可能有）) does not
//      veto — the user pre-authorized its absence.
//   E. An ALL-relative population (zero full absolutes — the route proved
//      nothing on this page) keeps the ladder's bounded-hunt/disclose
//      exits: no veto.
//   F. Composition: the 236th expand veto and the 237th field veto ride
//      ONE error (ALSO RED — fix together, not one verify at a time).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyRunner } = require('../lib/verify-runner');

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['content'], properties: {
    content: { type: 'string' }, postTime: { type: 'string' },
    likeCount: { type: 'string' }, commentCount: { type: 'string' }, shareCount: { type: 'string' },
    location: { type: 'string' } } } } } };

const REC = (over) => Object.assign({ content: 'A full post body with no truncation tail #' + Math.random().toString(36).slice(2, 8) + '.', postTime: 'November 3, 2025', likeCount: '', commentCount: '', shareCount: '', location: '' }, over || {});
const RECORDS_A = [REC(), REC({ postTime: 'August 4, 2024' }), REC({ postTime: 'October 12, 2026' }), REC(), REC({ postTime: 'August 4, 2024' }), REC({ postTime: 'October 12, 2026' })];
const RECORDS_B = [
  REC({ postTime: 'November 3, 2025', likeCount: '31K', commentCount: '96', shareCount: '12' }),
  REC({ postTime: 'August 4, 2024', likeCount: '185', commentCount: '9', shareCount: '3' }),
  REC({ postTime: 'August 15', likeCount: '42', commentCount: '2', shareCount: '1' }),
  REC({ postTime: 'September 11', likeCount: '7', commentCount: '1', shareCount: '0' }),
  REC({ postTime: '2 days ago', likeCount: '519', commentCount: '33', shareCount: '8' }),
  REC({ postTime: '3 days ago', likeCount: '88', commentCount: '6', shareCount: '2' })
];
const RECORDS_E = [REC({ postTime: '2 days ago' }), REC({ postTime: '3 days ago' }), REC({ postTime: 'yesterday' }), REC({ postTime: '5 hours ago' })];

// The incident shape: counts appear ONLY as `field:''` literals in the push.
const EXTRACT_LITERALS = [
  "const rs = await $extractList('div[role=feed] > div', {content:{selector:'div.msg'}, postTime:{selector:'span.ts'}});",
  "const posts = [];",
  "for (const r of rs) { posts.push({content: r.content, postTime: r.postTime, likeCount:'', commentCount:'', shareCount:'', location: r.loc || ''}); }",
  'return {posts};'
].join('\n');

function makeRunner(steps, records, sessionEvidence) {
  const runner = createVerifyRunner({
    ensureLock: async () => {}, releaseLock: async () => {},
    createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
    getSignal: () => null, log: () => {}, onEvent: () => {},
    orchestrate: async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      return { finalResult: { posts: records }, steps: [], pages: [], pagesTruncated: false };
    }
  });
  return runner({ service: { targetUrl: 'https://e.com', steps, config: {} }, input: { count: 6 }, outputSchema: SCHEMA, sessionEvidence });
}

const STEP = (script) => [{ id: 's1', name: 's', script, onSuccess: 'TERMINATE' }];
const REQ_COUNTS = '从信息流中提取帖子，返回每个帖子的点赞数、评论数、转发数。';
const REQ_POPTIME = '悬浮窗的时间戳信息作为发帖时间，提取帖子正文。';
const REQ_WAIVED = '提取帖子正文。地点（可能有）。';
const REQ_EXPAND_COUNTS = '帖子正文中若有"展开"操作，点击展开加载完整正文。提取点赞数、评论数、转发数。';

describe('237th round — requirement-mandated fields and time source', () => {
  it('A: requirement-named field shipped as hardcoded literals → RED REQUIREMENT_FIELD_DROPPED', async () => {
    const out = await makeRunner(STEP(EXTRACT_LITERALS), RECORDS_A, { requirementText: REQ_COUNTS });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /REQUIREMENT_FIELD_DROPPED/);
    assert.match(out.report.error.message, /likeCount/);
    assert.match(out.report.error.message, /点赞/);
    assert.match(out.report.error.message, /6\/6 records?/);
    assert.match(out.report.error.message, /aria-label/);
  });
  it('B: popover-designated postTime shipping mixed completeness → RED REQUIREMENT_TIME_SOURCE_DROPPED', async () => {
    const out = await makeRunner(STEP(EXTRACT_LITERALS), RECORDS_B, { requirementText: REQ_POPTIME });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /REQUIREMENT_TIME_SOURCE_DROPPED/);
    assert.match(out.report.error.message, /2 record\(s\) carry FULL absolutes/);
    assert.match(out.report.error.message, /2 relative \+ 2 partial/);
    assert.match(out.report.error.message, /\$timestamp/);
  });
  it('B2: ALL-relative population + a captured full absolute in sessionEvidence → RED, cheapest exit first', async () => {
    // The 237th-incident shape exactly: the run's rejected-mount harvest
    // carried "November 3, 2025" while every shipped postTime was relative —
    // the absolute was already captured; only the binding was missing.
    const out = await makeRunner(STEP(EXTRACT_LITERALS), RECORDS_E, {
      requirementText: REQ_POPTIME,
      popoverSamples: ['November 3, 2025']
    });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /REQUIREMENT_TIME_SOURCE_DROPPED/);
    assert.match(out.report.error.message, /ALREADY contain a full absolute \("November 3, 2025"/);
    assert.match(out.report.error.message, /read:'hoverPopover'/);
    assert.match(out.report.error.message, /no new hovers needed/);
  });
  it('C: no requirementText keeps both lanes advisory (legacy callers)', async () => {
    const outA = await makeRunner(STEP(EXTRACT_LITERALS), RECORDS_A, {});
    assert.equal(outA.report.ok, true, 'A-shape: ' + JSON.stringify(outA.report.error || {}));
    const outB = await makeRunner(STEP(EXTRACT_LITERALS), RECORDS_B, {});
    assert.equal(outB.report.ok, true, 'B-shape: ' + JSON.stringify(outB.report.error || {}));
    assert.ok(outB.report.detectors.relativeTimestamps, 'the census still rides the report');
  });
  it('D: a category the requirement itself waives (可能有) does not veto', async () => {
    const out = await makeRunner(STEP(EXTRACT_LITERALS), RECORDS_A, { requirementText: REQ_WAIVED });
    assert.equal(out.report.ok, true, 'waived: ' + JSON.stringify(out.report.error || {}));
  });
  it('E: ALL-relative population (no full absolutes) keeps the ladder exits — no veto', async () => {
    const out = await makeRunner(STEP(EXTRACT_LITERALS), RECORDS_E, { requirementText: REQ_POPTIME });
    assert.equal(out.report.ok, true, 'all-relative: ' + JSON.stringify(out.report.error || {}));
    assert.ok(out.report.detectors.relativeTimestamps, 'report-only census attached');
  });
  it('F: the 236th expand veto and the 237th field veto ride ONE error (ALSO RED)', async () => {
    const records = RECORDS_A.map((r) => Object.assign({}, r, { content: r.content + ' … See more' }));
    const out = await makeRunner(STEP(EXTRACT_LITERALS), records, { requirementText: REQ_EXPAND_COUNTS });
    assert.equal(out.report.ok, false);
    const msg = out.report.error.message;
    assert.match(msg, /REQUIREMENT_EXPAND_DROPPED/);
    assert.match(msg, /REQUIREMENT_FIELD_DROPPED/);
    assert.match(msg, /ALSO RED — fix together/);
  });
});
