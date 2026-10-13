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
    hrefIdentity: [{ token: 'query:story_fbid', coverage: '5/5', samples: ['101a', '202b'] }, { token: 'path:last', coverage: '5/5', samples: ['p1', 'p2'] }]
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
    assert.ok(ex.script.includes(String.raw`textFilter: '~\\b[Ss]ee\\s*[Mm]ore\\b|展开|查看更多'`), 'case-tolerant doubled-backslash pattern');
    assert.doesNotMatch(ex.script, /textFilter: \//);
  });
  // Review batch (joint-solver #P1-A): the DSL's ~regex takes NO flags, so
  // the old '~see more|展开' could never match 'See more'. Behavioral proof:
  // evaluate the emitted script's OWN string literal exactly as the runtime
  // does, then build the RegExp exactly as the DSL does
  // (content-script/list-extract-ops: new RegExp(tfRaw.slice(1))).
  it('P1-A: the emitted textFilter matches See more/see more/See More/展开 — and NOT run-on prose', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '若有"展开"操作点击展开。', SCHEMA);
    const sources = [
      out.steps.find((s) => s.id === 'expand').script,
      AP.renderExpandStepFragment('[role=article]')
    ];
    for (const src of sources) {
      const m = /textFilter: '~([^']*)'/.exec(src);
      assert.ok(m, 'textFilter string literal present');
      const dslValue = (new Function('return ' + "'~" + m[1] + "'"))();
      const re = new RegExp(dslValue.slice(1));
      assert.ok(re.test('See more'), 'canonical capitalization matches');
      assert.ok(re.test('see more'));
      assert.ok(re.test('See More'));
      assert.ok(re.test('点击 展开'));
      assert.ok(re.test('查看更多'));
      assert.ok(!re.test('seemorex'), 'word boundary rejects run-on prose');
      assert.ok(!re.test('SEEMOREX'));
    }
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
    census.hrefIdentity = [{ token: 'query:posts/id', coverage: '5/5', samples: ['a', 'b'] }];
    const out = AP.synthesizeFromEvidence({ census }, '滚动加载。悬浮窗。', SCHEMA);
    const ex = out.steps.find((s) => s.id === 'extract');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    assert.doesNotThrow(() => new AsyncFunction('__input__', ex.script), 'emitted script must construct');
    assert.match(ex.script, /posts\\\/id/);
  });
  // Review batch (joint-solver #7): the emitted collect step read
  // r.count/r.certified — keys $collectUntil NEVER returns (its receipt is
  // {collected, satisfied, exhaustion:{certified,evidence}}), so every
  // collect step's step result carried undefined count/certified forever.
  it('collect step reads the $collectUntil receipt contract (collected / exhaustion.certified / satisfied)', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, REQ_FULL, SCHEMA);
    const collect = out.steps.find((s) => s.id === 'collect');
    assert.ok(collect, 'scroll clause → collect step exists');
    assert.match(collect.script, /count: r\.collected/);
    assert.match(collect.script, /r\.exhaustion && r\.exhaustion\.certified/);
    assert.match(collect.script, /satisfied: r\.satisfied \|\| null/);
    assert.doesNotMatch(collect.script, /r\.count\b/, 'r.count is not a $collectUntil key');
    assert.doesNotMatch(collect.script, /r\.certified\b/, 'r.certified is not a $collectUntil key');
  });
  // Review batch (joint-solver #P1-B): census-lanes emits tokens in the
  // PRODUCTION shape ('query:story' is pinned by probe-census tests). The
  // proposer used to splice the token RAW, producing a regex that can never
  // match a URL — every production postId came back empty.
  it('P1-B: query: tokens strip to [?&]param= anchors; path: tokens are ignored — and the regex matches a real URL', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '滚动加载。悬浮窗。', SCHEMA);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.ok(ex.script.includes('(?:[?&]story_fbid=)(\\w{3,})'), 'query token anchored at [?&]');
    assert.ok(!ex.script.includes('query:'), 'the transport prefix never rides into the script');
    assert.ok(!ex.script.includes('[?&]last='), 'path: tokens are not query-param bindings');
    const mRe = /String\(r\.postUrl\)\.match\(\/(.+)\/\);/.exec(ex.script);
    assert.ok(mRe, 'identity regex literal present');
    const idRegex = new RegExp(mRe[1]);
    assert.equal(idRegex.exec('https://e.com/p/1?story_fbid=abc123')[1], 'abc123');
    assert.equal(idRegex.exec('https://e.com/story/999'), null, 'no query param → no id claim');
  });
  // Review batch (joint-solver #P1-E): the return key follows the schema's
  // declared array — the hardcoded `return { posts: posts }` made every
  // non-posts contract verify against a shape the script never emitted.
  it('P1-E: the extract return key follows the schema array key (items)', () => {
    const schema = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: {
      type: 'object', required: ['postUrl'], properties: { postUrl: { type: 'string' } } } } } };
    const out = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '提取帖子。', schema);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.ok(ex.script.includes('return { "items": posts };'));
    const outPosts = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '提取帖子。', SCHEMA);
    assert.ok(outPosts.steps.find((s) => s.id === 'extract').script.includes('return { "posts": posts };'), 'default stays posts');
  });
  // Review batch (joint-solver #P2-H): the Ad marker rode tsLabel while
  // tsAria read empty — the old guard tested r.tsAria only and every Ad card
  // shipped. The guard now tests the ASSEMBLED postTime (abs || times[0]).
  it('P2-H: the exclusion guard tests the assembled postTime (tsLabel=Ad, tsAria empty → excluded)', async () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '剔除发帖账号为Ad的条目。悬浮窗时间戳作为发帖时间。', SCHEMA);
    const ex = out.steps.find((s) => s.id === 'extract');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('__input__', '$extractWithHover', ex.script);
    const rs = [
      { postUrl: 'https://e.com/p/1?story_fbid=aaa111', tsLabel: 'Ad' },
      { postUrl: 'https://e.com/p/2?story_fbid=bbb222', tsLabel: 'November 3, 2025' }
    ];
    const res = await fn({ count: 5 }, async () => rs);
    assert.equal(res.posts.length, 1, 'the Ad record is excluded, the dated record kept');
    assert.equal(res.posts[0].postId, 'bbb222');
    assert.equal(res.posts[0].postTime, 'November 3, 2025');
  });
  // Review batch (joint-solver #P2-I): with no url lane the fieldMap never
  // binds the url slot, so the old unconditional `if (!r.postUrl) continue;`
  // skipped EVERY record — the extract deterministically returned {posts:[]}.
  it('P2-I: the per-record url skip-guard is emitted ONLY when the url slot is bound', () => {
    const noUrl = JSON.parse(JSON.stringify(CENSUS_FIX));
    noUrl.lanes.url = [];
    noUrl.hrefIdentity = [];
    const out = AP.synthesizeFromEvidence({ census: noUrl }, '提取帖子正文与悬浮窗时间。', SCHEMA);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.doesNotMatch(ex.script, /if \(!r\.postUrl\) continue;/, 'no vacuous guard');
    assert.ok(out.unfilled.some((u) => u.slot === 'postUrl'), 'the gap is disclosed instead');
    const withUrl = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '提取帖子正文与悬浮窗时间。', SCHEMA);
    assert.match(withUrl.steps.find((s) => s.id === 'extract').script, /if \(!r\.postUrl\) continue;/, 'bound url keeps the population filter');
  });
  // 248th round (FIX 2, joint-solver second live run): every synthesized
  // selector was obfuscated-class anchored (a.x1i10hfl) and died cross-tab
  // on class churn — while the census's OWN hrefIdentity tokens named the
  // churn-proof attribute binding. When query tokens exist and the url-lane
  // selector is class-anchored only, the identity selector becomes the
  // a[href*="tok="] attribute union.
  it('248th FIX 2: class-anchored url lane + query tokens → the identity selector is the a[href*="tok="] union, not the class', () => {
    const census = JSON.parse(JSON.stringify(CENSUS_FIX));
    census.lanes.url = [{ selector: 'a.x1i10hfl', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l1', 'l2'] }];
    census.hrefIdentity = [{ token: 'query:story_fbid', coverage: '5/5', samples: ['101a', '202b'] }];
    const out = AP.synthesizeFromEvidence({ census }, '提取帖子。悬浮窗时间戳。', SCHEMA);
    assert.ok(out.selectorProvenance, 'selectorProvenance rides the synthesis result');
    assert.equal(out.selectorProvenance.source, 'hrefIdentity-tokens');
    assert.equal(out.selectorProvenance.identitySelector, 'a[href*="story_fbid="]');
    const ex = out.steps.find((s) => s.id === 'extract');
    // `\\?` tolerates the JSON.stringify quote-escaping inside the emitted
    // string literals — the attribute union itself rides verbatim.
    assert.match(ex.script, /:has\(a\[href\*=\\?"story_fbid=\\?"\]\)/, 'the CARD :has() filter uses the attribute union');
    assert.match(ex.script, /postUrl: \{ selector: "a\[href\*=\\?"story_fbid=\\?"\]", attr: 'href' \}/, 'the postUrl field selector uses the attribute union');
    assert.doesNotMatch(ex.script, /x1i10hfl/, 'the churn-vulnerable class never rides into the artifact');
    const wait = out.steps.find((s) => s.id === 'wait');
    assert.match(wait.script, /\$wait\("\[role=article\]:has\(a\[href\*=\\?"story_fbid=\\?"\]\)", 3000\)/, 'the wait step gates on the same union');
  });
  it('248th FIX 2: attribute-bearing url lane is kept — it is already churn-resistant', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, '提取帖子。', SCHEMA);
    assert.equal(out.selectorProvenance.source, 'url-lane');
    assert.equal(out.selectorProvenance.identitySelector, 'a[href*="/posts/"], a[href*="story"]');
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.match(ex.script, /:has\(a\[href\*=\\?"\/posts\/\\?"\], a\[href\*=\\?"story\\?"\]\)/);
  });
  it('248th FIX 2: the attribute union caps at 3 tokens', () => {
    const census = JSON.parse(JSON.stringify(CENSUS_FIX));
    census.lanes.url = [{ selector: 'a.x1i10hfl', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }];
    census.hrefIdentity = ['a', 'b', 'c', 'd'].map((k) => ({ token: 'query:' + k, coverage: '5/5', samples: ['1' + k, '2' + k] }));
    const out = AP.synthesizeFromEvidence({ census }, '提取帖子。', SCHEMA);
    assert.equal(out.selectorProvenance.identitySelector, 'a[href*="a="], a[href*="b="], a[href*="c="]',
      'only the first 3 query tokens ride the union');
  });
  // 248th round (FIX 3): the second live run's schema named likes/comments/
  // shares while VOCAB_SLOT only knew likeCount/commentCount/shareCount —
  // every count slot went unmapped and the assembly emitted keys the schema
  // never declared.
  it('248th FIX 3: plural schema names (likes/comments/shares) map — assembly keys and unfilled slots use the schema names', () => {
    const PLURAL_SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
      type: 'object', required: ['postUrl', 'postTime', 'content'], properties: {
        postUrl: { type: 'string' }, postTime: { type: 'string' }, content: { type: 'string' },
        likes: { type: 'string' }, comments: { type: 'string' }, shares: { type: 'string' } } } } } };
    const noCount = JSON.parse(JSON.stringify(CENSUS_FIX));
    noCount.lanes.count = [];
    const out = AP.synthesizeFromEvidence({ census: noCount }, REQ_FULL, PLURAL_SCHEMA);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.match(ex.script, /likes: like, comments: num\(commL\), shares: num\(shrL\)/, 'assembly keys follow the schema names');
    assert.doesNotMatch(ex.script, /likeCount:/, 'no undeclared likeCount key ships');
    const slots = out.unfilled.map((u) => u.slot);
    assert.ok(slots.indexOf('likes') > -1, 'count-lane absence names the plural slot');
    assert.ok(slots.indexOf('comments') > -1 && slots.indexOf('shares') > -1, 'all three plural slots disclosed');
    // The canonical names keep resolving when the schema uses them.
    const canon = AP.synthesizeFromEvidence({ census: noCount }, REQ_FULL, SCHEMA);
    assert.ok(canon.unfilled.some((u) => u.slot === 'likeCount'), 'canonical schema still names likeCount');
    assert.match(canon.steps.find((s) => s.id === 'extract').script, /likeCount: like, commentCount: num\(commL\), shareCount: num\(shrL\)/);
    // A count lane present + plural schema → the labels carrier assembles
    // into the plural keys.
    const withCount = AP.synthesizeFromEvidence({ census: CENSUS_FIX }, REQ_FULL, PLURAL_SCHEMA);
    assert.match(withCount.steps.find((s) => s.id === 'extract').script, /likes: like, comments: num\(commL\), shares: num\(shrL\)/);
    assert.match(withCount.steps.find((s) => s.id === 'extract').script, /labels: \{ selector: '\[aria-label\]'/);
  });
});

describe('joint solver — red-receipt fragment renderers', () => {
  it('expand step fragment interpolates the artifact card selector', () => {
    const frag = AP.renderExpandStepFragment('[role=article]:has(a[href*="/posts/"])');
    // `\\?` tolerates the JSON.stringify quote-escaping inside the emitted
    // string literal (same contract as the :has() assertion above) — the
    // selector itself rides verbatim.
    assert.match(frag, /\$clickInList\("\[role=article\]:has\(a\[href\*=\\?"\/posts\/\\?"\]\)"/);
    assert.ok(frag.includes(String.raw`textFilter: '~\\b[Ss]ee\\s*[Mm]ore\\b|展开|查看更多'`));
  });
  it('hoverPopover fieldMap fragment carries the anchor + year match', () => {
    const frag = AP.renderHoverPopoverFragment('postTime', 'a[href*="/posts/"] span');
    assert.match(frag, /read: 'hoverPopover'/);
    assert.match(frag, /\(19\|20\)\\d\{2\}/);
  });
  it('exclusion guard fragment renders an assembly filter on the marker', () => {
    const frag = AP.renderExclusionGuardFragment('postTime', 'Ad');
    assert.match(frag, /\.filter\(function \(p\) \{ return String\(p\.postTime \|\| ''\)\.toLowerCase\(\) !== 'ad'; \}\)/);
  });
});

describe('joint solver — proposeArtifact (stubbed sweep)', () => {
  function CENSUS_SHALLOW() {
    return {
      containerSel: '[role=article]', total: 12, sampled: [{}],
      lanes: {
        url: [{ selector: 'a[href*="/p/"]', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
        time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }],
        count: [], id: [],
        text: [{ selector: 'div.msg', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['body'] }]
      },
      hrefIdentity: [{ token: 'query:id', coverage: '5/5', samples: ['a1', 'b2'] }]
    };
  }
  function SCHEMA_FIX() {
    return { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
      type: 'object', required: ['postUrl', 'postTime', 'content'], properties: {
        postId: { type: 'string' }, postUrl: { type: 'string' }, postTime: { type: 'string' },
        content: { type: 'string' }, likeCount: { type: 'string' }, commentCount: { type: 'string' },
        shareCount: { type: 'string' }, mediaUrls: { type: 'array', items: { type: 'string' } },
        htmlSnippet: { type: 'string' } } } } } };
  }
  it('sweeps via probes, synthesizes, applies through applyArtifact, returns decision-key receipt', async () => {
    const applied = [];
    const probes = {
      count: async (args) => ({ count: args.sel === '[role=article]' ? 12 : 0 }),
      census: async () => CENSUS_SHALLOW(),
      sample: async () => ({ element: { textContent: 'x' } })
    };
    const out = await AP.proposeArtifact({
      probes: probes,
      requirementText: REQ_FULL,
      outputSchema: SCHEMA_FIX(),
      currentArtifact: null,
      applyArtifact: async (a) => { applied.push(a); return { version: 1 }; }
    });
    assert.equal(applied.length, 1, 'applied exactly once');
    assert.equal(out.applied, true);
    assert.equal(out.version, 1);
    assert.ok(Array.isArray(out.unfilled));
    assert.equal(out.next, 'verify.run');
    assert.ok(typeof out.sweepCostMs === 'number');
    assert.ok(out.unfilled.some((u) => u.slot === 'likeCount'));
  });
  it('applyArtifact rejection is returned verbatim, applied:false, gates never bypassed', async () => {
    const out = await AP.proposeArtifact({
      probes: { count: async () => ({ count: 5 }), census: async () => CENSUS_SHALLOW(), sample: async () => ({}) },
      requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(), currentArtifact: null,
      applyArtifact: async () => { throw new Error('SYNTAX_ERROR: unexpected token'); }
    });
    assert.equal(out.applied, false);
    assert.match(out.error, /SYNTAX_ERROR/);
  });
  // C1 (final review): in production the tool handler wires NO applyArtifact
  // — the synthesis comes back UNAPPLIED for the engine's service.update
  // pipeline (grounding gates, staticLint/syntax/chain gates, version
  // lineage). The bare-setter apply path had none of those.
  it('engine-pending mode: no applyArtifact → steps returned for the engine pipeline', async () => {
    const probes = { count: async () => ({ count: 5 }), census: async () => CENSUS_SHALLOW(), sample: async () => ({}) };
    const out = await AP.proposeArtifact({ probes, requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(), currentArtifact: null });
    assert.equal(out.applied, 'engine-pending');
    assert.ok(Array.isArray(out.steps) && out.steps.length >= 2);
    assert.ok(Array.isArray(out.unfilled));
    assert.equal(typeof out.merge, 'string');
    assert.equal(typeof out.sweepCostMs, 'number');
    assert.match(out.next, /engine applies/);
  });
  it('re-propose discloses the regenerate semantics when a current artifact exists', async () => {
    const out = await AP.proposeArtifact({
      probes: { count: async () => ({ count: 5 }), census: async () => CENSUS_SHALLOW(), sample: async () => ({}) },
      requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(),
      currentArtifact: { steps: [{ id: 'old', script: 'return 1;', onSuccess: 'TERMINATE' }] },
      applyArtifact: async () => ({ version: 2 })
    });
    assert.equal(out.applied, true);
    assert.match(out.merge, /regenerated-from-fresh-sweep/);
    assert.match(out.merge, /NOT preserved/);
  });
  // Review batch (joint-solver #13): a FAILED census hop used to flow into
  // synthesis as pseudo-evidence (a truthy {error:…} object suppressed the
  // no-census unfilled entry) — the receipt looked fully sourced while every
  // lane silently fell back to web-generic ARIA conventions.
  it('a census hop error discloses itself as an unfilled census slot with the digest', async () => {
    const out = await AP.proposeArtifact({
      probes: {
        count: async () => ({ count: 5 }),
        census: async () => ({ error: 'no page open' }),
        sample: async () => ({})
      },
      requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(), currentArtifact: null,
      applyArtifact: async () => ({ version: 1 })
    });
    assert.equal(out.applied, true, 'a failed hop is an evidence gap, never a crash');
    const c = out.unfilled.find((u) => u && u.slot === 'census' && /census hop failed/.test(u.reason || ''));
    assert.ok(c, 'unfilled carries the census digest slot');
    assert.match(c.reason, /^census hop failed: no page open/);
    assert.match(c.reason, /web-generic ARIA conventions/);
  });
  it('a census hop that THROWS discloses the same way', async () => {
    const out = await AP.proposeArtifact({
      probes: {
        count: async () => ({ count: 5 }),
        census: async () => { throw new Error('tab closed mid-census'); },
        sample: async () => ({})
      },
      requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(), currentArtifact: null,
      applyArtifact: async () => ({ version: 1 })
    });
    const c = out.unfilled.find((u) => u && u.slot === 'census' && /census hop failed/.test(u.reason || ''));
    assert.ok(c, 'thrown census error disclosed');
    assert.match(c.reason, /tab closed mid-census/);
  });
  // Review batch (joint-solver #P1-D): the unbounded sweep could run ~7min.
  // Three caps, exercised here with an injected (tiny) sweepBudget: the
  // bootstrap stops admitting candidates past bootstrapMs, and the census
  // hop carries a timeoutMs derived from what remains of totalMs.
  it('P1-D: the bootstrap loop caps itself — slow counts stop before exhausting the candidate list', async () => {
    let countCalls = 0;
    const probes = {
      count: async () => { countCalls += 1; await new Promise((r) => setTimeout(r, 150)); return { count: 0 }; },
      census: async () => { throw new Error('census must not run when the bootstrap found no container'); }
    };
    const out = await AP.proposeArtifact({
      probes, requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(), currentArtifact: null,
      sweepBudget: { totalMs: 400, bootstrapMs: 250, hardSkipMs: 350, censusMinMs: 100 },
      applyArtifact: async () => ({ version: 1 })
    });
    assert.ok(countCalls >= 1 && countCalls <= 2, 'bootstrap stopped early (calls=' + countCalls + ' of 4 candidates)');
    assert.equal(out.bootstrapCapped, true, 'the cap is disclosed on the receipt');
    assert.ok(out.unfilled.some((u) => u && u.slot === 'census'), 'no pseudo-census — the gap is disclosed');
    assert.equal(out.applied, true, 'the sweep still terminates and applies');
  });
  it('P1-D: the census hop receives a timeoutMs derived from the remaining budget', async () => {
    let censusArgs = null;
    const probes = {
      count: async () => ({ count: 12 }),
      census: async (a) => { censusArgs = a; return CENSUS_SHALLOW(); }
    };
    const out = await AP.proposeArtifact({
      probes, requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(), currentArtifact: null,
      applyArtifact: async () => ({ version: 1 })
    });
    assert.ok(censusArgs && typeof censusArgs.timeoutMs === 'number', 'census called with an explicit budget');
    assert.ok(censusArgs.timeoutMs >= 10000 && censusArgs.timeoutMs <= 110000,
      'timeoutMs = max(censusMinMs, totalMs-elapsed-10000) — got ' + censusArgs.timeoutMs);
    // 247th round: the sweep's census carries the bounded mount phase —
    // the maiden live session's window held only top-of-SERP modules while
    // the organic posts sat unmounted below. 250th round: scrollRounds 2→5
    // — the 249th session's rec headers spanned multiple viewports (the
    // 243rd showed 3→12 with deep scroll); 5 hops x (900px scroll + 900ms
    // settle + count) ~= 9-12s worst case, still inside the 120s sweep
    // budget that gates the census hop.
    assert.equal(censusArgs.scrollRounds, 5, 'the sweep scrolls deep for mounted-window bias before reading');
    assert.equal(out.applied, true);
  });
  // Review batch (joint-solver #P2-F): the CARD's :has(a[href*=…]) demands an
  // attribute-distribution receipt the sweep never produced — fresh-session
  // proposes were deterministically grounding-rejected on 'href'. The sweep
  // now censuses exactly the gate's own filter-attr set.
  it('P2-F: the sweep runs probe.attrStats for the CARD :has() filter attrs (descendant form, receipt disclosed)', async () => {
    const attrCalls = [];
    const probes = {
      count: async () => ({ count: 12 }),
      census: async () => CENSUS_SHALLOW(),
      attrStats: async (a) => {
        attrCalls.push(a);
        return { totalItems: 5, values: [{ value: '/p/1', items: 5, pct: 100 }], absentPct: 0 };
      }
    };
    const out = await AP.proposeArtifact({
      probes, requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(), currentArtifact: null,
      applyArtifact: async () => ({ version: 1 })
    });
    assert.equal(attrCalls.length, 1, 'href — the only :has() filter attr — censused exactly once');
    assert.equal(attrCalls[0].containerSel, '[role=article] [href]', 'descendant form: what :has() filters by');
    assert.equal(attrCalls[0].attr, 'href');
    assert.ok(Array.isArray(out.attrGrounding) && out.attrGrounding.length === 1);
    assert.equal(out.attrGrounding[0].attr, 'href');
    assert.equal(out.attrGrounding[0].ok, true);
  });
  it('P2-F/P1-D: past hardSkipMs the attrStats hop is skipped — the budget wins over receipts, and the skip is disclosed', async () => {
    let attrCalls = 0;
    const probes = {
      count: async () => ({ count: 12 }),
      census: async () => CENSUS_SHALLOW(),
      attrStats: async () => { attrCalls += 1; return {}; }
    };
    const out = await AP.proposeArtifact({
      probes, requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(), currentArtifact: null,
      sweepBudget: { totalMs: 120000, bootstrapMs: 30000, hardSkipMs: -1, censusMinMs: 10000 },
      applyArtifact: async () => ({ version: 1 })
    });
    assert.equal(attrCalls, 0, 'no attrStats dispatch past the hard skip');
    assert.ok(Array.isArray(out.attrGrounding) && /sweep budget/.test(out.attrGrounding[0].skipped || ''), 'skip disclosed');
  });
  // 248th round (FIX 2): the propose receipt passes selectorProvenance
  // through, and the P2-F attr-grounding hop censuses the attrs of the
  // EMITTED card — a class-only lane replaced by the token union now carries
  // a[href*=…] into :has(), so the sweep must produce the href receipt the
  // gate will demand (the exact P2-F failure shape, re-introduced by the
  // replacement if the hop still derived from the raw lane).
  it('248th FIX 2: receipt carries selectorProvenance; the attrStats hop censuses the EMITTED token-union card attrs', async () => {
    const attrCalls = [];
    const census = CENSUS_SHALLOW();
    census.lanes.url = [{ selector: 'a.x1i10hfl', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }];
    const probes = {
      count: async () => ({ count: 12 }),
      census: async () => census,
      attrStats: async (a) => {
        attrCalls.push(a);
        return { totalItems: 5, values: [{ value: '/x?id=1', items: 5, pct: 100 }], absentPct: 0 };
      }
    };
    const out = await AP.proposeArtifact({
      probes, requirementText: REQ_FULL, outputSchema: SCHEMA_FIX(), currentArtifact: null,
      applyArtifact: async () => ({ version: 1 })
    });
    assert.equal(out.applied, true);
    assert.ok(out.selectorProvenance, 'the receipt discloses the identity-selector source');
    assert.equal(out.selectorProvenance.source, 'hrefIdentity-tokens');
    assert.equal(out.selectorProvenance.identitySelector, 'a[href*="id="]');
    assert.equal(attrCalls.length, 1, 'href — the token-union :has() filter attr — censused exactly once');
    assert.equal(attrCalls[0].attr, 'href');
    assert.equal(attrCalls[0].containerSel, '[role=article] [href]', 'descendant form of the EMITTED card filter');
    assert.ok(Array.isArray(out.attrGrounding) && out.attrGrounding.length === 1 && out.attrGrounding[0].attr === 'href');
  });
});

// 249th round (joint-solver run 3): the synthesized expand step's button
// selector was a HARDCODED ARIA fallback (div[role=button], span[role=button])
// that does not exist on every page — CLICK_TARGET_NOT_FOUND verify deaths.
// The path-form identity gap: the incident page's permalinks are PATH-form
// (/{dir}/{id}), so query-token identity was empty and the identity selector
// fell back to the churn-prone class anchor. And the propose receipt never
// surfaced whether the census mount phase ran.
describe('joint solver — 249 measured affordance + path-prefix identity + censusMount', () => {
  function CENSUS_249() {
    return {
      containerSel: '[role=article]', total: 12, sampled: [{}],
      lanes: {
        url: [{ selector: 'a[href*="/p/"]', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
        time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }],
        count: [], id: [],
        text: [{ selector: 'div.msg', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['body'] }]
      },
      hrefIdentity: [{ token: 'query:id', coverage: '5/5', samples: ['a1', 'b2'] }]
    };
  }
  function SCHEMA_249() {
    return { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
      type: 'object', required: ['postUrl', 'postTime', 'content'], properties: {
        postId: { type: 'string' }, postUrl: { type: 'string' }, postTime: { type: 'string' },
        content: { type: 'string' }, likeCount: { type: 'string' }, commentCount: { type: 'string' },
        shareCount: { type: 'string' }, mediaUrls: { type: 'array', items: { type: 'string' } },
        htmlSnippet: { type: 'string' } } } } } };
  }

  // --- FIX 1: measured affordance selector ---
  it('249 FIX 1 (pure): chooseAffordanceSelector_249 — first nonzero family in ORDER wins, all-zero → null', () => {
    const F = AP.BUTTON_FAMILIES;
    assert.ok(Array.isArray(F) && F.length === 4, 'four ordered families exported');
    assert.equal(F[0], 'div[role=button], span[role=button]', 'the ARIA default stays the first preference');
    const counts = {};
    counts[F[0]] = 0; counts[F[1]] = 2; counts[F[2]] = 5; counts[F[3]] = 1;
    assert.equal(AP.chooseAffordanceSelector_249(counts), F[1], 'first nonzero wins');
    const defWins = {}; defWins[F[0]] = 3;
    assert.equal(AP.chooseAffordanceSelector_249(defWins), F[0], 'the ARIA default wins when it actually counts');
    const zeros = {}; zeros[F[0]] = 0; zeros[F[1]] = 0; zeros[F[2]] = 0; zeros[F[3]] = 0;
    assert.equal(AP.chooseAffordanceSelector_249(zeros), null, 'all zero → null (caller keeps the default)');
    assert.equal(AP.chooseAffordanceSelector_249(null), null, 'no counts object → null');
  });
  it('249 FIX 1 (sweep): scoped affordance counts — role=button 0, button 2 → expand clicks "button", provenance discloses it', async () => {
    const countSels = [];
    const probes = {
      count: async (a) => {
        countSels.push(a.sel);
        if (a.sel === '[role=article]') return { count: 12 };
        if (/role=button/.test(a.sel)) return { count: 0 };
        if (/button/.test(a.sel)) return { count: 2 };
        return { count: 0 };
      },
      census: async () => CENSUS_249(),
      attrStats: async () => ({ totalItems: 5, values: [{ value: '/p/1', items: 5, pct: 100 }], absentPct: 0 })
    };
    const out = await AP.proposeArtifact({ probes, requirementText: REQ_FULL, outputSchema: SCHEMA_249(), currentArtifact: null });
    assert.equal(out.applied, 'engine-pending');
    const ex = out.steps.find((s) => s.id === 'expand');
    assert.ok(ex, 'expand clause → expand step exists');
    assert.ok(ex.script.includes('"button"'), 'the measured button family rides the $clickInList sub-selector');
    assert.doesNotMatch(ex.script, /role=button/, 'the ARIA default that counted ZERO never rides');
    assert.equal(out.selectorProvenance.affordanceSelector, 'button', 'the receipt discloses the measured affordance');
    const scoped = countSels.filter((s) => s.indexOf(':has(') > -1);
    assert.ok(scoped.length >= 1, 'affordance counts ran (' + JSON.stringify(countSels) + ')');
    assert.ok(scoped.every((s) => s.indexOf('[role=article]:has(') === 0), 'counts are scoped to the emitted CARD');
  });
  it('249 FIX 1 (sweep): every family counts zero → the ARIA default is retained, no affordance provenance claim', async () => {
    const probes = {
      count: async (a) => ({ count: a.sel === '[role=article]' ? 12 : 0 }),
      census: async () => CENSUS_249(),
      attrStats: async () => ({ totalItems: 5, values: [{ value: '/p/1', items: 5, pct: 100 }], absentPct: 0 })
    };
    const out = await AP.proposeArtifact({ probes, requirementText: REQ_FULL, outputSchema: SCHEMA_249(), currentArtifact: null });
    const ex = out.steps.find((s) => s.id === 'expand');
    assert.ok(ex.script.includes('div[role=button], span[role=button]'), 'the web-generic default survives');
    assert.equal(out.selectorProvenance.affordanceSelector, undefined, 'no measured affordance → no provenance field');
  });

  // Review batch (#5): 'CARD + " " + family' concatenation splits at the
  // family's TOP-LEVEL comma — the first arm was scoped to the card but
  // every later arm counted PAGE-WIDE, so a page with any span[role=button]
  // outside the feed measured the affordance as "existing on our cards".
  describe('review #5 — scoped affordance counts (per-arm)', () => {
    // quote-aware top-level split (the same walk the production splitter
    // applies): commas inside [attr] or "…" never split an arm.
    const topLevelArms = (sel) => {
      const arms = [];
      let depth = 0, quote = null, cur = '';
      for (const ch of String(sel)) {
        if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        if (ch === '[' || ch === '(') { depth += 1; cur += ch; continue; }
        if (ch === ']' || ch === ')') { depth = Math.max(0, depth - 1); cur += ch; continue; }
        if (ch === ',' && depth === 0) { arms.push(cur); cur = ''; continue; }
        cur += ch;
      }
      arms.push(cur);
      return arms.map((a) => a.trim()).filter(Boolean);
    };
    it('pure: scopeFamilyToSelector_253 prefixes EVERY arm; a comma inside a quoted attribute value never splits', () => {
      assert.equal(
        AP.scopeFamilyToSelector_253('[role=article]', 'div[role=button], span[role=button]'),
        '[role=article] div[role=button], [role=article] span[role=button]',
        'each arm gets its own card prefix');
      const quoted = AP.scopeFamilyToSelector_253('div.card', 'a[data-x="a,b"], button');
      assert.ok(quoted.startsWith('div.card a[data-x="a,b"]'), 'the quoted comma stays INSIDE the arm: ' + quoted);
      assert.ok(quoted.includes('div.card button'), 'the second arm is scoped too');
      assert.equal((quoted.match(/div\.card /g) || []).length, 2, 'exactly two arms, both prefixed');
      assert.equal(topLevelArms('x[a="1,2"], y').length, 2, 'checker sanity: quoted comma does not split');
      assert.equal(AP.scopeFamilyToSelector_253('div.card', 'button'), 'div.card button', 'single-arm family unchanged');
    });
    it('sweep: every arm of every counted family sel is scoped to the card (no page-wide later arm)', async () => {
      const countSels = [];
      const probes = {
        count: async (a) => { countSels.push(a.sel); return { count: a.sel === '[role=article]' ? 12 : 0 }; },
        census: async () => CENSUS_249(),
        attrStats: async () => ({ totalItems: 5, values: [{ value: '/p/1', items: 5, pct: 100 }], absentPct: 0 })
      };
      await AP.proposeArtifact({ probes, requirementText: REQ_FULL, outputSchema: SCHEMA_249(), currentArtifact: null });
      const scoped = countSels.filter((s) => s.indexOf(':has(') > -1);
      assert.ok(scoped.length >= 3, 'all families counted (' + JSON.stringify(countSels) + ')');
      const CARD = '[role=article]:has(a[href*="/p/"])';
      const union = scoped.find((s) => s.indexOf('role=button') > -1);
      assert.ok(union, 'the union family was counted');
      assert.equal(union, CARD + ' div[role=button], ' + CARD + ' span[role=button]',
        'the union splits into per-arm scoped selectors');
      for (const s of scoped) {
        const arms = topLevelArms(s);
        assert.ok(arms.length >= 1, 'sel parses: ' + s);
        for (const arm of arms) {
          assert.ok(arm.indexOf(CARD + ' ') === 0, 'every top-level arm is card-scoped: ' + arm + ' (sel ' + s + ')');
        }
      }
    });
  });

  // --- FIX 2: path-form identity from a stable prefix ---
  it('249 FIX 2 (pure): derivePathIdentity_249 — /stories/ samples → prefix + regex; identical/query-only/single → null', () => {
    const r = AP.derivePathIdentity_249(['https://x/stories/abc?y=1', 'https://x/stories/def']);
    assert.ok(r, 'derived from two path-form hrefs');
    assert.equal(r.prefix, '/stories/');
    assert.equal(r.idRegex, '/\\/stories\\/([A-Za-z0-9_-]{3,})/', 'regex built from the escaped prefix');
    const re = new RegExp(r.idRegex.slice(1, -1));
    assert.equal(re.exec('https://x/stories/Zz9_x-1?track=1')[1], 'Zz9_x-1', 'the derived regex extracts the id segment');
    assert.equal(AP.derivePathIdentity_249(['https://x/stories/abc', 'https://x/stories/abc']), null, 'identical paths → no varying segment');
    assert.equal(AP.derivePathIdentity_249(['https://x/p?id=1', 'https://x/p?id=2']), null, 'query-only URLs carry no path id');
    assert.equal(AP.derivePathIdentity_249(['https://x/stories/abc']), null, 'a single sample proves nothing');
    assert.equal(AP.derivePathIdentity_249('junk'), null, 'non-array input degrades to null');
  });
  it('249 FIX 2 (synth): pack.pathIdentity → a[href*="/stories/"] identity, derived id regex, source path-prefix; query tokens still win', () => {
    const census = {
      containerSel: '[role=article]', total: 9, sampled: [{}],
      lanes: {
        url: [{ selector: 'a.x1i10hfl', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
        time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }],
        count: [], id: [], text: []
      },
      hrefIdentity: [{ token: 'path:last', coverage: '5/5', samples: ['abc123', 'def456'] }]
    };
    const PATH_ID = { prefix: '/stories/', idRegex: '/\\/stories\\/([A-Za-z0-9_-]{3,})/' };
    const out = AP.synthesizeFromEvidence({ census, pathIdentity: PATH_ID }, REQ_FULL, SCHEMA_249());
    assert.equal(out.selectorProvenance.source, 'path-prefix');
    assert.equal(out.selectorProvenance.identitySelector, 'a[href*="/stories/"]');
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.match(ex.script, /:has\(a\[href\*=\\?"\/stories\/\\?"\]\)/, 'the CARD :has() filter binds the path prefix');
    const mRe = /String\(r\.postUrl\)\.match\(\/(.+)\/\);/.exec(ex.script);
    assert.ok(mRe, 'identity regex literal present');
    const idRegex = new RegExp(mRe[1]);
    assert.equal(idRegex.exec('https://x/stories/abc123')[1], 'abc123', 'behavioral: the derived regex extracts the id');
    assert.doesNotMatch(ex.script, /x1i10hfl/, 'the churn-prone class never rides');
    // Priority: query tokens > pathIdentity > url-lane.
    const withQuery = JSON.parse(JSON.stringify(census));
    withQuery.hrefIdentity = [{ token: 'query:story_fbid', coverage: '5/5', samples: ['101a', '202b'] }, { token: 'path:last', coverage: '5/5', samples: ['abc', 'def'] }];
    const out2 = AP.synthesizeFromEvidence({ census: withQuery, pathIdentity: PATH_ID }, '提取帖子。', SCHEMA_249());
    assert.equal(out2.selectorProvenance.source, 'hrefIdentity-tokens', 'query tokens outrank the path identity');
  });
  it('249 FIX 2 (sweep): path:last tokens + no query → the attrStats href hop derives pathIdentity; emitted card + attr grounding follow it', async () => {
    const attrCalls = [];
    const census = {
      containerSel: '[role=article]', total: 8, sampled: [{}],
      lanes: {
        url: [{ selector: 'a.x1i10hfl', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
        time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }],
        count: [], id: [], text: []
      },
      hrefIdentity: [{ token: 'path:last', coverage: '5/5', samples: ['abc123', 'def456'] }]
    };
    const probes = {
      count: async (a) => ({ count: a.sel === '[role=article]' ? 12 : 0 }),
      census: async () => census,
      attrStats: async (a) => {
        attrCalls.push(a);
        if (a.attr === 'href' && a.containerSel === 'a.x1i10hfl') {
          return { totalItems: 5, values: [
            { value: 'https://x/stories/abc123', items: 3, pct: 60 },
            { value: 'https://x/stories/def456', items: 2, pct: 40 }
          ], absentPct: 0 };
        }
        return { totalItems: 5, values: [{ value: '/stories/1', items: 5, pct: 100 }], absentPct: 0 };
      }
    };
    const out = await AP.proposeArtifact({ probes, requirementText: REQ_FULL, outputSchema: SCHEMA_249(), currentArtifact: null });
    assert.equal(out.selectorProvenance.source, 'path-prefix', 'the sweep derived the path identity from live href samples');
    assert.equal(out.selectorProvenance.identitySelector, 'a[href*="/stories/"]');
    const wait = out.steps.find((s) => s.id === 'wait');
    assert.match(wait.script, /:has\(a\[href\*=\\?"\/stories\/\\?"\]\)/, 'the emitted CARD binds the path prefix');
    assert.ok(attrCalls.some((a) => a.containerSel === '[role=article] [href]' && a.attr === 'href'),
      'the P2-F attr-grounding hop censuses the EMITTED path-prefix card');
  });
  it('249 FIX 2 (sweep): a failed href hop → pathIdentity absent, provenance stays url-lane, never a crash', async () => {
    const census = {
      containerSel: '[role=article]', total: 8, sampled: [{}],
      lanes: {
        url: [{ selector: 'a.x1i10hfl', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
        time: [], count: [], id: [], text: []
      },
      hrefIdentity: [{ token: 'path:last', coverage: '5/5', samples: ['abc123', 'def456'] }]
    };
    const probes = {
      count: async (a) => ({ count: a.sel === '[role=article]' ? 12 : 0 }),
      census: async () => census,
      attrStats: async () => { throw new Error('tab gone'); }
    };
    const out = await AP.proposeArtifact({ probes, requirementText: REQ_FULL, outputSchema: SCHEMA_249(), currentArtifact: null });
    assert.equal(out.applied, 'engine-pending', 'a failed hop is an evidence gap, never a crash');
    assert.equal(out.selectorProvenance.source, 'url-lane');
    assert.equal(out.selectorProvenance.identitySelector, 'a.x1i10hfl');
  });

  // --- FIX 3: the propose receipt surfaces census.mount ---
  it('249 FIX 3: census.mount rides EVERY receipt shape (engine-pending, applied, error)', async () => {
    const MOUNT = { rounds: 1, countBefore: 3, countAfter: 9, reCensused: true };
    const census = Object.assign(CENSUS_249(), { mount: MOUNT });
    const mkProbes = () => ({ count: async () => ({ count: 12 }), census: async () => census, sample: async () => ({}) });
    const pending = await AP.proposeArtifact({ probes: mkProbes(), requirementText: REQ_FULL, outputSchema: SCHEMA_249(), currentArtifact: null });
    assert.deepEqual(pending.censusMount, MOUNT, 'engine-pending shape carries censusMount');
    const applied = await AP.proposeArtifact({ probes: mkProbes(), requirementText: REQ_FULL, outputSchema: SCHEMA_249(), currentArtifact: null, applyArtifact: async () => ({ version: 4 }) });
    assert.deepEqual(applied.censusMount, MOUNT, 'applied shape carries censusMount');
    const errored = await AP.proposeArtifact({ probes: mkProbes(), requirementText: REQ_FULL, outputSchema: SCHEMA_249(), currentArtifact: null, applyArtifact: async () => { throw new Error('SYNTAX_ERROR: gate'); } });
    assert.deepEqual(errored.censusMount, MOUNT, 'error shape carries censusMount');
  });
  it('249 FIX 3: no mount on the census → censusMount stays undefined', async () => {
    const out = await AP.proposeArtifact({
      probes: { count: async () => ({ count: 12 }), census: async () => CENSUS_249(), sample: async () => ({}) },
      requirementText: REQ_FULL, outputSchema: SCHEMA_249(), currentArtifact: null
    });
    assert.equal(out.censusMount, undefined);
  });
});

describe('joint solver — red receipts carry fragments', () => {
  const { createVerifyRunner } = require('../lib/verify-runner');
  const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
    type: 'object', required: ['content', 'postTime'], properties: { content: { type: 'string' }, postTime: { type: 'string' } } } } } };
  function run(records, sessionEvidence, diagRow, serviceSteps) {
    const runner = createVerifyRunner({
      ensureLock: async () => {}, releaseLock: async () => {},
      createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
      getSignal: () => null, log: () => {}, onEvent: () => {},
      orchestrate: async (svc, input, d, opts) => {
        await d.createTab(svc.targetUrl);
        opts.onEvent({ type: 'EXECUTION_START' });
        if (diagRow) opts.onEvent({ type: 'STEP_ITERATION', stepId: 's1', selectorDiagnostics: [diagRow] });
        return { finalResult: { posts: records }, steps: [], pages: [], pagesTruncated: false };
      }
    });
    return runner({ service: { targetUrl: 'https://e.com', steps: serviceSteps || [{ id: 's1', name: 's', script: 'return 1;', onSuccess: 'TERMINATE' }], config: {} }, input: { count: 3 }, outputSchema: SCHEMA, sessionEvidence: sessionEvidence });
  }
  it('REQUIREMENT_EXPAND_DROPPED carries the paste-ready $clickInList step', async () => {
    const out = await run(
      [{ content: 'body #' + Math.random().toString(36).slice(2, 8) + ' … See more', postTime: 'November 3, 2025' },
       { content: 'body2 … See more', postTime: 'November 3, 2025' }],
      { requirementText: '若有"展开"操作，点击展开加载完整正文。' },
      { api: 'extractWithHover', containerSelector: '[role=article]' });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /REQUIREMENT_EXPAND_DROPPED/);
    assert.match(out.report.error.message, /PASTE-READY: await \$clickInList\("\[role=article\]"/);
  });
  it('REQUIREMENT_EXCLUSION_LEAKED carries the assembly guard fragment', async () => {
    const out = await run(
      [{ content: 'x #' + Math.random().toString(36).slice(2, 8), postTime: 'Ad' },
       { content: 'y #' + Math.random().toString(36).slice(2, 8), postTime: 'Ad' }],
      { requirementText: '剔除发帖账号为Ad的条目。悬浮窗时间戳作为发帖时间。' }, null);
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /REQUIREMENT_EXCLUSION_LEAKED/);
    assert.match(out.report.error.message, /PASTE-READY guard: \.filter\(function \(p\) \{ return String\(p\.postTime/);
  });
  it('REQUIREMENT_TIME_SOURCE_DROPPED carries the hoverPopover fieldMap fragment', async () => {
    const out = await run(
      [{ content: 'x #' + Math.random().toString(36).slice(2, 8), postTime: 'November 3, 2025' },
       { content: 'y #' + Math.random().toString(36).slice(2, 8), postTime: '2 days ago' }],
      { requirementText: '悬浮窗的时间戳信息作为发帖时间，提取帖子正文。', lastFullAbsolute: 'November 3, 2025' }, null);
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /REQUIREMENT_TIME_SOURCE_DROPPED/);
    assert.match(out.report.error.message, /PASTE-READY fieldMap:/);
    assert.match(out.report.error.message, /read: 'hoverPopover'/);
  });
  // Review batch (joint-solver #9): the CARD/anchorSel literal scans were
  // single-quote-only, but the proposer (and JSON.stringify generally)
  // emits DOUBLE quotes — the fallback could never see its own artifact's
  // literal and silently degraded to the ARIA bootstrap on every propose.
  it('double-quoted const CARD literal feeds the expand fragment (both quote styles)', async () => {
    const stepsDbl = [{ id: 's1', name: 's', script: 'const CARD = "[role=article]:has(a)";\nreturn 1;', onSuccess: 'TERMINATE' }];
    const outDbl = await run(
      [{ content: 'body #' + Math.random().toString(36).slice(2, 8) + ' … See more', postTime: 'November 3, 2025' },
       { content: 'body2 … See more', postTime: 'November 3, 2025' }],
      { requirementText: '若有"展开"操作，点击展开加载完整正文。' }, null, stepsDbl);
    assert.equal(outDbl.report.ok, false);
    assert.match(outDbl.report.error.message, /REQUIREMENT_EXPAND_DROPPED/);
    assert.match(outDbl.report.error.message, /PASTE-READY: await \$clickInList\("\[role=article\]:has\(a\)"/);
    const stepsSgl = [{ id: 's1', name: 's', script: "const CARD = 'div.card';\nreturn 1;", onSuccess: 'TERMINATE' }];
    const outSgl = await run(
      [{ content: 'body3 #' + Math.random().toString(36).slice(2, 8) + ' … See more', postTime: 'November 3, 2025' },
       { content: 'body4 … See more', postTime: 'November 3, 2025' }],
      { requirementText: '若有"展开"操作，点击展开加载完整正文。' }, null, stepsSgl);
    assert.match(outSgl.report.error.message, /PASTE-READY: await \$clickInList\("div\.card"/);
  });
  it('double-quoted anchorSel literal feeds the hoverPopover fragment (both quote styles)', async () => {
    const stepsDbl = [{ id: 's1', name: 's', script: 'const cfg = { hover: { anchorSel: "a[href*=x] span" } };\nreturn 1;', onSuccess: 'TERMINATE' }];
    const outDbl = await run(
      [{ content: 'x #' + Math.random().toString(36).slice(2, 8), postTime: 'November 3, 2025' },
       { content: 'y #' + Math.random().toString(36).slice(2, 8), postTime: '2 days ago' }],
      { requirementText: '悬浮窗的时间戳信息作为发帖时间，提取帖子正文。', lastFullAbsolute: 'November 3, 2025' }, null, stepsDbl);
    assert.equal(outDbl.report.ok, false);
    assert.match(outDbl.report.error.message, /REQUIREMENT_TIME_SOURCE_DROPPED/);
    assert.match(outDbl.report.error.message, /PASTE-READY fieldMap: postTime: \{ selector: "a\[href\*=x\] span"/);
    const stepsSgl = [{ id: 's1', name: 's', script: "const cfg = { hover: { anchorSel: 'h3 a' } };\nreturn 1;", onSuccess: 'TERMINATE' }];
    const outSgl = await run(
      [{ content: 'x2 #' + Math.random().toString(36).slice(2, 8), postTime: 'November 3, 2025' },
       { content: 'y2 #' + Math.random().toString(36).slice(2, 8), postTime: '2 days ago' }],
      { requirementText: '悬浮窗的时间戳信息作为发帖时间，提取帖子正文。', lastFullAbsolute: 'November 3, 2025' }, null, stepsSgl);
    assert.match(outSgl.report.error.message, /PASTE-READY fieldMap: postTime: \{ selector: "h3 a"/);
  });
});

// 253b (P3-A): the hover clause was a dead knob — parseRequirementClauses
// parsed it but synthesizeFromEvidence never read it, so EVERY synthesis ran
// $extractWithHover (hover wall budget per extract) even when the requirement
// asked for no hover source and no hover evidence existed. When the clause is
// absent AND the timeHover receipt proves no absolute, the extract degrades
// to $extractList: no hover option object, no tsHover (read:'hoverPopover')
// field — $extractList hard-rejects hoverPopover specs by contract — while
// tsAria/tsLabel stay when a time lane exists (ARIA reads need no hover
// phase).
describe('joint solver — 253b A: hover-clause degradation to $extractList', () => {
  const REQ_NOHOVER = '提取帖子正文与链接。'; // no 悬浮/hover/tooltip/popover words, no scroll/expand
  const SCHEMA_A = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
    type: 'object', required: ['postId', 'postUrl', 'postTime', 'content'], properties: {
      postId: { type: 'string' }, postUrl: { type: 'string' }, postTime: { type: 'string' },
      content: { type: 'string' }, likeCount: { type: 'string' }, commentCount: { type: 'string' },
      shareCount: { type: 'string' }, mediaUrls: { type: 'array', items: { type: 'string' } },
      htmlSnippet: { type: 'string' } } } } } };
  const CENSUS_A = () => ({
    containerSel: '[role=article]',
    total: 12,
    sampled: [{}],
    lanes: {
      url: [{ selector: 'a[href*="/posts/"], a[href*="story"]', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['link1', 'link2'] }],
      time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025', '2 days ago'] }],
      count: [{ selector: '[aria-label]', tag: 'div', strength: 'medium', coverage: '5/5', texts: ['Like: 185 people', '9 comments'] }],
      id: [],
      text: [{ selector: 'div.msg', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['body'] }]
    },
    hrefIdentity: [{ token: 'query:story_fbid', coverage: '5/5', samples: ['101a', '202b'] }, { token: 'path:last', coverage: '5/5', samples: ['p1', 'p2'] }]
  });
  it('no hover clause + no timeHover → $extractList, no hover opts, no tsHover field; tsAria/tsLabel kept when a time lane exists', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_A() }, REQ_NOHOVER, SCHEMA_A);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.match(ex.script, /\$extractList\(CARD, \{/);
    assert.doesNotMatch(ex.script, /\$extractWithHover/);
    assert.doesNotMatch(ex.script, /hover:\s*\{/);
    assert.doesNotMatch(ex.script, /read: 'hoverPopover'/, 'tsHover dropped — $extractList rejects hoverPopover specs');
    assert.doesNotMatch(ex.script, /anchorSel/);
    assert.match(ex.script, /tsAria: \{/, 'the time lane still binds tsAria');
    assert.match(ex.script, /tsLabel: \{/, 'the time lane still binds tsLabel');
    assert.equal(ex.name, 'extract cards', 'the step name drops the hover claim');
  });
  it('no hover clause + no time lane → no ts fields at all, postTime unfilled (degraded form)', () => {
    const noTime = CENSUS_A();
    noTime.lanes.time = [];
    const out = AP.synthesizeFromEvidence({ census: noTime }, REQ_NOHOVER, SCHEMA_A);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.match(ex.script, /\$extractList\(/);
    assert.doesNotMatch(ex.script, /tsAria: \{/);
    assert.ok(out.unfilled.some((u) => u.slot === 'postTime'));
  });
  it('hover clause present → $extractWithHover retained (current behavior unchanged)', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_A() }, '提取帖子正文与悬浮窗时间。', SCHEMA_A);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.match(ex.script, /\$extractWithHover\(/);
    assert.match(ex.script, /read: 'hoverPopover'/);
    assert.match(ex.script, /hover:\s*\{ anchorSel:/);
    assert.equal(ex.name, 'extract cards with hover');
  });
  it('no hover clause BUT timeHover absolute evidence → $extractWithHover retained (hover dance justified by evidence)', () => {
    const census = CENSUS_A();
    census.lanes.time = [];
    census.timeHover = { anchorSel: 'abbr[aria-label]', candidates: [{ value: 'November 3, 2025', relative: false }] };
    const out = AP.synthesizeFromEvidence({ census }, REQ_NOHOVER, SCHEMA_A);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.match(ex.script, /\$extractWithHover\(/);
    assert.match(ex.script, /read: 'hoverPopover'/);
    assert.ok(!out.unfilled.some((u) => u.slot === 'postTime'));
  });
  it('compile + behavioral: the degraded script constructs and assembles records with no hovercards/tsHover present', async () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_A() }, REQ_NOHOVER, SCHEMA_A);
    const ex = out.steps.find((s) => s.id === 'extract');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let fn;
    assert.doesNotThrow(() => { fn = new AsyncFunction('__input__', '$extractList', ex.script); }, 'degraded form must construct');
    const rs = [
      { postUrl: 'https://e.com/p/1?story_fbid=aaa111', tsAria: 'November 3, 2025', content: 'body' },
      { postUrl: 'https://e.com/p/2?story_fbid=bbb222', tsAria: '2 days ago', content: 'body2' }
    ];
    const res = await fn({ count: 5 }, async () => rs);
    assert.equal(res.posts.length, 2, 'records without hovercards/tsHover assemble');
    assert.equal(res.posts[0].postTime, 'November 3, 2025', 'absolute from tsAria wins');
    assert.equal(res.posts[1].postTime, '2 days ago', 'relative falls through when it is all there is');
  });
});

// 253b (P3-B): the synthesized count-label matchers were English-only — a
// CJK page's own count carriers (赞 1.2万 / 评论 34 / 转发 5) resolved to
// nothing while the labels carrier had the values in hand. Web-generic CJK
// alternates (赞/点赞/评论/转发/分享 — no vendor tokens), the digit
// requirement kept so bare prose like 点赞过的朋友 cannot pose as a count.
describe('joint solver — 253b B: CJK count labels resolve', () => {
  const REQ_NOHOVER = '提取帖子正文与链接。';
  const SCHEMA_B = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
    type: 'object', required: ['postId', 'postUrl', 'postTime', 'content'], properties: {
      postId: { type: 'string' }, postUrl: { type: 'string' }, postTime: { type: 'string' },
      content: { type: 'string' }, likeCount: { type: 'string' }, commentCount: { type: 'string' },
      shareCount: { type: 'string' }, mediaUrls: { type: 'array', items: { type: 'string' } },
      htmlSnippet: { type: 'string' } } } } } };
  const CENSUS_B = () => ({
    containerSel: '[role=article]', total: 12, sampled: [{}],
    lanes: {
      url: [{ selector: 'a[href*="/posts/"]', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
      time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }],
      count: [{ selector: '[aria-label]', tag: 'div', strength: 'medium', coverage: '5/5', texts: ['Like: 185 people'] }],
      id: [], text: []
    },
    hrefIdentity: [{ token: 'query:story_fbid', coverage: '5/5', samples: ['101a'] }]
  });
  async function compileWith(census) {
    const out = AP.synthesizeFromEvidence({ census }, REQ_NOHOVER, SCHEMA_B);
    const ex = out.steps.find((s) => s.id === 'extract');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    return new AsyncFunction('__input__', '$extractList', ex.script);
  }
  it("behavioral: ['赞 1.2万', '评论 34', '转发 5'] → likeCount/commentCount/shareCount populated", async () => {
    const fn = await compileWith(CENSUS_B());
    const rs = [{ postUrl: 'https://e.com/p/1?story_fbid=aaa111', labels: ['赞 1.2万', '评论 34', '转发 5'] }];
    const res = await fn({ count: 5 }, async () => rs);
    assert.equal(res.posts[0].likeCount, '1.2', 'the CJK like label parses to its digit run');
    assert.equal(res.posts[0].commentCount, '34');
    assert.equal(res.posts[0].shareCount, '5');
  });
  it('regression: English labels still parse (Like: 185 people / 9 comments / 2 shares)', async () => {
    const fn = await compileWith(CENSUS_B());
    const rs = [{ postUrl: 'https://e.com/p/1?story_fbid=aaa111', labels: ['Like: 185 people', '9 comments', '2 shares'] }];
    const res = await fn({ count: 5 }, async () => rs);
    assert.equal(res.posts[0].likeCount, '185');
    assert.equal(res.posts[0].commentCount, '9');
    assert.equal(res.posts[0].shareCount, '2');
  });
  it('label-shaped prose without digits never poses as a count (点赞过的朋友 / 转发此贴)', async () => {
    const fn = await compileWith(CENSUS_B());
    const rs = [{ postUrl: 'https://e.com/p/1?story_fbid=aaa111', labels: ['点赞过的朋友', '转发此贴给好友'] }];
    const res = await fn({ count: 5 }, async () => rs);
    assert.equal(res.posts[0].likeCount, '', 'no digit → no count claim');
    assert.equal(res.posts[0].commentCount, '');
    assert.equal(res.posts[0].shareCount, '');
  });
});

// 253b (P3-E): the unfilled entries for the two recurring slots (postTime,
// the count family) gain a paste-ready `template` built from the best
// available evidence — the model pastes instead of composing against the
// fieldMap shape. Filled slots carry none.
describe('joint solver — 253b E: unfilled-slot binding templates', () => {
  const SCHEMA_E = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
    type: 'object', required: ['postId', 'postUrl', 'postTime', 'content'], properties: {
      postId: { type: 'string' }, postUrl: { type: 'string' }, postTime: { type: 'string' },
      content: { type: 'string' }, likeCount: { type: 'string' }, commentCount: { type: 'string' },
      shareCount: { type: 'string' }, mediaUrls: { type: 'array', items: { type: 'string' } },
      htmlSnippet: { type: 'string' } } } } } };
  const CENSUS_E = (opts) => {
    const c = {
      containerSel: '[role=article]', total: 12, sampled: [{}],
      lanes: {
        url: [{ selector: 'a[href*="/posts/"]', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
        time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }],
        count: [{ selector: '[aria-label]', tag: 'div', strength: 'medium', coverage: '5/5', texts: ['Like: 185'] }],
        id: [], text: [{ selector: 'div.msg', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['body'] }]
      },
      hrefIdentity: [{ token: 'query:story_fbid', coverage: '5/5', samples: ['101a'] }]
    };
    if (opts && opts.noTime) c.lanes.time = [];
    if (opts && opts.noCount) c.lanes.count = [];
    if (opts && opts.noUrl) { c.lanes.url = []; c.hrefIdentity = []; }
    return c;
  };
  it('postTime unfilled (DEGRADED form) → template carries tsAria/tsLabel + the switch note, NEVER a hoverPopover spec $extractList rejects', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_E({ noTime: true, noCount: true }) }, '提取帖子正文。', SCHEMA_E);
    const e = out.unfilled.find((u) => u.slot === 'postTime');
    assert.ok(e && typeof e.template === 'string', 'postTime entry carries a template');
    assert.ok(e.template.includes('tsAria: { selector: "span[aria-label]", attr: \'aria-label\' }'));
    assert.ok(e.template.includes('tsLabel: { selector: "span[aria-label]", labelledby: true }'));
    // Review batch (#2): no hover clause + no timeHover absolute → the
    // synthesis runs the degraded $extractList form, and a pasted
    // read:'hoverPopover' spec would be hard-REJECTED by $extractList.
    assert.ok(!e.template.includes("read: 'hoverPopover'"), 'no tsHover in the degraded template');
    assert.ok(!/tsHover:\s*\{/.test(e.template), 'no tsHover field spec at all');
    assert.ok(e.template.includes('// add tsHover only after switching the call to $extractWithHover (hoverPopover specs are rejected by $extractList)'),
      'the note teaches the switch');
  });
  it('postTime unfilled (HOVER form) → the template retains tsHover with the pasteable year-match regex', () => {
    // Hover clause present but no time lane → the synthesis keeps
    // $extractWithHover, so the template may (and must) carry the tsHover
    // binding the form can actually run.
    const out = AP.synthesizeFromEvidence({ census: CENSUS_E({ noTime: true, noCount: true }) }, '提取帖子正文，悬浮窗时间戳作为发帖时间。', SCHEMA_E);
    const e = out.unfilled.find((u) => u.slot === 'postTime');
    assert.ok(e && typeof e.template === 'string', 'postTime entry carries a template');
    assert.ok(e.template.includes('tsAria: { selector: "span[aria-label]", attr: \'aria-label\' }'));
    assert.ok(e.template.includes('tsHover: { selector: "span[aria-label]", read: \'hoverPopover\', match: /(19|20)\\d{2}/ }'), 'pasteable year-match regex literal');
    assert.ok(!e.template.includes('// add tsHover only after switching'), 'no degradation note on the hover form');
  });
  it('postTime unfilled but the timeHover receipt ran → the template binds the receipt\'s OWN anchorSel (best available evidence)', () => {
    const census = CENSUS_E({ noTime: true, noCount: true });
    census.timeHover = { anchorSel: 'abbr[aria-label]', candidates: [{ value: '2 days ago', relative: true }] };
    const out = AP.synthesizeFromEvidence({ census }, '提取帖子正文。', SCHEMA_E);
    const e = out.unfilled.find((u) => u.slot === 'postTime');
    assert.ok(e && e.template.includes('tsAria: { selector: "abbr[aria-label]"'), 'relative-only receipt still names its measured anchor');
  });
  it('count slots unfilled → each carries the labels carrier + its family parse line (CJK alternates included)', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_E({ noTime: true, noCount: true }) }, '提取帖子正文。', SCHEMA_E);
    const like = out.unfilled.find((u) => u.slot === 'likeCount');
    assert.ok(like && like.template.includes("labels: { selector: '[aria-label]', attr: 'aria-label', multi: true }"), 'labels carrier template');
    assert.ok(like.template.includes('赞'), 'the like parse line carries the CJK alternate');
    const comm = out.unfilled.find((u) => u.slot === 'commentCount');
    assert.ok(comm && comm.template.includes('评论'), 'comment parse line carries 评论');
    const shr = out.unfilled.find((u) => u.slot === 'shareCount');
    assert.ok(shr && shr.template.includes('转发'), 'share parse line carries 转发');
  });
  // Review batch (#13): the assembly half of the count template ships as RAW
  // code. The old '// parse in the assembly: const labs = …' comment wrapper
  // made every pasteable parse line inert — pasting it delivered a comment,
  // not code.
  it('count templates: the assembly lines are RAW code — no "// parse" wrapper, and the fragment compiles', () => {
    const out = AP.synthesizeFromEvidence({ census: CENSUS_E({ noTime: true, noCount: true }) }, '提取帖子正文。', SCHEMA_E);
    for (const slot of ['likeCount', 'commentCount', 'shareCount']) {
      const e = out.unfilled.find((u) => u.slot === slot);
      assert.ok(e, slot + ' unfilled');
      assert.ok(typeof e.assemblyFragment === 'string', slot + ' carries a separate assemblyFragment');
      assert.ok(!/^\/\//.test(e.assemblyFragment), 'the fragment is raw code, not a comment');
      assert.ok(!e.assemblyFragment.includes('// parse in the assembly'), 'no legacy comment wrapper');
      // every assembly line in the combined template is code or a trailing
      // comment — never a whole swallowed line
      const assemblyLines = e.template.split('\n').filter((l) => /const labs|const m =/.test(l));
      assert.ok(assemblyLines.length >= 1, slot + ': assembly lines present in the template');
      assert.ok(assemblyLines.every((l) => !/^\/\/\s*parse/.test(l.trim())), 'no leading // parse comment on assembly lines');
      // the raw fragment must CONSTRUCT — it is pasteable step code
      assert.doesNotThrow(() => { new Function('r', 'num', e.assemblyFragment); }, slot + ' assemblyFragment compiles: ' + e.assemblyFragment);
    }
    // behavioral: the compiled like-fragment picks the like lane out of labels
    const like = out.unfilled.find((u) => u.slot === 'likeCount');
    const fn = new Function('r', 'num', like.assemblyFragment + '\nreturn m;');
    const m = fn({ labels: ['Like: 185 people', '9 comments'] }, (s) => s);
    assert.equal(m, 'Like: 185 people', 'the raw parse line finds the like label');
  });
  it('filled slots carry no template — non-recurring unfilled entries (postUrl) stay template-free too', () => {
    const filled = AP.synthesizeFromEvidence({ census: CENSUS_E() }, '提取帖子正文。', SCHEMA_E);
    assert.ok(!filled.unfilled.some((u) => u.slot === 'postTime' || u.slot === 'likeCount'), 'time+count lanes filled → no such unfilled entries');
    assert.ok(filled.unfilled.every((u) => !('template' in u)), 'no template rides entries whose slot is not a recurring binding gap');
    const out = AP.synthesizeFromEvidence({ census: CENSUS_E({ noUrl: true }) }, '提取帖子正文。', SCHEMA_E);
    const e = out.unfilled.find((u) => u.slot === 'postUrl');
    assert.ok(e && !('template' in e), 'postUrl gap keeps its reason-only shape');
  });
});

// 253b (P3-D): the lib-unresolved error names BOTH exits — the wizard
// console reload path AND the hand-authored fallback (the tool is an
// accelerator, not a requirement).
describe('joint solver — session-tools registration', () => {
  it('the tool is registered with a compact spec and calls proposeArtifact', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'session-tools.js'), 'utf8');
    assert.match(src, /'artifact\.propose': \(async/, 'handler registered');
    assert.match(src, /artifact\.propose \{\} — the joint solver/, 'spec text present');
    assert.match(src, /proposeArtifact\(\{/, 'wired to the proposer');
  });
  it('toolSpec budget stays under 6500 chars (real {name,args,returns} shape)', () => {
    const { createSessionTools } = require('../lib/session-tools');
    const t = createSessionTools({ rail: { executeDsl: async () => ({}) }, runVerify: async () => ({}), probeFactory: () => ({}), getDraftService: () => null, applyArtifact: async () => ({}), getTestInput: () => ({}), getOutputSchema: () => ({}), getSteps: () => [] });
    const total = t.toolSpecs.reduce((a, s) => a + (s.args || '').length + (s.returns || '').length, 0);
    assert.ok(total <= 6500, 'toolSpec total ' + total + ' <= 6500');
  });
  // 253b (P3-D): the lib-unresolved error receipt names BOTH exits — reload
  // the extension after checking the wizard console, or fall back to the
  // hand-authored pipeline (the tool is an accelerator, not a requirement).
  it('253b D: the lib-unresolved error names both exits (console+reload / hand-authored fallback)', () => {
    const fs2 = require('node:fs');
    const src = fs2.readFileSync(require('path').join(__dirname, '..', 'lib', 'session-tools.js'), 'utf8');
    assert.match(src, /artifact-proposer lib unresolved — check script load order in wizard\.html — exits: \(a\) check the wizard console for the script-load error and reload the extension; \(b\) continue with hand-authored probes \+ service\.update as before \(this tool is an accelerator, not a requirement\)/);
  });
});

describe('joint solver — red→propose nudge', () => {
  const { createResearchSession } = require('../lib/research-session');
  const mk = (content) => ({ content, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const env = (tool, args) => mk(JSON.stringify({ think: 't', tool, args: args || {} }));
  const fin = (s) => mk(JSON.stringify({ think: 'done', finish: { summary: s || 'x' } }));
  const SCHEMAS = { inputSchema: { type: 'object', properties: { k: { type: 'string' } } }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } };
  const STEP1 = { id: 's1', name: 's', onSuccess: 'TERMINATE', script: 'return 1;' };
  function makeSession(replies, verifyResults, opts) {
    let vi = 0, draft = null;
    // Review batch (joint-solver #12): the probe-count stub is injectable so
    // a rejection-path propose test can ground-reject (count 0 → the
    // grounding gate refuses every selector claim).
    const countVal = (opts && typeof opts.countVal === 'number') ? opts.countVal : 5;
    const { createSessionTools } = require('../lib/session-tools');
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => { const r = verifyResults[Math.min(vi, verifyResults.length - 1)]; vi += 1; return r; },
      // 248th round: the stub census carries NO hrefIdentity tokens — a bare
      // 'a' url lane is kept verbatim, so the synthesized CARD stays
      // attr-free. These routing/lineage tests stub the whole probe bag
      // (nothing records observation receipts), and a token-derived
      // a[href*=…] CARD would demand an attr-distribution receipt the
      // stubs can never land — the churn-proof selector path is covered by
      // the unit tests above and the P2-F alignment test.
      probeFactory: () => ({ count: async () => ({ count: countVal }), census: async () => ({ containerSel: '[role=article]', total: 5, sampled: [{}], lanes: { url: [{ selector: 'a', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }], time: [{ selector: 'span', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }], count: [], id: [], text: [{ selector: 'div', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['b'] }] }, hrefIdentity: [] }), sample: async () => ({}) }),
      getDraftService: () => draft, applyArtifact: (a) => { draft = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; return Promise.resolve({ version: draft.steps.length }); },
      getTestInput: () => ({ k: 'ml' }), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => (draft ? draft.steps : []),
      ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
    }).tools;
    let i = 0;
    return createResearchSession({ requirement: 'collect posts', llm: async () => { const r = replies[Math.min(i, replies.length - 1)]; i += 1; return r; }, tools, onEvent: () => {} });
  }
  const RED = { events: [], report: { ok: false, error: { message: 'REQUIREMENT_TIME_SOURCE_DROPPED: red' }, detectors: {} }, raw: {} };

  it('a red injects the routing note; propose clears; a second red re-nudges once', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STEP1] }),
      env('verify.run', {}),
      env('artifact.propose', {}),
      env('verify.run', {}),
      fin('done')
    ], [RED, RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const notes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text)
      .filter((t) => /RED → artifact\.propose/.test(t));
    assert.equal(notes.length, 2, 'one nudge per red episode');
  });
  // C1 (final review): artifact.propose must apply through the EXACT
  // service.update pipeline — grounding gates, staticLint/syntax/chain
  // gates, applySessionArtifact, artifactVersions lineage, artifact_version
  // event, step-plan rebuild. The old bare d.applyArtifact setter skipped
  // all of them and the first green verify would stamp a stale
  // executedArtifactVersion.
  it('artifact.propose flows through the service.update pipeline: version lineage + gates', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('artifact.propose', {}),
      fin('done')
    ], [RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const st = session.state().session;
    assert.ok(st.artifactVersions.length >= 1, 'a version was recorded');
    const v1 = st.artifactVersions[st.artifactVersions.length - 1];
    assert.ok(Array.isArray(v1.steps) && v1.steps.length >= 2, 'the synthesized steps are the recorded version');
    // The propose receipt the model saw must carry the update outcome —
    // applied:true + the recorded version, never a bare-setter receipt.
    const proposeResult = session.state().session.transcript
      .filter((t) => t.kind === 'tool' && t.name === 'artifact.propose')
      .map((t) => t.result).pop();
    assert.ok(proposeResult && proposeResult.applied === true, 'receipt says applied through the pipeline');
    assert.equal(proposeResult.version, v1.version, 'receipt version matches the recorded lineage entry');
    assert.ok(!proposeResult.steps, 'the raw step graph does not leak into the receipt');
  });
  it('no nudge when propose is called before the next note-injection point', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STEP1] }),
      env('verify.run', {}),
      env('artifact.propose', {}),
      fin('done')
    ], [RED]);
    await session.run();
    const notes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text)
      .filter((t) => /RED → artifact\.propose/.test(t));
    assert.ok(notes.length <= 1);
  });
  // Review batch (joint-solver #10): the nudge used to arm on EVERY red —
  // but its text promises fragments/evidence the gate families carry. A red
  // like MISSING_URL_PARAM has no fragment to paste; the note is noise that
  // trains the model to ignore it. Arming is bounded to the
  // fragment-carrying families.
  it('a red outside the fragment-carrying families does NOT arm the nudge', async () => {
    const RED_OTHER = { events: [], report: { ok: false, error: { message: 'MISSING_URL_PARAM: testInput missing for {{k}}' }, detectors: {} }, raw: {} };
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STEP1] }),
      env('verify.run', {}),
      fin('done')
    ], [RED_OTHER]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const notes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text)
      .filter((t) => /RED → artifact\.propose/.test(t));
    assert.equal(notes.length, 0, 'MISSING_URL_PARAM carries no fragments — no routing nudge');
  });
  it('the nudge text names copy/paste-ready evidence, not fragments alone', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STEP1] }),
      env('verify.run', {}),
      fin('done')
    ], [RED]);
    await session.run();
    const note = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text)
      .find((t) => /RED → artifact\.propose/.test(t));
    assert.ok(note, 'family red arms the nudge');
    assert.match(note, /copy\/paste-ready evidence included/);
  });
  // 247th round (FIX C): the maiden joint-solver session hand-authored for
  // 40 turns without ever calling artifact.propose. One-time-per-session
  // routing note at the FIRST service.update with no prior propose — the
  // note lands BEFORE the update processes (same turn's context).
  it('247th: the first hand-authored service.update with no prior propose fires exactly ONE routing note; later updates stay silent', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STEP1] }),
      env('service.update', { steps: [STEP1] }),
      fin('done')
    ], []);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const notes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text)
      .filter((t) => /TOOL ROUTING: hand-authored service\.update/.test(t));
    assert.equal(notes.length, 1, 'exactly one routing note across two updates');
    assert.match(notes[0], /artifact\.propose \{\}/, 'the note names the call shape');
    assert.match(notes[0], /same gates/i);
    assert.match(notes[0], /slots the receipt lists as unfilled/);
    // The note rides the transcript BEFORE the triggering update's tool
    // entry (same turn's context), never after it.
    const kinds = session.state().session.transcript.map((t) => t.kind + ':' + (t.name || ''));
    const noteIdx = session.state().session.transcript.findIndex((t) => t.kind === 'system' && /TOOL ROUTING: hand-authored/.test(t.text || ''));
    const updIdx = session.state().session.transcript.findIndex((t) => t.kind === 'tool' && t.name === 'service.update');
    assert.ok(noteIdx > -1 && updIdx > -1 && noteIdx < updIdx, 'note precedes the update entry — order: ' + kinds.join(','));
  });
  it('247th: artifact.propose dispatched before any update → the routing note never fires', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('artifact.propose', {}),
      env('service.update', { steps: [STEP1] }),
      fin('done')
    ], []);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const notes = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text)
      .filter((t) => /TOOL ROUTING: hand-authored service\.update/.test(t));
    assert.equal(notes.length, 0, 'adoption observed — no routing note ever');
  });
  // Review batch (joint-solver #12): the merged propose receipt's `next` was
  // the handler's pass-through ('engine applies + verify.run') on BOTH
  // branches — a grounding-rejected propose told the model to verify an
  // artifact that was never applied.
  it('rejection-path propose: next names the FIX, not verify.run (grounding rejects when probes count 0)', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('artifact.propose', {}),
      fin('done')
    ], [RED], { countVal: 0 });
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const proposeResult = session.state().session.transcript
      .filter((t) => t.kind === 'tool' && t.name === 'artifact.propose')
      .map((t) => t.result).pop();
    assert.ok(proposeResult && proposeResult.applied === false, 'grounding rejection reports applied:false');
    assert.ok(proposeResult.updateReceipt && proposeResult.updateReceipt.grounding === 'rejected',
      'the update receipt carries the grounding rejection');
    assert.match(proposeResult.next, /fix the rejection/);
    assert.match(proposeResult.next, /artifact\.propose again/);
    assert.doesNotMatch(proposeResult.next, /verify\.run/);
  });
  it('applied-path propose: next stays verify.run', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('artifact.propose', {}),
      fin('done')
    ], [RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const proposeResult = session.state().session.transcript
      .filter((t) => t.kind === 'tool' && t.name === 'artifact.propose')
      .map((t) => t.result).pop();
    assert.ok(proposeResult && proposeResult.applied === true);
    assert.match(proposeResult.next, /^verify\.run$/);
  });
  // Review batch (joint-solver #P1-C): after a red verify, the engine routes
  // the propose synthesis through service.update — whose 118th-round
  // RED_VERIFY_SNIPPET_GATE rejected it (no dry-run since the red) and told
  // the model to "resend this service.update", steps the propose receipt
  // deleted. The sweep IS the fresh-evidence dry-run; the propose handler
  // credits it with the same flag probe.snippet sets.
  it('P1-C: red verify → artifact.propose applies WITHOUT the RED_VERIFY_SNIPPET_GATE bounce', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STEP1] }),
      env('verify.run', {}),
      env('artifact.propose', {}),
      fin('done')
    ], [RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const proposeResult = session.state().session.transcript
      .filter((t) => t.kind === 'tool' && t.name === 'artifact.propose')
      .map((t) => t.result).pop();
    assert.ok(proposeResult && proposeResult.applied === true, 'the propose applied — no deterministic bounce');
    assert.match(proposeResult.dryRunCredit || '', /joint-solver sweep credited as dry-run/);
    assert.doesNotMatch(JSON.stringify(proposeResult), /RED_VERIFY_SNIPPET_GATE/, 'the gate did not fire');
  });
  // Review batch (joint-solver #P2-G): the merged propose receipt buried the
  // pipeline failure inside updateReceipt — the transcript flagged a
  // grounding-rejected propose "ok". Lift error/grounding to the top level
  // so isErrorResult and the repeated-failure trackers classify it.
  it('P2-G: a grounding-rejected propose carries top-level grounding:rejected and flags the transcript NOT-ok', async () => {
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('artifact.propose', {}),
      fin('done')
    ], [RED], { countVal: 0 });
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const entries = session.state().session.transcript.filter((t) => t.kind === 'tool' && t.name === 'artifact.propose');
    const proposeResult = entries.map((t) => t.result).pop();
    assert.ok(proposeResult && proposeResult.applied === false);
    assert.equal(proposeResult.grounding, 'rejected', 'top-level grounding classification');
    assert.equal(entries[entries.length - 1].ok, false, 'isErrorResult sees the rejection');
  });
  it('P2-G: a gate-errored propose lifts updateReceipt.error to the top level', async () => {
    // No io.confirm first: the pipeline's I/O gate errors with a string —
    // the merged receipt must surface it as a top-level error.
    const session = makeSession([
      env('artifact.propose', {}),
      fin('done')
    ], [RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const entries = session.state().session.transcript.filter((t) => t.kind === 'tool' && t.name === 'artifact.propose');
    const proposeResult = entries.map((t) => t.result).pop();
    assert.ok(proposeResult && proposeResult.applied === false);
    assert.equal(typeof proposeResult.error, 'string', 'updateReceipt.error lifted to top level');
    assert.match(proposeResult.error, /I\/O CONTRACT UNCONFIRMED/);
    assert.equal(entries[entries.length - 1].ok, false, 'isErrorResult sees the error');
  });
  // Review batch (joint-solver #P2-J): a propose during a pending chunk
  // buffer concatenated stale steps in front of the synthesized graph.
  // propose is a FULL regeneration — the buffer is superseded, cleared, and
  // the clearing disclosed.
  it('P2-J: artifact.propose clears a pending update chunk buffer instead of concatenating it', async () => {
    const STALE = { id: 'stale', name: 'stale buffered step', script: 'return 1;', onSuccess: 'TERMINATE' };
    const session = makeSession([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('service.update', { steps: [STALE], more: true }),
      env('artifact.propose', {}),
      fin('done')
    ], [RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const proposeResult = session.state().session.transcript
      .filter((t) => t.kind === 'tool' && t.name === 'artifact.propose')
      .map((t) => t.result).pop();
    assert.equal(proposeResult.chunkBufferCleared, true, 'the clearing is disclosed on the receipt');
    assert.equal(proposeResult.applied, true);
    const st = session.state().session;
    const last = st.artifactVersions[st.artifactVersions.length - 1];
    assert.ok(last && last.steps.every((s) => s.id !== 'stale'),
      'the buffered stale chunk was never concatenated into the applied artifact');
  });
});

describe('joint solver — universality red line', () => {
  it('no vendor tokens in the proposer module', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'artifact-proposer.js'), 'utf8');
    for (const v of ['facebook', 'fbid', 'fbcdn', 'twitter', 'instagram']) {
      assert.doesNotMatch(src, new RegExp(v, 'i'), 'vendor token: ' + v);
    }
  });
});

// 252nd round (FIX B): the sweep's census runs {hover:true} and carries
// the probe.timestamp receipt in `timeHover` — with absolute candidates
// and the anchorSel the dance actually hovered. synthesizeFromEvidence
// ignored it: lanes.time absent → postTime unfilled, three live sessions
// straight, while the receipt's own absolute date sat in the pack.
describe('joint solver — 252 FIX B: timeHover evidence binds postTime when the time lane is absent', () => {
  const SCHEMA_252 = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
    type: 'object', required: ['postId', 'postUrl', 'postTime', 'content'], properties: {
      postId: { type: 'string' }, postUrl: { type: 'string' }, postTime: { type: 'string' }, content: { type: 'string' } } } } } };
  const noTimeCensus = () => ({
    containerSel: '[role=article]',
    total: 8,
    sampled: [{}],
    lanes: {
      url: [{ selector: 'a[href*="/posts/"]', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['link1', 'link2'] }],
      time: [],
      count: [{ selector: '[aria-label]', tag: 'div', strength: 'medium', coverage: '5/5', texts: ['Like: 185 people'] }],
      id: [],
      text: [{ selector: 'div[data-ad-comet-preview="message"]', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['body text'] }]
    },
    hrefIdentity: []
  });
  const REQ_252 = '提取帖子正文与悬浮窗时间。';

  it('timeHover with an absolute candidate → the ts triple binds the receipt anchorSel, postTime leaves unfilled, provenance names timeHover', () => {
    const census = noTimeCensus();
    census.timeHover = {
      containerSel: '[role=article]',
      anchorSel: 'abbr[aria-label]',
      anchorLog: [],
      candidates: [{ value: 'November 3, 2025', source: '__t_aria', relative: false, partial: false }],
      absolute: 'November 3, 2025'
    };
    const out = AP.synthesizeFromEvidence({ census }, REQ_252, SCHEMA_252);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.ok(ex.script.includes('tsAria: { selector: "abbr[aria-label]", attr: \'aria-label\' }'), 'tsAria bound to the receipt anchorSel');
    assert.ok(ex.script.includes('tsLabel: { selector: "abbr[aria-label]", labelledby: true }'), 'tsLabel bound to the receipt anchorSel');
    assert.ok(ex.script.includes('tsHover: { selector: "abbr[aria-label]", read: \'hoverPopover\', match: /(19|20)\\d{2}/ }'), 'tsHover carries the year match');
    assert.ok(!out.unfilled.some((u) => u.slot === 'postTime'), 'postTime is no longer an unfilled slot');
    assert.equal(out.selectorProvenance.timeSource, 'timeHover', 'provenance names the measured source');
    // No anchorSel on the receipt → the web-generic timestamp anchor union
    // fallback (still measured-adjacent: the candidates came from THIS
    // receipt's hover dance).
    const censusNoAnchor = noTimeCensus();
    censusNoAnchor.timeHover = { candidates: [{ value: 'November 3, 2025', relative: false }] };
    const out2 = AP.synthesizeFromEvidence({ census: censusNoAnchor }, REQ_252, SCHEMA_252);
    const ex2 = out2.steps.find((s) => s.id === 'extract');
    assert.ok(ex2.script.includes('tsAria: { selector: "a:has(span[aria-labelledby]), [aria-labelledby], abbr[aria-label], time"'),
      'the default timestamp anchor union is the no-anchorSel fallback');
    assert.equal(out2.selectorProvenance.timeSource, 'timeHover');
  });

  it('timeHover with RELATIVE-ONLY candidates (or an error receipt) → the honest unfilled postTime stays, no ts triple', () => {
    const census = noTimeCensus();
    census.timeHover = { containerSel: '[role=article]', anchorSel: 'abbr[aria-label]', anchorLog: [], candidates: [{ value: '2 days ago', source: '__t_text', relative: true, partial: false }], relative: '2 days ago' };
    const out = AP.synthesizeFromEvidence({ census }, REQ_252, SCHEMA_252);
    const ex = out.steps.find((s) => s.id === 'extract');
    // The ASSEMBLY loop references r.tsAria unconditionally (harmless on an
    // unbound field) — the claim under test is the FIELDMAP binding, i.e.
    // no `tsAria: {` field spec rides the $extractWithHover call.
    assert.ok(!/tsAria: \{/.test(ex.script), 'no ts triple from relative-only evidence');
    assert.ok(!/tsLabel: \{/.test(ex.script) && !/tsHover: \{/.test(ex.script), 'no ts field specs at all');
    assert.ok(out.unfilled.some((u) => u.slot === 'postTime'), 'the postTime gap stays disclosed');
    assert.notEqual(out.selectorProvenance.timeSource, 'timeHover', 'no timeHover provenance claim');
    // A hover-phase ERROR receipt ({error} shape — enhanced mode off, etc.)
    // is the same no-evidence class.
    const censusErr = noTimeCensus();
    censusErr.timeHover = { error: 'HOVER_SKIPPED_ENHANCED_MODE' };
    const outErr = AP.synthesizeFromEvidence({ census: censusErr }, REQ_252, SCHEMA_252);
    assert.ok(outErr.unfilled.some((u) => u.slot === 'postTime'), 'an error receipt never binds a ts triple');
    assert.ok(!/tsAria: \{/.test(outErr.steps.find((s) => s.id === 'extract').script));
  });

  it('lanes.time PRESENT → the lane still wins, unchanged (timeHover does not override measured lanes)', () => {
    const census = noTimeCensus();
    census.lanes.time = [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }];
    census.timeHover = { anchorSel: 'abbr[aria-label]', candidates: [{ value: 'November 3, 2025', relative: false }], absolute: 'November 3, 2025' };
    const out = AP.synthesizeFromEvidence({ census }, REQ_252, SCHEMA_252);
    const ex = out.steps.find((s) => s.id === 'extract');
    assert.ok(ex.script.includes('tsAria: { selector: "span[aria-label]"'), 'the time-LANE selector is bound');
    assert.ok(!ex.script.includes('abbr[aria-label]'), 'the timeHover anchor does not ride alongside');
    assert.notEqual(out.selectorProvenance.timeSource, 'timeHover', 'no timeHover claim when the lane owns the slot');
    assert.ok(!out.unfilled.some((u) => u.slot === 'postTime'), 'the lane binds it — no unfilled entry');
  });

  // Behavioral: the emitted extract script must actually PICK the absolute
  // from the stubbed $extractWithHover record — a syntactic triple that
  // never flows into postTime is the 252nd live-run shape again.
  it('behavioral: the compiled extract picks the absolute from tsAria into postTime', async () => {
    const census = noTimeCensus();
    census.timeHover = { containerSel: '[role=article]', anchorSel: 'abbr[aria-label]', candidates: [{ value: 'November 3, 2025', relative: false }], absolute: 'November 3, 2025' };
    const out = AP.synthesizeFromEvidence({ census }, REQ_252, SCHEMA_252);
    const ex = out.steps.find((s) => s.id === 'extract');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('__input__', '$extractWithHover', ex.script);
    const rs = [
      { postUrl: 'https://e.com/p/1?story_fbid=aaa111', tsAria: 'November 3, 2025', tsHover: '2 days ago' }
    ];
    const res = await fn({ count: 5 }, async () => rs);
    assert.equal(res.posts.length, 1);
    assert.equal(res.posts[0].postTime, 'November 3, 2025', 'the year-bearing candidate wins over the relative');
  });
});

// Review batch (joint-solver #5): the requirement-clause lexicon is
// SINGLE-SOURCED. verify-runner used to carry character-identical inline
// copies of the expand/exclusion/hover clause regexes at its three gate
// sites — copies drift (one already had). Lockstep: the proposer exports
// CLAUSE_RES; verify-runner must reference it and carry no lexicon of its
// own.
describe('joint solver — clause lexicon single-sourcing (lockstep)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const apSrc = () => fs.readFileSync(path.join(__dirname, '..', 'lib', 'artifact-proposer.js'), 'utf8');
  const vrSrc = () => fs.readFileSync(path.join(__dirname, '..', 'lib', 'verify-runner.js'), 'utf8');
  it('the proposer exports CLAUSE_RES covering every clause family it parses', () => {
    const AP2 = require('../lib/artifact-proposer');
    assert.ok(AP2.CLAUSE_RES && typeof AP2.CLAUSE_RES === 'object', 'CLAUSE_RES exported');
    for (const k of ['scroll', 'expand', 'hover', 'exclSeg']) {
      assert.ok(AP2.CLAUSE_RES[k] && typeof AP2.CLAUSE_RES[k].test === 'function', 'family ' + k + ' carries a regex');
    }
    assert.match(apSrc(), /CLAUSE_RES/);
  });
  it('verify-runner references the shared export and carries NO inline clause lexicon', () => {
    const vr = vrSrc();
    assert.ok(vr.indexOf('AP246.CLAUSE_RES') > -1, 'verify-runner resolves the proposer export');
    for (const inline of ['剔除|排除|过滤', '悬浮窗|悬浮|悬停', 'see\\s*more|expand|read\\s*more']) {
      assert.ok(vr.indexOf(inline) === -1, 'inline clause lexicon copy still present: ' + inline);
    }
  });
});
