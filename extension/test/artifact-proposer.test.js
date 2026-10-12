// extension/test/artifact-proposer.test.js
//
// Joint solver (2026-10-13 spec): the deterministic evidence-sweeping
// artifact proposer. Fixtures reuse the REAL 236-244 session shapes.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const AP = require('../lib/artifact-proposer');

const REQ_FULL = '从主工作区的信息流中提取帖子dom对象，注意要剔除主页推荐、账号推荐、小组、广告推荐、发帖账号为Ad（广告，没有发帖时间）等非正常帖子条目。如果提取的帖子不足输入参数要求的采集条数，就滚动主工作区的信息流，触发页面加载。帖子正文中若有"展开"操作，点击展开链接。悬浮窗的时间戳作为发帖时间。';

describe('joint solver — parseRequirementClauses', () => {
  it('parses scroll/expand/hover clauses and Latin exclusion markers (CJK + English)', () => {
    const c = AP.parseRequirementClauses(REQ_FULL);
    assert.equal(c.scroll, true);
    assert.equal(c.expand, true);
    assert.equal(c.hover, true);
    assert.deepEqual(c.exclusionMarkers, ['ad']);
  });
  it('English requirement: exclude sponsored → marker "sponsored"; no markers without an exclusion clause', () => {
    const c1 = AP.parseRequirementClauses('Scroll to load more posts. Expand see-more links. Hover popovers. Exclude sponsored entries.');
    assert.equal(c1.scroll, true);
    assert.equal(c1.expand, true);
    assert.equal(c1.hover, true);
    assert.deepEqual(c1.exclusionMarkers, ['sponsored']);
    const c2 = AP.parseRequirementClauses('Extract posts with hovercards and expand the text.');
    assert.deepEqual(c2.exclusionMarkers, []);
  });
  it('empty/null text degrades to all-false with no markers', () => {
    const c = AP.parseRequirementClauses(null);
    assert.deepEqual(c, { scroll: false, expand: false, hover: false, exclusionMarkers: [] });
  });
  it('long exclusion words are captured whole, never fragmented', () => {
    const c = AP.parseRequirementClauses('Exclude recommendations and advertisements entries.');
    assert.deepEqual(c.exclusionMarkers, ['recommendations', 'advertisements']);
  });
});

describe('joint solver — synthesizeFromEvidence (pure)', () => {
  const CENSUS_FIX = {
    containerSel: '[role=article]',
    total: 12,
    sampled: [{}],
    lanes: {
      url: [{ selector: 'a[href*="/posts/"], a[href*="story"]', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['link1', 'link2'] }],
      time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025', '2 days ago'] }],
      count: [{ selector: '[aria-label]', tag: 'div', strength: 'medium', coverage: '5/5', texts: ['Like: 185 people', '9 comments'] }],
      id: [],
      text: [{ selector: 'div[data-ad-comet-preview="message"]', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['California Road Trip Seq… See more'] }]
    },
    hrefIdentity: [{ token: 'story_fbid', coverage: '5/5', samples: ['101a', '202b'] }]
  };
  const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
    type: 'object', required: ['postId', 'postUrl', 'postTime', 'content'], properties: {
      postId: { type: 'string' }, postUrl: { type: 'string' }, postTime: { type: 'string' },
      content: { type: 'string' }, likeCount: { type: 'string' }, commentCount: { type: 'string' },
      shareCount: { type: 'string' }, mediaUrls: { type: 'array', items: { type: 'string' } },
      htmlSnippet: { type: 'string' } } } } } };

  it('emits wait/collect/expand/extract with evidence-derived selectors and :has() population filter', () => {
    const out = AP.synthesizeFromEvidence(
      { census: CENSUS_FIX, currentArtifact: null },
      REQ_FULL, SCHEMA);
    assert.ok(Array.isArray(out.steps) && out.steps.length === 4, 'wait+collect+expand+extract');
    assert.deepEqual(out.steps.map((s) => s.id), ['wait', 'collect', 'expand', 'extract']);
    // Edges: the chain must route THROUGH expand when the clause fires
    // (spec §4.1 step order wait→collect→expand→extract).
    const byId = {}; for (const s of out.steps) byId[s.id] = s;
    assert.equal(byId.wait.onSuccess, 'collect');
    assert.equal(byId.collect.onSuccess, 'expand');
    assert.equal(byId.expand.onSuccess, 'extract');
    const noScroll = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '提取帖子正文，若有"展开"操作点击展开。悬浮窗时间戳作为发帖时间。', SCHEMA);
    const byId2 = {}; for (const s of noScroll.steps) byId2[s.id] = s;
    assert.deepEqual(noScroll.steps.map((s) => s.id), ['wait', 'expand', 'extract']);
    assert.equal(byId2.wait.onSuccess, 'expand');
    // `\\?` tolerates the JSON.stringify quote-escaping inside the emitted
    // script's string literals — the lane selector itself rides verbatim.
    assert.match(out.steps[3].script, /\[role=article\]:has\(a\[href\*=\\?"\/posts\/\\?"\], a\[href\*=\\?"story\\?"\]\)/);
    assert.match(out.steps[2].script, /\$clickInList\(/);
    assert.match(out.steps[2].script, /see more|展开/);
    assert.match(out.steps[1].script, /\$collectUntil\(/);
    assert.match(out.steps[3].script, /\$extractWithHover\(/);
    assert.match(out.steps[3].script, /read: 'hoverPopover'/);
    assert.match(out.steps[3].script, /story_fbid/);
    assert.doesNotMatch(out.steps[3].script, /facebook|fbcdn/);
  });
  it('unfilled slots are named with evidence gaps — never hardcoded empties', () => {
    const noCount = JSON.parse(JSON.stringify(CENSUS_FIX));
    noCount.lanes.count = [];
    const out = AP.synthesizeFromEvidence({ census: noCount }, REQ_FULL, SCHEMA);
    const slots = out.unfilled.map((u) => u.slot);
    assert.ok(slots.indexOf('likeCount') > -1, 'count lanes absent → likeCount unfilled');
    assert.ok(out.unfilled.every((u) => u.reason && u.reason.length > 10), 'every gap names its reason');
    assert.doesNotMatch(out.steps[3].script, /likeCount: ''/);
  });
  it('clauses gate the steps: no scroll clause → no collect step', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '提取帖子正文与悬浮窗时间。', SCHEMA);
    assert.deepEqual(out.steps.map((s) => s.id), ['wait', 'extract']);
  });
  it('no census → honest unfilled, steps still emitted with generic fallbacks', () => {
    const out = AP.synthesizeFromEvidence({ census: null }, REQ_FULL, SCHEMA);
    assert.ok(out.steps.length >= 2, 'wait+extract still emitted');
    assert.ok(out.unfilled.some((u) => /census/i.test(u.reason)), 'census absence disclosed');
  });
  it('textFilter uses the string ~regex contract (a regex literal silently no-ops in $clickInList)', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '若有"展开"操作点击展开。', SCHEMA);
    const ex = out.steps.find((s) => s.id === 'expand');
    assert.match(ex.script, /textFilter: '~see more\|展开'/);
    assert.doesNotMatch(ex.script, /textFilter: \//);
  });
  // NOTE (adapted from review): step scripts are async-function BODIES by
  // DSL contract (top-level await is the documented form), so the construct
  // check uses the AsyncFunction constructor — plain `new Function` rejects
  // every correct step script with "await is only valid in async functions",
  // masking the regex-literal error this test exists to catch. Likewise the
  // token match must include the escape backslash: inside the emitted regex
  // literal the token can only ever appear as `posts\/id`.
  it('hrefIdentity tokens with regex metachars (incl. /) escape safely — generated script compiles', () => {
    const census = JSON.parse(JSON.stringify(CENSUS_FIX));
    census.hrefIdentity = [{ token: 'posts/id', coverage: '5/5', samples: ['a', 'b'] }];
    const out = AP.synthesizeFromEvidence({ census }, '滚动加载。悬浮窗。', SCHEMA);
    const ex = out.steps.find((s) => s.id === 'extract');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    assert.doesNotThrow(() => new AsyncFunction('__input__', ex.script), 'emitted script must construct');
    assert.match(ex.script, /posts\\\/id/);
  });
});
