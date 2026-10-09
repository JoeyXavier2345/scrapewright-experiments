// extension/test/two-hundred-tenth-log.test.js
//
// 210th round — the user's three follow-ups on 209:
//   1. "See more 定位不到为何不请求用户标注?" — SEE_MORE_UNEXPANDED is a
//      report-only census, so the 208th identity escalation never covered
//      it; the census fired on FIVE consecutive verifies with no ladder.
//      FIX: census-repetition escalation — seeMoreUnexpanded on 2
//      consecutive verifies pushes the annotate.request/user.observe note
//      (naming the field, the textFilter exit, and the mark-the-button ask).
//   2. "拆并集逐行扫描…之后会按容器跑吗？会不会组装错位?" — research-phase
//      splitting is fine; the DANGER is merging two per-row hover sweeps by
//      index in the artifact (the exact alignment bug $extractWithHover was
//      built to kill). FIX: TWO_SWEEP_MERGE lint + single-family anchorSel
//      union hint on the receipt.
//   3. "把未完成的待办事项干完" — vocabProposal only hooked probe.extract;
//      the model dry-runs almost exclusively via probe.snippet (arbitrary
//      JSON). FIX: recursive string scan of snippet results with the same
//      tail evidence + threshold.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('1. census-repetition escalation (210th log)', () => {
  const { trackCensusRepetition } = require('../lib/research-session');
  const v = (see) => ({ ok: false, error: { message: 'COUNT_SHORTFALL: x' }, detectors: see ? { seeMoreUnexpanded: { field: 'posts.content', affectedCount: 5 } } : {} });
  it('second consecutive SEE_MORE_UNEXPANDED fires the annotation-escalation note', () => {
    let st = null;
    st = trackCensusRepetition(st, v(true));
    assert.ok(!st.note);
    st = trackCensusRepetition(st, v(true));
    assert.ok(st.note);
    assert.match(st.note, /annotate\.request|user\.observe/);
    assert.match(st.note, /textFilter/);
    assert.match(st.note, /posts\.content|field/i);
  });
  it('a verify whose census set really lacks the key resets; note fires once per census key (latched)', () => {
    // 211th review F7: the old interleave fixture (error + EMPTY detectors)
    // is now the NEUTRAL infra shape — the reset needs a real verify shape.
    // A red verify carrying OTHER live censuses is that shape: SEE_MORE was
    // genuinely absent from it.
    const other = { ok: false, error: { message: 'X: x' }, detectors: { labelPrefixedCounts: [{ field: 'likeCount', sample: 'Like: 37' }] } };
    let st = null;
    st = trackCensusRepetition(st, v(true));
    st = trackCensusRepetition(st, other);
    st = trackCensusRepetition(st, v(true));
    assert.ok(!st.note, 'interleaved absence resets');
    st = trackCensusRepetition(st, v(true));
    assert.ok(st.note);
    st = trackCensusRepetition(st, v(true));
    assert.ok(!st.note, 'latched per key — no repeat for the same census');
    // a DIFFERENT census key can still escalate later
    const h = { ok: false, error: { message: 'X: x' }, detectors: { hovercardUnparsed: { field: 'posts.hovercards', unparsedCount: 3, total: 3 } } };
    st = trackCensusRepetition(st, h);
    st = trackCensusRepetition(st, h);
    assert.ok(st.note, 'a second census key gets its own one-shot note');
    assert.match(st.note, /hovercardUnparsed/);
    assert.match(st.note, /annotate\.request/, 'locator-class leads with the user channel');
  });
  it('quality-class censuses fire with their own exits (user channels as fallback, not lead)', () => {
    const q = { ok: false, error: { message: 'X: x' }, detectors: { labelPrefixedCounts: [{ field: 'likeCount', sample: 'Like: 37' }] } };
    let st = null;
    st = trackCensusRepetition(st, q);
    st = trackCensusRepetition(st, q);
    assert.ok(st.note);
    assert.match(st.note, /labelPrefixedCounts/);
    assert.doesNotMatch(st.note, /STUCK LOCATOR/, 'quality class is not locator-class');
  });
  it('veto/error-class detectors never count (own ladders)', () => {
    const e = { ok: false, error: { message: 'COUNT_SHORTFALL: x' }, detectors: { countShortfall: { requested: 7, extracted: 3 } } };
    let st = null;
    st = trackCensusRepetition(st, e);
    st = trackCensusRepetition(st, e);
    assert.ok(!st.note, 'countShortfall is the 205/207 ladder, not this one');
  });
  it('an infra-error verify (error + all-null detector skeleton) is NEUTRAL — counts survive it (211th review F7)', () => {
    const census = v(true);
    const infra = { ok: false, error: { message: 'RELAY_FAILED: tab gone' }, detectors: { seeMoreUnexpanded: null, countShortfall: null } };
    let st = null;
    st = trackCensusRepetition(st, census);
    st = trackCensusRepetition(st, infra);
    st = trackCensusRepetition(st, census);
    assert.ok(st.note, 'the second census escalates — the infra error between them no longer resets the ladder');
  });
  it('a GREEN verify still resets the ladder (no error, empty detectors)', () => {
    let st = null;
    st = trackCensusRepetition(st, v(true));
    st = trackCensusRepetition(st, { ok: true, detectors: {} });
    st = trackCensusRepetition(st, v(true));
    assert.ok(!st.note, 'green is a real verify shape — the reset stands');
  });
  it('wired beside the identity tracker (source audit, wiring call site)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    assert.ok(src.includes('state.censusRepetition = trackCensusRepetition(state.censusRepetition, result)'), 'wiring call site');
  });
});

describe('2a. TWO_SWEEP_MERGE lint (210th log)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
  function run(steps) {
    const deps = {
      rail: { executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1, url: 'https://example.com/search/posts' }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => ({ targetUrl: 'https://example.com/s?q={{k}}', steps }),
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
  it('two $extractWithHover sweeps in one step draws the alignment lint', async () => {
    const script = "const row1 = await $extractWithHover(CARD, FM, {hover:{anchorSel:'h3 a'}}); const row2 = await $extractWithHover(CARD, FM, {hover:{anchorSel:'a:has(span[aria-labelledby])'}}); return row1.map((r,i)=>({a:r, b:row2[i]}));";
    const steps = [{ id: 'extract', name: 'e', script, onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const out = await run(steps);
    const lint = (out.staticLint || []).find((l) => /TWO_SWEEP_MERGE/.test(String(l)));
    assert.ok(lint, 'lint present: ' + JSON.stringify((out.staticLint || []).slice(0, 2)));
    assert.match(lint, /UNION/i);
  });
  it('one sweep stays silent', async () => {
    const steps = [{ id: 'extract', name: 'e', script: "const r = await $extractWithHover(CARD, FM, {hover:{anchorSel:'h3 a, a:has(span[aria-labelledby])'}}); return r;", onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const out = await run(steps);
    assert.ok(!((out.staticLint || []).some((l) => /TWO_SWEEP_MERGE/.test(String(l)))));
  });
});

describe('2b. single-family anchorSel union hint on the receipt (210th log)', () => {
  it('source audit: extractWithHover diagnostics carry the union hint for comma-less anchorSel', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = src.indexOf('anchorUnionHint');
    assert.ok(i > -1, 'hint key exists');
  });
});

describe('3. vocabProposal rides probe.snippet too (210th log)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  function probeDeps(snippetResultObj) {
    return {
      rail: {
        executeDsl: async () => ({ result: JSON.stringify(snippetResultObj), selectorDiagnostics: [] }),
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
  it('a snippet whose result JSON carries repeated ellipsis tails attaches vocabProposal', async () => {
    const recs = { out: [
      { content: 'Java OOP Complete Premium Handbook… See more' },
      { content: 'Advanced Notes … See more' },
      { content: 'Pro tips… See more' }
    ] };
    const t = createSessionTools(probeDeps(recs));
    const r = await t.tools['probe.snippet']({ code: 'return 1;' });
    assert.ok(r.vocabProposal, 'proposal rides the snippet receipt');
    assert.equal(r.vocabProposal.token, 'See more');
  });
  it('no repeated tails → no proposal', async () => {
    const recs = { out: [{ content: 'one full text' }, { content: 'another full text' }] };
    const t = createSessionTools(probeDeps(recs));
    const r = await t.tools['probe.snippet']({ code: 'return 1;' });
    assert.equal(r.vocabProposal, undefined);
  });

  // 211th review F6: probe.snippet caps >4K results to head 2000 + tail 2000
  // BEFORE this harvest runs — the JSON.parse walk saw a permanently
  // truncated document (parse fails → silent null), so every proposal on a
  // big dry-run result was lost. Truncated receipts get a string-LITERAL
  // scan over the two windows instead.
  // The receipt is hand-built (the real cap cut position is luck-dependent —
  // some capped strings stay accidentally parseable), with a self-check
  // that the OLD parse path deterministically fails on it.
  function cappedReceipt(records, padRecords) {
    const full = JSON.stringify({ out: records.concat(padRecords || []) }, null, 1);
    return full.slice(0, 2000) + '…[+' + (full.length - 4000) + ' chars]…' + full.slice(-2000);
  }
  const SEE_MORE_3 = [
    { content: 'Java OOP Complete Premium Handbook… See more' },
    { content: 'Advanced Notes … See more' },
    { content: 'Pro tips… See more' }
  ];
  const PADS = (() => { const p = []; for (let i = 0; i < 30; i++) p.push({ pad: 'z'.repeat(200) }); return p; })();
  function truncatedDeps(capped) {
    return {
      rail: { executeDsl: async () => ({ result: 'ok', selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1 }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => null,
      applyArtifact: () => {},
      getTestInput: () => ({}),
      getOutputSchema: () => ({ type: 'object' }),
      getSteps: () => [],
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: capped, truncated: true }) })
    };
  }
  it('a TRUNCATED (>4K) snippet result with tails in the head/tail windows still attaches vocabProposal', async () => {
    const capped = cappedReceipt(SEE_MORE_3, PADS);
    assert.ok(capped.length > 4000, 'fixture exceeds the 4K cap');
    assert.throws(() => JSON.parse(capped), 'fixture self-check: the OLD JSON.parse path deterministically fails here');
    assert.ok((capped.slice(0, 2000).match(/See more/g) || []).length === 3, 'the three tails sit in the head window');
    const t = createSessionTools(truncatedDeps(capped));
    const r = await t.tools['probe.snippet']({ code: 'return 1;' });
    assert.ok(r.vocabProposal, 'proposal fires on the capped receipt (was: silent null)');
    assert.equal(r.vocabProposal.token, 'See more');
  });
  it('a TRUNCATED result with NO tails attaches nothing (literal scan is not trigger-happy)', async () => {
    const plain = [];
    for (let i = 0; i < 30; i++) plain.push({ content: 'full text record number ' + i + ' plain prose' });
    const capped = cappedReceipt(plain, PADS);
    assert.ok(capped.length > 4000, 'fixture exceeds the 4K cap');
    const t = createSessionTools(truncatedDeps(capped));
    const r = await t.tools['probe.snippet']({ code: 'return 1;' });
    assert.equal(r.vocabProposal, undefined);
  });
});
