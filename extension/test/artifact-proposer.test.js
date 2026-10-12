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
