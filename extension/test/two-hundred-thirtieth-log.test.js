// extension/test/two-hundred-thirtieth-log.test.js
//
// 230th log — user ground truth over the 229th session's diagnosis:
// "我很确认页面的帖子的数量是足够的……找不到足够的帖子，优先不是降低
// count，而是确认帖子鉴别对不对；没把握就找用户确认，甚至高亮出来给
// 用户看，让用户帮助标注出有机贴". The evidence agrees: the model's own
// research-tab collections gathered 13-23 cards while it read the verify
// tab's 6 containers/1 distinct id as a "supply ceiling" and the ceiling
// note led with RENEGOTIATE — backwards.
//
//   A. selector:'.' means the container itself (the model wrote it in v1
//      AND v2; invalid CSS, surfaced only at verify — a DSL gap, not a
//      model error).
//   B. the SUPPLY CEILING note orders discrimination FIRST: check your
//      filter (base population vs filtered), ask the user to MARK the
//      organic posts when uncertain (annotate.request population mode —
//      hover highlights, click marks), scroll-certify, and only then
//      renegotiate.
//   C. the engine names the in-session contradiction: research-tab
//      scrolling collected N cards vs verify delivered M<<N.
//   D. the verify SUPPLY message leads with discrimination + annotate too.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const { createResearchSession } = require('../lib/research-session');

function setupDOM(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/page' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.Node = dom.window.Node;
  return dom;
}

// ---------- A: '.' means self ----------

describe('A. selector "." reads the container itself (230th log)', () => {
  const HTML = '<div class="card"><span>hello</span></div>';
  for (const [label, getOps] of [['lib', () => require('../lib/list-extract-ops.js')], ['inline mirror', () => require('./helpers/inline-ops-factory.js').loadInline({ document: global.document, window: global.window })]]) {
    it(`${label}: {selector:'.'} + attr reads the container; plain '.' reads its text`, () => {
      setupDOM(HTML);
      const r = getOps().extractListRecords(
        Array.from(document.querySelectorAll('.card')),
        { self: { selector: '.', attr: 'outerHTML' }, txt: { selector: '.' } },
        { allowEmpty: true });
      assert.match(r[0].self, /^<div class="card">/);
      assert.equal(r[0].txt, 'hello');
    });
  }
  it('the canonical-spelling lint fires (source pin)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'session-tools.js'), 'utf8');
    assert.match(src, /FIELD_SELECTOR_DOT/, 'the lint exists');
  });
});

// ---------- B+C: ceiling order + contradiction ----------

function mk(content) { return { content, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } }; }
const env = (tool, args) => mk(JSON.stringify({ think: 't', tool, args: args || {} }));
const fin = (extra) => mk(JSON.stringify({ think: 'done', finish: Object.assign({ summary: 'x' }, extra || {}) }));

const SCHEMAS = { inputSchema: { type: 'object', properties: { k: { type: 'string' } } }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } };

describe('B+C. discrimination-first ceiling + the receipts contradiction (230th log)', () => {
  it('after research scroll collected 15 and verify delivered 2, the ceiling note carries the contradiction and the discrimination-first order', async () => {
    let draft230 = null;
    let vi = 0;
    const replies = [];
    const { createSessionTools } = require('../lib/session-tools');
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => {
        vi += 1;
        return { events: [], report: { executedArtifactVersion: vi, ok: false, error: { message: 'COUNT_SHORTFALL_SUPPLY: posts delivered 2 of 6 requested while this run matched 6 containers' }, detectors: { countShortfall: { field: 'posts', requested: 6, extracted: 2, uniqueExtracted: 1, ratio: 0.33, severe: true, maxContainers: 6, exhaustionCertified: false } }, score: { score: 1 }, deliveredCounts: { posts: 2 } }, raw: {} };
      },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }), scrollUntil: async () => ({ collected: 15, finalCount: 15, reason: 'max_rounds' }) }),
      getDraftService: () => draft230, applyArtifact: (a) => { draft230 = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; },
      getTestInput: () => ({ k: 'ml' }), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => (draft230 ? draft230.steps : []),
      ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
    }).tools;
    const session = createResearchSession({
      requirement: 'collect posts',
      llm: async () => replies.shift(),
      tools,
      onEvent: () => {}
    });
    const STEP = { id: 's1', name: 's', script: 'return 1;', onSuccess: 'TERMINATE' };
    const script = [
      env('io.confirm', Object.assign({ testInput: { k: 'ml' } }, SCHEMAS)),
      env('service.update', { steps: [STEP] }),
      env('probe.scrollUntil', { sel: '.c', targetCount: 10 }), // research supply 15
      env('verify.run', {}),
      env('verify.run', {}),
      env('verify.run', {}), // 3 shortfall window -> ceiling note
      fin()
    ];
    for (const r of script) replies.push(r);
    await session.run();
    const sys = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    const ceiling = sys.find((t) => /SUPPLY CEILING/.test(t));
    assert.ok(ceiling, 'the ceiling note fired: ' + JSON.stringify(sys.slice(-2)));
    assert.match(ceiling, /DISCRIMINATION problem until proven otherwise/, 'discrimination-first framing');
    const aIdx = ceiling.indexOf('CHECK YOUR RECORD DISCRIMINATION FIRST');
    const bIdx = ceiling.indexOf('ASK THE USER TO MARK IT');
    const dIdx = ceiling.indexOf('ONLY THEN renegotiate');
    assert.ok(aIdx > -1 && bIdx > aIdx && dIdx > bIdx, 'exits ordered discrimination → annotate → certify → renegotiate');
    assert.match(ceiling, /annotate\.request the population/, 'the annotate route is named');
    assert.match(ceiling, /CONTRADICTION IN YOUR OWN RECEIPTS/, 'the contradiction line fires');
    assert.match(ceiling, /collected 15 cards this session while the verify run delivered 2/, 'names both numbers');
  });
  it('no research-supply receipts → no contradiction line (regression pin)', async () => {
    let draft230b = null;
    let vi = 0;
    const replies = [];
    const { createSessionTools } = require('../lib/session-tools');
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => { vi += 1; return { events: [], report: { executedArtifactVersion: vi, ok: false, error: { message: 'COUNT_SHORTFALL_SUPPLY: x' }, detectors: { countShortfall: { field: 'posts', requested: 6, extracted: 2, uniqueExtracted: 1, ratio: 0.33, severe: true, maxContainers: 6, exhaustionCertified: false } }, score: { score: 1 }, deliveredCounts: { posts: 2 } }, raw: {} }; },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) }),
      getDraftService: () => draft230b, applyArtifact: (a) => { draft230b = { steps: a.steps, targetUrl: 'https://example.com/?k={{k}}', config: {} }; },
      getTestInput: () => ({ k: 'ml' }), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => (draft230b ? draft230b.steps : []),
      ioConfirmBridge: { request: (p) => Promise.resolve({ confirmed: true, testInput: p && p.testInput }) }
    }).tools;
    const session = createResearchSession({ requirement: 'collect posts', llm: async () => replies.shift(), tools, onEvent: () => {} });
    const STEP = { id: 's1', name: 's', script: 'return 1;', onSuccess: 'TERMINATE' };
    [env('io.confirm', Object.assign({ testInput: { k: 'ml' } }, SCHEMAS)), env('service.update', { steps: [STEP] }), env('verify.run', {}), env('verify.run', {}), env('verify.run', {}), fin()].forEach((r) => replies.push(r));
    await session.run();
    const sys = session.state().session.transcript.filter((t) => t.kind === 'system').map((t) => t.text);
    const ceiling = sys.find((t) => /SUPPLY CEILING/.test(t));
    assert.ok(ceiling);
    assert.doesNotMatch(ceiling, /CONTRADICTION/);
  });
});

describe('D. the verify SUPPLY message leads with discrimination (source pin)', () => {
  it('the message names discrimination-first + the annotate population route', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'verify-runner.js'), 'utf8');
    const i = src.indexOf('230th directive');
    assert.ok(i > -1, 'the reroute exists');
    const region = src.slice(i - 700, i + 700);
    assert.match(region, /FIRST suspect YOUR discrimination/);
    assert.match(region, /annotate\.request the population/);
  });
});
