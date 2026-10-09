// extension/test/two-hundred-thirteenth-log.test.js
//
// 213th log (session rs-1791546770301-1, trip/count=10, wallClock death at
// 1807s, v1-v6 never green):
//   A. collectUntil({idAttr:'id'}) on containers with NO id attribute —
//      every record fell back to ELEMENT identity (random per-element key),
//      which counts virtualized REMOUNT duplicates as unique and never
//      dedupes by record. The receipt said nothing. FIX: idAttrCensus on
//      every collectUntil receipt (present/absent + the dedupe teaching).
//   B. The assemble step looped `await $timestamp(sel,{index:i})` PER
//      RECORD — each call is a full hover dance (5-10s); 10 records burned
//      the whole step budget (v1 preflight SANDBOX_DEADLINE). FIX:
//      PER_RECORD_TIMESTAMP lint teaching the batch exits.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('A. collectUntil idAttrCensus (213th log, source audit)', () => {
  const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
  it('snapshot tracks idAttr present/absent and the receipt carries the census', () => {
    assert.match(cs, /idAttrPresent/, 'present counter');
    assert.match(cs, /idAttrAbsent/, 'absent counter');
    assert.match(cs, /idAttrCensus/, 'receipt key');
  });
  it('the all-absent note names the remount-duplicate consequence', () => {
    assert.match(cs, /counts virtualized REMOUNT duplicates as unique/, 'the teaching names the failure');
  });
});

describe('B. PER_RECORD_TIMESTAMP lint (213th log)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
  function run(steps) {
    const deps = {
      rail: { executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1, url: 'https://example.com/list' }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => ({ targetUrl: 'https://example.com/list?q={{k}}', steps }),
      applyArtifact: () => {},
      getTestInput: () => ({}), getOutputSchema: () => ({ type: 'object' }), getSteps: () => steps,
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) })
    };
    const t = createSessionTools(deps);
    return (async () => {
      await t.tools['io.confirm']({ inputSchema: { type: 'object', required: ['q'] }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } }, CTX);
      return t.tools['service.update']({ steps }, CTX);
    })();
  }
  it('a loop wrapping await $timestamp draws the lint with the batch teaching', async () => {
    const script = "for(let i=0;i<recs.length;i++){ const ts = (await $timestamp('div.card', {index: i})).value; out.push({t: ts}); } return out;";
    const steps = [{ id: 'assemble', name: 'a', script, onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const out = await run(steps);
    const lint = (out.staticLint || []).find((l) => /PER_RECORD_TIMESTAMP/.test(String(l)));
    assert.ok(lint, 'lint present: ' + JSON.stringify((out.staticLint || []).slice(0, 2)));
    assert.match(lint, /hoverPopover|one extract/, 'teaches the batch exits');
  });
  it('a single $timestamp call stays silent', async () => {
    const script = "const ts = await $timestamp('div.card'); return {t: ts.value};";
    const steps = [{ id: 'assemble', name: 'a', script, onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const out = await run(steps);
    assert.ok(!((out.staticLint || []).some((l) => /PER_RECORD_TIMESTAMP/.test(String(l)))));
  });
});
