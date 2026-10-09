// extension/test/two-hundred-eighth-log.test.js
//
// 208th log (user four-question audit of session rs-1791511010473-1):
//   Q1 "scrolling CAN load more — why the count struggle?" — TRUE: the
//      research tab (/search/posts) went 9→17 distinct after scroll, and the
//      verify tab's containers went 8→15. Supply was never the problem.
//   Q2 raw-HTML post determination — the harvest's hand-rolled pidOf regex
//      enumerated 6 href families and SKIPPED every card outside them
//      (`if (!pid) continue;`); v7/v9 shipped literal "undefined" ids on
//      2/7 records (regex fallback). 15 containers → 3 survivors was
//      determination-loss, not page scarcity.
//   Q3 "why never ask the user for annotation help?" — annotate.request
//      was called ZERO times; the FIELD_ASSIST escalation only triggers on
//      per-field failures, never for the identity/determination class.
//   Q4 cold/hot mixing — worse than mixing: research evidence came from
//      /search/posts (17 distinct observed) while the service targetUrl is
//      /search/top (5-7 unique on fresh tabs) — a page-VARIANT divergence
//      the 204th amendment exit exists for and was never used.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('F1. research-vs-target URL divergence rides the shortfall error (208th log)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  const STEPS = [{ id: 's1', name: 'one', script: 'return 1', onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
  const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
  function deps(railUrl, targetUrl) {
    return {
      rail: { executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1, url: railUrl }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async (o) => ({
        report: {
          ok: false,
          error: { message: 'COUNT_SHORTFALL_SUPPLY: posts delivered 3 of 7 requested while this run matched 15 containers.', stepId: null },
          aborted: false, score: { score: 0, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [],
          detectors: { countShortfall: { field: 'posts', requested: 7, extracted: 3, maxContainers: 15, exhaustionCertified: false } },
          steps: [], resultDebug: null, finalResult: null, pages: '0', eventCount: 0, events: []
        },
        events: [], raw: { testResult: null, error: null, breaker: null }
      }),
      getDraftService: () => ({ targetUrl: targetUrl, steps: STEPS }),
      applyArtifact: () => {},
      getTestInput: () => ({}), getOutputSchema: () => ({ type: 'object' }), getSteps: () => STEPS,
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) })
    };
  }
  async function confirm(t) {
    await t.tools['io.confirm']({ inputSchema: { type: 'object', required: ['q'] }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } }, CTX);
  }
  it('research on /search/posts while the service runs /search/top → the verify receipt names the variant divergence + the amendment exit', async () => {
    const t = createSessionTools(deps('https://www.facebook.com/search/posts?q=coffee', 'https://www.facebook.com/search/top?q={{keyword}}'));
    await confirm(t);
    const out = await t.tools['verify.run']({}, CTX);
    assert.match(out.error.message, /COUNT_SHORTFALL_SUPPLY/);
    assert.match(out.error.message, /RESEARCH\/TARGET DIVERGENCE/i, 'names it: ' + out.error.message.slice(-400));
    assert.match(out.error.message, /search\/posts.*search\/top|search\/top.*search\/posts/, 'shows both paths');
    assert.match(out.error.message, /targetUrl/, 'teaches the amendment exit');
  });
  it('same path → no divergence noise', async () => {
    const t = createSessionTools(deps('https://www.facebook.com/search/posts?q=coffee', 'https://www.facebook.com/search/posts?q={{keyword}}'));
    await confirm(t);
    const out = await t.tools['verify.run']({}, CTX);
    assert.doesNotMatch(out.error.message, /RESEARCH\/TARGET DIVERGENCE/i);
  });
});

describe('F2. identity-failure escalation to annotate.request after 2 consecutive (208th log)', () => {
  const { trackIdentityFailures } = require('../lib/research-session');
  const idErr = (cls) => ({ ok: false, error: { message: cls + ': posts.postId ...' }, detectors: {} });
  it('second consecutive identity-class failure returns the annotation-escalation note', () => {
    let st = null;
    st = trackIdentityFailures(st, idErr('DUPLICATE_ID_REQUIRED'));
    assert.ok(!st.note);
    st = trackIdentityFailures(st, idErr('CAPTURED_VALUE_UNBOUND'));
    assert.ok(st.note, 'the class mixes across DUPLICATE/CAPTURED — both are determination failures');
    assert.match(st.note, /annotate\.request/);
    assert.match(st.note, /mark/i);
  });
  it('a shortfall or green resets', () => {
    let st = null;
    st = trackIdentityFailures(st, idErr('DUPLICATE_ID_REQUIRED'));
    st = trackIdentityFailures(st, { ok: false, error: { message: 'COUNT_SHORTFALL_SUPPLY: x' }, detectors: {} });
    assert.equal(st.count, 0);
  });
  it('the note is one-shot — a green verify clears it; fresh incidents on a fresh tracker re-fire (211th-round latch fix)', () => {
    let st = null;
    st = trackIdentityFailures(st, idErr('DUPLICATE_ID_REQUIRED'));
    st = trackIdentityFailures(st, idErr('CAPTURED_VALUE_UNBOUND'));
    assert.ok(st.note, 'fired');
    st = trackIdentityFailures(st, { ok: true, detectors: {} });
    assert.equal(st.note, null, 'green consumes the one-shot note (was latched forever, re-pushed every verify)');
    st = trackIdentityFailures(st, idErr('INVENTED_ID_FALLBACK'));
    assert.equal(st.note, null, 'the fired latch holds — no repeat on the same tracker');
    let fresh = null;
    fresh = trackIdentityFailures(fresh, idErr('DUPLICATE_ID_REQUIRED'));
    fresh = trackIdentityFailures(fresh, idErr('INVENTED_ID_FALLBACK'));
    assert.ok(fresh.note, 'fresh incidents re-fire on a fresh tracker');
  });
  it('fires once (latched), wired in the engine (source audit, wiring call site)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    assert.ok(src.includes('state.identityFailures = trackIdentityFailures(state.identityFailures, result)'), 'wiring call site');
  });
});

describe('F3. hand-rolled id-regex dedupe loop draws the $collectUntil lint (208th log)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
  const HARVEST = "const seen = {}; const pidOf = h => { const m = (h||'').match(/(?:story_fbid=|\\/posts\\/|[?&]fbid=|videos\\/|photo\\/)([A-Za-z0-9_-]{6,})/); return m ? m[1] : ''; }; const rs = await $extractWithHover('div[aria-posinset]', FM, {hover:{anchorSel:'h3 a'}}); for (const r of rs) { const pid = pidOf(r.permalink); if (!pid || seen[pid]) continue; seen[pid] = 1; posts.push({postId: pid}); }";
  const STEPS = [{ id: 'harvest', name: 'h', script: HARVEST, onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
  function deps() {
    return {
      rail: { executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1, url: 'https://example.com/search/posts' }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => ({ targetUrl: 'https://example.com/search/posts?q={{k}}', steps: STEPS }),
      applyArtifact: () => {},
      getTestInput: () => ({}), getOutputSchema: () => ({ type: 'object' }), getSteps: () => STEPS,
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) })
    };
  }
  it('regex + seen-map + skip-on-no-id in a step → HANDROLLED_ID_DEDUPE advisory', async () => {
    const t = createSessionTools(deps());
    await t.tools['io.confirm']({ inputSchema: { type: 'object', required: ['q'] }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } }, CTX);
    const out = await t.tools['service.update']({ steps: STEPS }, CTX);
    const lint = (out.staticLint || []).find((l) => /HANDROLLED_ID_DEDUPE/.test(String(l)));
    assert.ok(lint, 'lint present: ' + JSON.stringify((out.staticLint || []).slice(0, 3)));
    assert.match(lint, /collectUntil/);
    assert.match(lint, /silently skip/i);
  });
});

describe('F4. WANDERING REDS — three consecutive verifies, three DISTINCT classes (208th follow-up)', () => {
  const { trackWanderingReds } = require('../lib/research-session');
  const red = (cls) => ({ ok: false, error: { message: cls + ': details' } });
  it('the LIVE sequence (SHORTFALL → CAPTURED → SHORTFALL → DUPLICATE → DEADLINE → DUPLICATE) fires the method-change note', () => {
    let st = null;
    st = trackWanderingReds(st, red('COUNT_SHORTFALL_SUPPLY'));
    st = trackWanderingReds(st, red('CAPTURED_VALUE_UNBOUND'));
    assert.ok(!st.note, 'two classes is not yet thrash');
    st = trackWanderingReds(st, { ok: true, detectors: {} });
    assert.ok(!st.note);
    st = trackWanderingReds(st, red('COUNT_SHORTFALL_SUPPLY'));
    st = trackWanderingReds(st, red('DUPLICATE_ID_REQUIRED'));
    st = trackWanderingReds(st, red('SANDBOX_DEADLINE'));
    assert.ok(st.note, 'third distinct class in the window fires');
    assert.match(st.note, /WANDERING REDS/);
    assert.match(st.note, /patch:true/);
    assert.match(st.note, /escalate/);
  });
  it('the SAME class three times is convergence territory — no wandering note (the 205/207 breakers own it)', () => {
    let st = null;
    for (let i = 0; i < 3; i++) st = trackWanderingReds(st, red('COUNT_SHORTFALL_SUPPLY'));
    assert.ok(!st.note);
  });
  it('a green resets the window; the note fires once (latched)', () => {
    let st = null;
    st = trackWanderingReds(st, red('A_X'));
    st = trackWanderingReds(st, red('B_Y'));
    st = trackWanderingReds(st, { ok: true, detectors: {} });
    st = trackWanderingReds(st, red('C_Z'));
    st = trackWanderingReds(st, red('D_W'));
    assert.ok(!st.note, 'green reset the window mid-sequence');
    st = trackWanderingReds(st, red('E_V'));
    assert.ok(st.note, 'three distinct after the reset fires once');
    st = trackWanderingReds(st, red('F_U'));
    assert.ok(!st.note, 'latched — no repeat');
  });
  it('wired in the engine (source audit, wiring call site)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    assert.ok(src.includes('state.wanderingReds = trackWanderingReds(state.wanderingReds, result)'), 'wiring call site');
  });
});

describe('211-review #17: HANDROLLED_ID_DEDUPE is site-generic (no fbid tokens in the gate)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
  it('a NON-FB id regex + seen-map + skip fires the lint (generic shape, not href tokens)', async () => {
    const script = "const seen = {}; const idOf = h => { const m = (h||'').match(/\\/items\\/(\\w+)/); return m ? m[1] : ''; }; const rs = await $extractList('div.card', FM); for (const r of rs) { const id = idOf(r.u); if (!id || seen[id]) continue; seen[id] = 1; out.push(r); }";
    const steps = [{ id: 'x', name: 'x', script, onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const deps = {
      rail: { executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1, url: 'https://example.com/list' }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => ({ targetUrl: 'https://example.com/list', steps }),
      applyArtifact: () => {},
      getTestInput: () => ({}), getOutputSchema: () => ({ type: 'object' }), getSteps: () => steps,
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) })
    };
    const t = createSessionTools(deps);
    await t.tools['io.confirm']({ inputSchema: { type: 'object', required: ['q'] }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } }, CTX);
    const out = await t.tools['service.update']({ steps }, CTX);
    assert.ok((out.staticLint || []).some((l) => /HANDROLLED_ID_DEDUPE/.test(String(l))), 'generic /items/ regex fires — no site token required');
  });
  it('source gate carries no fbid/story_fbid tokens (universality)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'session-tools.js'), 'utf8');
    const i = src.indexOf('HANDROLLED_ID_DEDUPE:');
    const gate = src.slice(i - 900, i);
    assert.doesNotMatch(gate, /fbid|story_fbid|pfbid/, 'the detection regex is site-generic');
  });
});
