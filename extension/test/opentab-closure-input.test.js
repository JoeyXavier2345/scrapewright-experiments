// extension/test/opentab-closure-input.test.js
// 199th log: v2's collect step ran
//   const N = Number(__input__.count) || 5;
//   return await $openTab(url, async()=>{ ... n >= N ... });
// and the sub-tab failed "N is not defined" TWICE — $openTab serializes the
// fn by source and re-creates it in the sub-tab sandbox, so outer closures
// are invisible. The harness had no teaching, no lint, and not even
// __input__ to re-derive from (the sub-tab execution hardcoded input {}).
// This file pins: (a) the closure lint, (b) the __input__ threading through
// the whole relay chain, (c) the DSL-guide teaching.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WU = require('../lib/wizard-utils');
const { createSessionTools } = require('../lib/session-tools');

const INCIDENT_SCRIPT = [
  "const kw=encodeURIComponent(String(__input__.keyword));",
  "const N=Number(__input__.count)||5;",
  "return await $openTab('https://example.com/search?q='+kw, async()=>{",
  "  let n=0;",
  "  for(let i=0;i<25;i++){ await new Promise(r=>setTimeout(r,3000)); n=await $count('div'); if(n>=N)break; await $scrollBy(600); }",
  "  const recs=await $extractList('div',{content:{selector:'.c'}},{allowEmpty:true});",
  "  return {recs};",
  "});"
].join('\n');

describe('detectOpenTabClosureRefs (199th log lint)', () => {
  it('flags the incident shape: outer const N referenced inside the fn', () => {
    const hits = WU.detectOpenTabClosureRefs([{ id: 'collect', name: 'c', script: INCIDENT_SCRIPT }]);
    assert.ok(hits.length >= 1, 'at least one hit');
    const hit = hits.find((h) => h.stepId === 'collect');
    assert.ok(hit, 'hit names the step');
    assert.ok(hit.names.includes('N'), 'N flagged, got ' + JSON.stringify(hit.names));
    assert.ok(!hit.names.includes('n'), 'n is declared INSIDE the fn — not a closure ref');
    assert.ok(!hit.names.includes('i'), 'loop var i is declared inside');
  });

  it('does not flag a fn that derives everything from __input__ inside', () => {
    const clean = [
      "return await $openTab('https://example.com/search?q='+encodeURIComponent(String(__input__.keyword)), async()=>{",
      "  const N=Number(__input__.count)||5;",
      "  let n=await $count('div');",
      "  return {n, N};",
      "});"
    ].join('\n');
    const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: clean }]);
    assert.deepEqual(hits, []);
  });

  it('handles the guide-style template-string body form too', () => {
    const tpl = [
      "const href='https://example.com/x';",
      "return await $openTab(href, `",
      "  await $wait('.d', 3000);",
      "  const t = await $extract('h1');",
      "  return { t, href };",
      "`);"
    ].join('\n');
    const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: tpl }]);
    assert.ok(hits.length === 1, 'template body is scanned too');
    assert.ok(hits[0].names.includes('href'), 'href referenced from the outer scope');
  });

  it('fn PARAMS shadow outer names (not flagged)', () => {
    const shadow = "const N=6; return await $openTab(u, async(N)=>{ return {v:N}; });";
    const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: shadow }]);
    assert.deepEqual(hits, []);
  });
});

// 199th review F3: the unit tests above pin WU.detectOpenTabClosureRefs, but
// nothing proved the AGGREGATION loop in session-tools service.update — a
// dropped push or a renamed marker there would leave the lint dead at the
// tool boundary while every unit test stayed green.
describe('service.update surfaces OPENTAB_CLOSURE_REF (tool-level aggregation)', () => {
  it('a steps update carrying the incident script lands with an advisory naming variable N', async () => {
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
      applyArtifact: () => {},
      getTestInput: () => ({}),
      getOutputSchema: () => ({ type: 'object' }),
      getSteps: () => [],
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'dry-run ok' }) })
    };
    const t = createSessionTools(deps);
    const ctx = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
    await t.tools['io.confirm']({
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } }
    }, ctx);
    const out = await t.tools['service.update']({
      steps: [{ id: 'collect', name: 'collect', script: INCIDENT_SCRIPT, onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }]
    }, ctx);
    assert.equal(out.updated, true, 'advisory is non-blocking — the artifact still lands (got: ' + JSON.stringify(out.error || out.updated) + ')');
    const lint = (out.staticLint || []).find((l) => /OPENTAB_CLOSURE_REF/.test(String(l)));
    assert.ok(lint, 'staticLint carries the OPENTAB_CLOSURE_REF entry, got: ' + JSON.stringify(out.staticLint));
    assert.match(lint, /collect/, 'names the offending step');
    assert.match(lint, /N/, 'names variable N');
    assert.match(lint, /__input__/, 'teaches the re-derive-from-__input__ exit');
  });
});

// The relay spans the MV3 service worker and the sandbox iframe — source
// audit pins (same pattern as test/opentab-envelope-unwrap.test.js).
describe('$openTab __input__ threading (source audit across the relay chain)', () => {
  const sandboxSrc = fs.readFileSync(path.join(__dirname, '..', 'sandbox.js'), 'utf8');
  const csSrc = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
  const bgSrc = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

  it('sandbox: the per-execution API bag receives the input and $openTab sends it', () => {
    assert.match(sandboxSrc, /makeExecApi\(\s*execId\s*,\s*deadlineAt\s*,\s*input\s*\)/,
      'makeExecApi signature carries input');
    const openTabLine = sandboxSrc.split('\n').find((l) => l.includes("'$openTab'"));
    assert.ok(openTabLine, 'exec-api $openTab line found');
    assert.match(openTabLine, /fn\.toString\(\)/, 'fn source rides the args');
    assert.match(openTabLine, /input/, 'input rides the args');
  });

  it('content-script: domOpenTab receives args[2] and the OPEN_TAB_EXECUTE message carries input', () => {
    assert.match(csSrc, /domOpenTab\(data\.args\[0\]\s*,\s*data\.args\[1\]\s*,\s*data\.args\[2\]\)/,
      'args[2] (input) forwarded');
    const fnStart = csSrc.indexOf('async function domOpenTab(');
    const fnBody = fnStart === -1 ? '' : csSrc.slice(fnStart, fnStart + 1400);
    assert.match(fnBody, /input/, 'domOpenTab signature/message includes input');
    assert.match(fnBody, /type:\s*'OPEN_TAB_EXECUTE'[\s\S]{0,400}input/, 'message carries input');
  });

  it('background: OPEN_TAB_EXECUTE passes message.input through; handleOpenTabExecute injects it as __input__', () => {
    assert.match(bgSrc, /handleOpenTabExecute\(message\.url,\s*message\.script,\s*openTabParentId,\s*message\.reqId,\s*message\.input\)/,
      'handler threads input');
    const fnStart = bgSrc.indexOf('async function handleOpenTabExecute(');
    const fnBody = fnStart === -1 ? '' : bgSrc.slice(fnStart, fnStart + 9000);
    assert.match(fnBody, /function handleOpenTabExecute\(\s*url,\s*scriptStr,\s*parentTabId,\s*reqId\s*,\s*input\s*\)/,
      'signature carries input');
    const execMatch = fnBody.match(/executor\.execute\(\s*script\s*,\s*([^;]{0,160})\)\s*;/);
    assert.ok(execMatch, 'executor.execute(script, X) found');
    assert.ok(!/^\s*\{\}\s*$/.test(execMatch[1]), 'input is no longer hardcoded {}');
    assert.ok(execMatch[1].includes('input'), 'the injected value derives from the input param: ' + execMatch[1]);
  });
});

describe('DSL guide teaching (199th log)', () => {
  it('SCRIPT_DSL_GUIDE teaches closures invisible + __input__ available in the $openTab body', () => {
    const guide = WU.SCRIPT_DSL_GUIDE;
    const openTabIdx = guide.indexOf('$openTab');
    assert.notEqual(openTabIdx, -1);
    const section = guide.slice(openTabIdx, openTabIdx + 1600);
    assert.match(section, /closure|outer variable/i, 'names the closure mechanism');
    assert.match(section, /__input__/, 'teaches __input__ is available in the sub-tab');
  });
});
