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
  it('fires once (latched), wired in the engine (source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    assert.match(src, /trackIdentityFailures\(/);
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
