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

describe('joint solver — red-receipt fragment renderers', () => {
  it('expand step fragment interpolates the artifact card selector', () => {
    const frag = AP.renderExpandStepFragment('[role=article]:has(a[href*="/posts/"])');
    // `\\?` tolerates the JSON.stringify quote-escaping inside the emitted
    // string literal (same contract as the :has() assertion above) — the
    // selector itself rides verbatim.
    assert.match(frag, /\$clickInList\("\[role=article\]:has\(a\[href\*=\\?"\/posts\/\\?"\]\)"/);
    assert.match(frag, /textFilter: '~see more\|展开'/);
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
      hrefIdentity: [{ token: 'id', coverage: '5/5', samples: ['a1', 'b2'] }]
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
});

describe('joint solver — red receipts carry fragments', () => {
  const { createVerifyRunner } = require('../lib/verify-runner');
  const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
    type: 'object', required: ['content', 'postTime'], properties: { content: { type: 'string' }, postTime: { type: 'string' } } } } } };
  function run(records, sessionEvidence, diagRow) {
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
    return runner({ service: { targetUrl: 'https://e.com', steps: [{ id: 's1', name: 's', script: 'return 1;', onSuccess: 'TERMINATE' }], config: {} }, input: { count: 3 }, outputSchema: SCHEMA, sessionEvidence: sessionEvidence });
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
});

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
});

describe('joint solver — red→propose nudge', () => {
  const { createResearchSession } = require('../lib/research-session');
  const mk = (content) => ({ content, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const env = (tool, args) => mk(JSON.stringify({ think: 't', tool, args: args || {} }));
  const fin = (s) => mk(JSON.stringify({ think: 'done', finish: { summary: s || 'x' } }));
  const SCHEMAS = { inputSchema: { type: 'object', properties: { k: { type: 'string' } } }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } };
  const STEP1 = { id: 's1', name: 's', onSuccess: 'TERMINATE', script: 'return 1;' };
  function makeSession(replies, verifyResults) {
    let vi = 0, draft = null;
    const { createSessionTools } = require('../lib/session-tools');
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => { const r = verifyResults[Math.min(vi, verifyResults.length - 1)]; vi += 1; return r; },
      probeFactory: () => ({ count: async () => ({ count: 5 }), census: async () => ({ containerSel: '[role=article]', total: 5, sampled: [{}], lanes: { url: [{ selector: 'a', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }], time: [{ selector: 'span', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }], count: [], id: [], text: [{ selector: 'div', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['b'] }] }, hrefIdentity: [{ token: 'id', coverage: '5/5', samples: ['a1', 'b2'] }] }), sample: async () => ({}) }),
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
