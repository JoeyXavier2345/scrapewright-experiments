// extension/test/two-hundred-fifty-first-log.test.js
//
// 251st round: the annotate.request escalation family (208th/230th — "when
// the organic population is uncertain, ask the user to MARK it") used to
// fire only on CONSECUTIVE VERIFY failures. The live session had 2
// differently-classed reds (below the consecutive threshold) and the model
// finished without a third verify — while the population-uncertainty signal
// was available EARLIER: the propose receipt's censusMount{goalMet:false} /
// class-anchored url-lane identity, and the (c) CONTAINER SUBSET red.
//
//   FIX 1 — propose receipt populationHint: weak identity (neither
//           hrefIdentity-tokens nor path-prefix) AND (mount goalMet:false OR
//           no identity tokens at all) → EVERY receipt shape carries a
//           populationHint that routes to annotate.request before selector
//           archaeology.
//   FIX 2 — the verify (c) CONTAINER SUBSET line gains the annotate exit
//           (asserted in two-hundred-forty-fourth-log.test.js, test C).
//   FIX 3 — engine one-shot nudge: a weak-identity propose past early
//           research (2nd propose OR a verify has run OR turns > 12) pushes
//           ONE POPULATION UNCERTAIN system note per session.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const AP = require('../lib/artifact-proposer');

const REQ_FULL = '从主工作区的信息流中提取帖子dom对象，注意要剔除主页推荐、账号推荐、小组、广告推荐、发帖账号为Ad（广告，没有发帖时间）等非正常帖子条目。如果提取的帖子不足输入参数要求的采集条数，就滚动主工作区的信息流，触发页面加载。帖子正文中若有"展开"操作，点击展开链接。悬浮窗的时间戳作为发帖时间。';
const SCHEMA_251 = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['postUrl', 'postTime', 'content'], properties: {
    postId: { type: 'string' }, postUrl: { type: 'string' }, postTime: { type: 'string' },
    content: { type: 'string' }, likeCount: { type: 'string' } } } } } };

// The 251 incident shape: a class-anchored-only url lane (obfuscated churn
// classes), NO hrefIdentity tokens, and a census mount that never reached
// an identity-bearing window (goalMet:false) — the rec-dominated window.
function CENSUS_WEAK_251() {
  return {
    containerSel: '[role=article]', total: 3, sampled: [{}],
    lanes: {
      url: [{ selector: 'a.x1i10hfl', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
      time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['2 days ago'] }],
      count: [], id: [],
      text: [{ selector: 'div.msg', tag: 'div', strength: 'strong', coverage: '4/5', texts: ['body'] }]
    },
    hrefIdentity: [],
    mount: { rounds: 5, countBefore: 3, countAfter: 3, reCensused: false, goalMet: false }
  };
}
function probesFor(census) {
  return {
    count: async (a) => ({ count: a.sel === '[role=article]' ? 12 : 0 }),
    census: async () => census,
    sample: async () => ({}),
    attrStats: async () => ({ totalItems: 5, values: [{ value: '/p/1', items: 5, pct: 100 }], absentPct: 0 })
  };
}

describe('251 FIX 1 — propose receipt populationHint', () => {
  it('class-only url lane + mount{goalMet:false} → EVERY receipt shape carries a populationHint routing to annotate.request', async () => {
    const census = CENSUS_WEAK_251();
    const pending = await AP.proposeArtifact({ probes: probesFor(census), requirementText: REQ_FULL, outputSchema: SCHEMA_251, currentArtifact: null });
    assert.equal(pending.applied, 'engine-pending');
    assert.ok(typeof pending.populationHint === 'string' && pending.populationHint.length > 0, 'engine-pending shape carries populationHint');
    assert.match(pending.populationHint, /annotate\.request/, 'the hint names the annotate exit');
    assert.match(pending.populationHint, /did not reach an identity-bearing window/, 'the mount branch is disclosed');
    assert.match(pending.populationHint, /containerSel/, 'the annotate shape carries a containerSel');
    const applied = await AP.proposeArtifact({ probes: probesFor(census), requirementText: REQ_FULL, outputSchema: SCHEMA_251, currentArtifact: null, applyArtifact: async () => ({ version: 3 }) });
    assert.equal(applied.applied, true);
    assert.match(applied.populationHint, /annotate\.request/, 'applied shape carries the hint too');
    const errored = await AP.proposeArtifact({ probes: probesFor(census), requirementText: REQ_FULL, outputSchema: SCHEMA_251, currentArtifact: null, applyArtifact: async () => { throw new Error('SYNTAX_ERROR: gate'); } });
    assert.equal(errored.applied, false);
    assert.match(errored.populationHint, /annotate\.request/, 'error shape carries the hint too');
  });
  it('no mount but no identity tokens at all → hint still fires with the no-tokens branch', async () => {
    const census = CENSUS_WEAK_251();
    delete census.mount;
    const out = await AP.proposeArtifact({ probes: probesFor(census), requirementText: REQ_FULL, outputSchema: SCHEMA_251, currentArtifact: null });
    assert.match(out.populationHint, /found no identity tokens/, 'the no-tokens branch is disclosed');
    assert.match(out.populationHint, /annotate\.request/);
  });
  it('token-derived identity (hrefIdentity-tokens) → NO populationHint', async () => {
    const census = {
      containerSel: '[role=article]', total: 12, sampled: [{}],
      lanes: {
        url: [{ selector: 'a.x1i10hfl', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
        time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }],
        count: [], id: [], text: []
      },
      hrefIdentity: [{ token: 'query:story_fbid', coverage: '5/5', samples: ['101a', '202b'] }],
      mount: { rounds: 1, countBefore: 3, countAfter: 12, reCensused: true, goalMet: true }
    };
    const out = await AP.proposeArtifact({ probes: probesFor(census), requirementText: REQ_FULL, outputSchema: SCHEMA_251, currentArtifact: null });
    assert.equal(out.selectorProvenance.source, 'hrefIdentity-tokens');
    assert.equal(out.populationHint, undefined, 'identity grounded by measured tokens — no populationHint');
  });
  it('goalMet:true with a url-lane ATTRIBUTE selector → NO populationHint', async () => {
    const census = {
      containerSel: '[role=article]', total: 10, sampled: [{}],
      lanes: {
        url: [{ selector: 'a[href*="/p/"]', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
        time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }],
        count: [], id: [], text: []
      },
      hrefIdentity: [{ token: 'query:id', coverage: '5/5', samples: ['a1', 'b2'] }],
      mount: { rounds: 1, countBefore: 3, countAfter: 10, reCensused: true, goalMet: true }
    };
    const out = await AP.proposeArtifact({ probes: probesFor(census), requirementText: REQ_FULL, outputSchema: SCHEMA_251, currentArtifact: null });
    assert.equal(out.selectorProvenance.source, 'url-lane');
    assert.equal(out.populationHint, undefined, 'identity-bearing window reached + measured attribute lane — no populationHint');
  });
});

describe('251 FIX 3 — engine one-shot nudge on weak-identity propose', () => {
  const { createResearchSession } = require('../lib/research-session');
  const mk = (content) => ({ content, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const env = (tool, args) => mk(JSON.stringify({ think: 't', tool, args: args || {} }));
  const fin = (s) => mk(JSON.stringify({ think: 'done', finish: { summary: s || 'x' } }));
  const SCHEMAS = { inputSchema: { type: 'object', properties: { k: { type: 'string' } } }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } };
  function makeSession251(replies, verifyResults) {
    let vi = 0, draft = null;
    const { createSessionTools } = require('../lib/session-tools');
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => { const r = verifyResults[Math.min(vi, verifyResults.length - 1)]; vi += 1; return r; },
      // The 251 shape: class-only url lane, no tokens, mount never reached an
      // identity-bearing window — every propose receipt carries populationHint.
      probeFactory: () => ({ count: async () => ({ count: 5 }), census: async () => CENSUS_WEAK_251(), sample: async () => ({}) }),
      getDraftService: () => draft, applyArtifact: (a) => { draft = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; return Promise.resolve({ version: draft.steps.length }); },
      getTestInput: () => ({ k: 'ml' }), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => (draft ? draft.steps : []),
      ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
    }).tools;
    let i = 0;
    return createResearchSession({ requirement: 'collect posts', llm: async () => { const r = replies[Math.min(i, replies.length - 1)]; i += 1; return r; }, tools, onEvent: () => {} });
  }
  const RED = { events: [], report: { ok: false, error: { message: 'FIELD_MATCH_ZERO: red' }, detectors: {} }, raw: {} };
  const popNotes = (session) => session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text)
    .filter((t) => /POPULATION UNCERTAIN/.test(t));
  const proposeReceipt = (session) => session.state().session.transcript
    .filter((t) => t.kind === 'tool' && t.name === 'artifact.propose')
    .map((t) => t.result).pop();

  it('propose #1 with populationHint early (low turns, no verify) → NO note', async () => {
    const session = makeSession251([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('artifact.propose', {}),
      fin('done')
    ], [RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.ok(proposeReceipt(session).populationHint, 'the wiring is real — the propose receipt carries the hint');
    assert.equal(popNotes(session).length, 0, 'early research — the escalation stays silent');
  });
  it('after a verify, a weak-identity propose fires EXACTLY ONE note; a third propose stays at one', async () => {
    const session = makeSession251([
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('artifact.propose', {}),
      env('verify.run', {}),
      env('artifact.propose', {}),
      env('artifact.propose', {}),
      fin('done')
    ], [RED]);
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    const notes = popNotes(session);
    assert.equal(notes.length, 1, 'exactly one population-annotate nudge per session');
    assert.match(notes[0], /annotate\.request/, 'the note names the annotate exit');
    assert.match(notes[0], /joint solver/, 'the note attributes the sweep evidence');
  });
  it('a strong-identity propose after a verify → NO note (identity grounded, nothing uncertain)', async () => {
    const strongCensus = {
      containerSel: '[role=article]', total: 12, sampled: [{}],
      lanes: {
        url: [{ selector: 'a.x1i10hfl', tag: 'a', strength: 'strong', coverage: '5/5', texts: ['l'] }],
        time: [{ selector: 'span[aria-label]', tag: 'span', strength: 'strong', coverage: '4/5', texts: ['November 3, 2025'] }],
        count: [], id: [], text: []
      },
      hrefIdentity: [{ token: 'query:story_fbid', coverage: '5/5', samples: ['101a', '202b'] }],
      mount: { rounds: 1, countBefore: 3, countAfter: 12, reCensused: true, goalMet: true }
    };
    let vi = 0, draft = null;
    const { createSessionTools } = require('../lib/session-tools');
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => { vi += 1; return RED; },
      probeFactory: () => ({ count: async () => ({ count: 5 }), census: async () => strongCensus, sample: async () => ({}) }),
      getDraftService: () => draft, applyArtifact: (a) => { draft = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; return Promise.resolve({ version: draft.steps.length }); },
      getTestInput: () => ({ k: 'ml' }), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => (draft ? draft.steps : []),
      ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
    }).tools;
    let i = 0;
    const replies = [
      env('io.confirm', Object.assign({ testInput: { keyword: 'ml', count: 3 } }, SCHEMAS)),
      env('artifact.propose', {}),
      env('verify.run', {}),
      env('artifact.propose', {}),
      fin('done')
    ];
    const session = createResearchSession({ requirement: 'collect posts', llm: async () => { const r = replies[Math.min(i, replies.length - 1)]; i += 1; return r; }, tools, onEvent: () => {} });
    const report = await session.run();
    assert.equal(report.stopped.reason, 'completed');
    assert.equal(proposeReceipt(session).populationHint, undefined, 'strong identity — no hint on the receipt');
    assert.equal(popNotes(session).length, 0, 'and no engine note');
  });
});
