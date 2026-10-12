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

  it('F3a: destructured outer declarations are collected — {keyword} referenced in the fn is flagged', () => {
    const s = "const {keyword} = __input__;\nreturn await $openTab(u, async()=>{ return {k: keyword}; });";
    const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
    assert.equal(hits.length, 1);
    assert.ok(hits[0].names.includes('keyword'), 'keyword flagged, got ' + JSON.stringify(hits[0].names));
  });

  it('F3a: renamed destructured bindings (c: d) contribute d, not the key c', () => {
    const s = "const {c: d} = __input__;\nreturn await $openTab(u, async()=>{ return {v: d}; });";
    const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
    assert.equal(hits.length, 1);
    assert.ok(hits[0].names.includes('d'), 'binding d flagged, got ' + JSON.stringify(hits[0].names));
    assert.ok(!hits[0].names.includes('c'), 'c is a key, not a binding');
  });

  it('F3a: destructured locals INSIDE the fn shadow outer names (not flagged)', () => {
    const s = "const kw='x'; return await $openTab(u, async()=>{ const {kw} = __input__; return {k: kw}; });";
    const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
    assert.deepEqual(hits, []);
  });

  it('F3b: a name appearing only inside a string literal in the fn body is not a ref', () => {
    const s = "const N=6; return await $openTab(u, `const label = 'N is big'; return label;`);";
    const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
    assert.deepEqual(hits, []);
  });

  // 199th re-review: executed repros against the shipped lint — F2 flagged
  // object-literal KEYS as refs, F3 missed ...rest and multi-declarator
  // bindings, F6's blanker erased ${} interpolations and let a lone quote
  // inside a regex class open a phantom string to EOF, F7 ran the outer
  // declaration scan on the RAW script (phantom bindings from comments and
  // from strings inside destructuring defaults).
  describe('199th re-review repros', () => {
    it('F2: object-literal KEY position is not a reference (posts: recs)', () => {
      const s = "const posts = []; return await $openTab(u, async () => { const recs = await $extractList('div',{t:{selector:'.t'}}); return { posts: recs }; });";
      assert.deepEqual(WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]), []);
    });

    it('F2: shorthand object values ARE still references', () => {
      const s = "const recs = []; return await $openTab(u, async () => { return { recs }; });";
      const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
      assert.equal(hits.length, 1);
      assert.ok(hits[0].names.includes('recs'), 'shorthand {recs} references the outer binding');
    });

    it('F3a: ...rest destructuring binds (const {...cfg} = __input__ flags cfg)', () => {
      const s = "const {...cfg} = __input__; return await $openTab(u, async () => ({ v: cfg.x }));";
      const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
      assert.equal(hits.length, 1, 'cfg flagged, got ' + JSON.stringify(hits));
      assert.ok(hits[0].names.includes('cfg'));
    });

    it('F3b: multi-declarator const (N = 5, LIMIT = 10) flags LIMIT', () => {
      const s = "const N = 5, LIMIT = 10; return await $openTab(u, async () => ({ v: LIMIT }));";
      const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
      assert.equal(hits.length, 1, 'LIMIT flagged, got ' + JSON.stringify(hits));
      assert.ok(hits[0].names.includes('LIMIT'));
    });

    it('F3b: multi-declarator with destructuring in the sibling slot', () => {
      const s = "const kw = 'x', {q} = __input__; return await $openTab(u, async () => ({ v: q }));";
      const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
      assert.equal(hits.length, 1);
      assert.ok(hits[0].names.includes('q'));
    });

    it('F3b: for-of header const does NOT swallow loop-body names', () => {
      // The sibling-declarator scan must stop at the for-header's closing
      // paren — `doB` in the body is a call, never a declarator.
      const s = "return await $openTab(u, async () => { for (const x of list) { await \$extractList(x, {}); } return {v:1}; });";
      const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
      assert.deepEqual(hits, []);
    });

    it('F6a: a reference inside a template ${} interpolation is visible', () => {
      const s = "const N = 5; return await $openTab(u, async () => { const s = `x${N}y`; return {s}; });";
      const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
      assert.equal(hits.length, 1, 'N in ${N} flagged, got ' + JSON.stringify(hits));
      assert.ok(hits[0].names.includes('N'));
    });

    it('F6a: template plain-text content is still NOT a reference', () => {
      const s = "const N = 5; return await $openTab(u, async () => { const s = `N is big`; return {s}; });";
      assert.deepEqual(WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]), []);
    });

    it('F6b: a lone quote inside a regex class must not open a phantom string', () => {
      const s = "const N = 5; return await $openTab(u, async () => { const v = /[^a-z']/i.test('x'); return { v, n: N }; });";
      const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
      assert.equal(hits.length, 1, 'N after the regex literal flagged, got ' + JSON.stringify(hits));
      assert.ok(hits[0].names.includes('N'));
    });

    it('F6b: division is still division (no phantom regex swallowing a string)', () => {
      const s = "const N = 5; return await $openTab(u, async () => { const v = (10 / 2) + N; return {v}; });";
      const hits = WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]);
      assert.equal(hits.length, 1);
      assert.ok(hits[0].names.includes('N'));
    });

    it('F7: a declaration living only in an outer comment is a phantom (no flag)', () => {
      const s = "// const posts = []\nreturn await $openTab(u, async () => { return { posts: out }; });";
      assert.deepEqual(WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]), []);
    });

    it('F7: comment-declared name referenced as a VALUE is a phantom (no flag)', () => {
      const s = "// const posts = []\nreturn await $openTab(u, async () => { return { v: posts.length }; });";
      assert.deepEqual(WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]), []);
    });

    it('F7: string contents inside a destructuring default are not bindings (c stays unflagged)', () => {
      const s = "const {q = 'b c'} = __input__; return await $openTab(u, async () => { return { v: c }; });";
      assert.deepEqual(WU.detectOpenTabClosureRefs([{ id: 's1', name: 'one', script: s }]), []);
    });
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
    // 231st: args[3] (opts.timeoutMs) joins the relay call.
    assert.match(csSrc, /domOpenTab\(data\.args\[0\]\s*,\s*data\.args\[1\]\s*,\s*data\.args\[2\]\s*,\s*data\.args\[3\]\)/,
      'args[2] (input) + args[3] (opts) forwarded');
    const fnStart = csSrc.indexOf('async function domOpenTab(');
    const fnBody = fnStart === -1 ? '' : csSrc.slice(fnStart, fnStart + 3600); // 235th: the relay comments widened the fn further
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
