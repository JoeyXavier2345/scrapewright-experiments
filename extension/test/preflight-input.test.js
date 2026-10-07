// extension/test/preflight-input.test.js
// 199th log: verify.run {preflight:true} dry-ran the extract step with
// __input__ = {} — the preflight built pfOpts from the confirmed testInput
// and live-rail forwarded opts, but wizard.js's rail execute dep hardcoded
// executor.execute(snippet, {}), so the sub-tab opened "?q=undefined".
// Dead-layer class: the input survived two hops and died at the third.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSessionTools } = require('../lib/session-tools');

describe('verify preflight input pass-through (199th log)', () => {
  it('session-tools verifyRun preflight: the confirmed testInput reaches rail.executeDsl as opts.input', async () => {
    const captured = [];
    const deps = {
      rail: {
        executeDsl: async (snippet, opts) => {
          captured.push({ snippet, opts });
          return { result: { ok: true }, selectorDiagnostics: [] };
        },
        pageState: async () => ({ open: true, tabId: 1 }),
        ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1
      },
      runVerify: async () => ({
        report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] },
        events: [], raw: { testResult: null, error: null, breaker: null }
      }),
      getDraftService: () => ({ targetUrl: 'https://example.com', steps: [{ id: 'collect', name: 'c', script: "return await $extractList('div', {t:{selector:'.t'}});", onSuccess: 'TERMINATE' }] }),
      applyArtifact: () => {},
      getTestInput: () => ({ keyword: 'beauty', count: 6 }),
      getOutputSchema: () => ({ type: 'object' }),
      getSteps: () => [],
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: (cfg) => { return { snippet: async () => ({ result: 'dry-run ok' }) }; }
    };
    const t = createSessionTools(deps);
    const r = await t.tools['verify.run']({ preflight: true });
    assert.ok(r && r.preflight, 'preflight block present on the flat report');
    assert.equal(r.preflight.executed, true);
    assert.equal(captured.length, 1, 'exactly one preflight dry-run');
    assert.deepEqual(captured[0].opts.input, { keyword: 'beauty', count: 6 },
      'the confirmed testInput must reach the dry-run as __input__');
  });

  it('wizard.js rail execute forwards opts.input to executor.execute (source audit — the hop that dropped it)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'wizard.js'), 'utf8');
    const m = src.match(/execute:\s*async\s*\(tabId,\s*snippet,\s*opts\)\s*=>\s*\{[\s\S]{0,1400}?return r;/);
    assert.ok(m, 'rail execute dep found in wizard.js');
    const block = m[0];
    assert.ok(/executor\.execute\(\s*snippet\s*,[^)]*opts\.input/.test(block),
      'executor.execute must receive opts.input (was hardcoded {}): ' + block.slice(0, 400));
  });
});
