// extension/test/page-vocab.test.js
//
// 201st-round follow-up (user design challenge): the hardcoded detector
// vocabularies are Class-B web-convention lists with long tails — a page
// that truncates with "…全文" escapes SEE_MORE_TAIL_RE forever. The
// sanctioned architecture: page vocabulary is LLM-authored at research
// time, harvested FROM evidence (so injection does not depend on the
// model noticing), persisted with the service artifact, and consulted by
// the censuses WITH priority over the harness fallback list.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WU = require('../lib/wizard-utils');
const { createSessionTools } = require('../lib/session-tools');

const SCHEMA = { type: 'object', properties: { posts: { type: 'array', items: { type: 'object',
  properties: { content: { type: 'string' } } } } } };

describe('census union: pageVocab beats the fallback list (201st round)', () => {
  it('a REGISTERED token catches a tail the fallback vocabulary misses, and the note names the source', () => {
    const data = { posts: [
      { content: '第一篇完整正文……全文' },
      { content: '第二篇完整正文……全文' }
    ] };
    const r = WU.detectSeeMoreUnexpanded(data, SCHEMA, { truncationAffordances: ['全文'] });
    assert.ok(r, 'registered vocab fires where the fallback list cannot (全文 is not in it)');
    assert.equal(r.affectedCount, 2);
    assert.match(r.matchedVia, /registered/, 'discloses the hit came from page vocabulary');
  });

  it('no pageVocab → the fallback list still works (backward compatible)', () => {
    const data = { posts: [{ content: 'truncated … See more' }] };
    const r = WU.detectSeeMoreUnexpanded(data, SCHEMA);
    assert.ok(r);
    assert.match(r.matchedVia, /fallback/);
  });

  it('union: registered and fallback tokens both fire in one run', () => {
    const data = { posts: [
      { content: 'english … See more' },
      { content: '中文……全文' }
    ] };
    const r = WU.detectSeeMoreUnexpanded(data, SCHEMA, { truncationAffordances: ['全文'] });
    assert.ok(r);
    assert.equal(r.affectedCount, 2);
  });

  it('verify-runner consults the ARTIFACT service.pageVocab — a 全文-tail run surfaces SEE_MORE_UNEXPANDED', async () => {
    const { createVerifyRunner } = require('../lib/verify-runner');
    const orchestrate = async (svc, input, d, opts) => {
      const tab = await d.createTab(svc.targetUrl);
      await d.waitForTabLoad(tab.id);
      return {
        finalResult: { posts: [{ content: '完整正文……全文' }, { content: '另一篇……全文' }] },
        steps: [{ stepId: 's1', stepName: 'one', result: { done: true }, snapshot: null }],
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
      service: { targetUrl: 'https://example.com', steps: [{ id: 's1', name: 'one', script: 'return 1', onSuccess: 'TERMINATE' }], config: {},
        pageVocab: { truncationAffordances: ['全文'] } },
      input: {}, outputSchema: SCHEMA
    });
    assert.ok(out.report.detectors.seeMoreUnexpanded, 'census fired via the artifact vocabulary');
    assert.match(out.report.detectors.seeMoreUnexpanded.matchedVia, /registered/);
    assert.ok(out.report.events.includes('SEE_MORE_UNEXPANDED'), 'event tag rides the report');
  });
});

describe('pageVocab persistence (service artifact)', () => {
  function makeDeps(overrides) {
    const applied = [];
    const deps = {
      rail: {
        executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }),
        pageState: async () => ({ open: true, tabId: 1 }),
        ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1
      },
      runVerify: async () => ({
        report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] },
        events: [], raw: { testResult: null, error: null, breaker: null }
      }),
      getDraftService: () => null,
      applyArtifact: (a) => { applied.push(a); },
      getTestInput: () => ({}),
      getOutputSchema: () => ({ type: 'object' }),
      getSteps: () => [],
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'dry-run ok' }) })
    };
    return { deps: Object.assign(deps, overrides || {}), applied };
  }
  const STEPS = [{ id: 's1', name: 'one', script: 'return 1', onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];

  const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
  async function confirmContract(t) {
    await t.tools['io.confirm']({
      inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } },
      outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } }
    }, CTX);
  }

  it('service.update accepts pageVocab — validated, applied to the artifact, echoed on the receipt', async () => {
    const { deps, applied } = makeDeps({ getDraftService: () => ({ targetUrl: 'https://example.com', steps: STEPS }) });
    const t = createSessionTools(deps);
    await confirmContract(t);
    const out = await t.tools['service.update']({ steps: STEPS, pageVocab: { truncationAffordances: ['全文'] } }, CTX);
    assert.equal(out.updated, true, 'got: ' + JSON.stringify(out.error || out.updated));
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0].pageVocab, { truncationAffordances: ['全文'] }, 'rides the artifact object');
    assert.match(JSON.stringify(out), /全文/, 'receipt acknowledges the vocabulary');
  });

  it('invalid shapes are rejected with the expected shape taught', async () => {
    const { deps } = makeDeps({ getDraftService: () => ({ targetUrl: 'https://example.com', steps: STEPS }) });
    const t = createSessionTools(deps);
    await confirmContract(t);
    const out = await t.tools['service.update']({ steps: STEPS, pageVocab: { truncationAffordances: '全文' } }, CTX);
    assert.match(out.error, /pageVocab/, 'names the field');
    assert.match(out.error, /array of strings/i, 'teaches the shape');
  });

  it('steps-less pageVocab amendment against the standing artifact (registration without re-authoring)', async () => {
    const { deps, applied } = makeDeps({ getDraftService: () => ({ targetUrl: 'https://example.com', steps: STEPS }), getSteps: () => STEPS });
    const t = createSessionTools(deps);
    await confirmContract(t);
    const out = await t.tools['service.update']({ pageVocab: { truncationAffordances: ['全文'] } }, CTX);
    assert.equal(out.vocabRegistered, true, 'got: ' + JSON.stringify(out));
    const withVocab = applied.filter((a) => a && a.pageVocab);
    assert.equal(withVocab.length, 1, 'exactly one pageVocab-bearing apply, got ' + JSON.stringify(applied.map((a) => Object.keys(a))));
    assert.deepEqual(withVocab[0].pageVocab, { truncationAffordances: ['全文'] });
  });

  it('wizard applySessionArtifact carries pageVocab (source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'wizard.js'), 'utf8');
    const fn = src.slice(src.indexOf('function applySessionArtifact'));
    assert.match(fn, /pageVocab/, 'the persisted vocabulary reaches wizardState');
  });

  it('same-site seed surfaces a prior service pageVocab to the next session (source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'wizard.js'), 'utf8');
    const i = src.indexOf('seedLedgerFromSameSite(registry');
    assert.ok(i > -1);
    const region = src.slice(i, i + 2600);
    assert.match(region, /pageVocab/, 'the seed note mentions registered vocabulary when present');
  });
});

describe('harvest: evidence → registration proposal (no model initiative needed)', () => {
  function probeDeps(records) {
    return {
      rail: {
        executeDsl: async () => ({ result: { total: records.length, records }, selectorDiagnostics: [] }),
        pageState: async () => ({ open: true, tabId: 1 }),
        ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1
      },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => null,
      applyArtifact: () => {},
      getTestInput: () => ({}),
      getOutputSchema: () => ({ type: 'object' }),
      getSteps: () => [],
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: (cfg) => require('../lib/probe-tools').createProbeTools(cfg)
    };
  }

  it('probe.extract with repeated ellipsis tails attaches a vocabProposal teaching registration', async () => {
    const records = [
      { content: '完整正文第一篇……全文' },
      { content: '完整正文第二篇……全文' },
      { content: '完整正文第三篇……全文' }
    ];
    const t = createSessionTools(probeDeps(records));
    const r = await t.tools['probe.extract']({ containerSel: '.card', fieldMap: { content: '.c' } });
    assert.ok(r.vocabProposal, 'proposal attached');
    assert.equal(r.vocabProposal.token, '全文');
    assert.equal(r.vocabProposal.field, 'content');
    assert.match(r.vocabProposal.note, /service\.update\(\{pageVocab/, 'teaches the registration call');
    assert.match(r.vocabProposal.note, /\$clickInList/, 'teaches the expansion exit');
  });

  it('clean records attach no proposal', async () => {
    const records = [{ content: 'one full text' }, { content: 'another full text' }];
    const t = createSessionTools(probeDeps(records));
    const r = await t.tools['probe.extract']({ containerSel: '.card', fieldMap: { content: '.c' } });
    assert.equal(r.vocabProposal, undefined);
  });

  it('202nd log: MULTI-WORD affordance tails ("… See more") harvest too — the single-token regex missed the English textbook case', async () => {
    const records = [
      { content: 'Java OOP Complete Premium Handbook | Classes, Objects, Inheritance, Polymorphism & Interview Guide… See more' },
      { content: 'Advanced Notes … See more' },
      { content: 'Pro S… See more' }
    ];
    const t = createSessionTools(probeDeps(records));
    const r = await t.tools['probe.extract']({ containerSel: '.card', fieldMap: { content: '.c' } });
    assert.ok(r.vocabProposal, 'proposal attached for the multi-word tail (this exact receipt fired no proposal live)');
    assert.equal(r.vocabProposal.token, 'See more');
  });

  it('below-threshold repetition (1/3) attaches no proposal', async () => {
    const records = [{ content: 'one……全文' }, { content: 'two full' }, { content: 'three full' }];
    const t = createSessionTools(probeDeps(records));
    const r = await t.tools['probe.extract']({ containerSel: '.card', fieldMap: { content: '.c' } });
    assert.equal(r.vocabProposal, undefined);
  });
});
