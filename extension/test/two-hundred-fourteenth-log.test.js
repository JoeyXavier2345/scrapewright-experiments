// extension/test/two-hundred-fourteenth-log.test.js
//
// 214th log (session rs-1791550771520-1, 旅行 keyword — the first session
// to stop reason=completed):
//   A. v6 authored extract.onSuccess=expand + expand.onSuccess/onFailure=
//      extract — a PURE-onSuccess cycle whose two steps ALWAYS return ready
//      results ({posts} / {done:true}). The graph ping-ponged 50 executions
//      over 745s until the orchestrator global cap threw a BARE
//      STEP_ITERATION_EXCEEDED — no stepId, no traversal, no per-step
//      counts — and the verify receipt shipped steps:[] with every detector
//      null (unfalsifiable). validateChain passed the graph (targets
//      exist, no orphans, no SELF — no cycle check).
//   B. The surrender finish: the VERIFY ECONOMICS note said "roughly 0 more
//      fits in the remaining wall budget" (refCost = max(median 48.5s,
//      last 745s)) while 633 billable seconds REMAINED and ~13
//      median-cost verifies fit — the model disclosed "verify wall budget
//      was exhausted" and finished. The note must name the remaining
//      seconds and the median-cost fits, not only the worst-shape fits.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
global.debugLogger = { log: () => {} };
const { StepOrchestrator } = require('../lib/step-orchestrator');
const urlTemplate = require('../lib/url-template');
global.UrlTemplate = urlTemplate;
const { validateChain } = require('../lib/wizard-utils');

const INCIDENT_EXTRACT = "const recs=await $extractWithHover(sel,{...}); return {posts:recs.map(r=>({postId:r.id}))};";
const INCIDENT_EXPAND = "await $clickInList('div[role=button]',{textFilter:'See more'}); await new Promise(r=>setTimeout(r,1200)); return {done:true};";

function incidentGraph() {
  return [
    { id: 'scroll', name: 'scroll', script: 'return {done:true,have:1};', onSuccess: 'extract', onFailure: 'TERMINATE' },
    { id: 'extract', name: 'extract', script: INCIDENT_EXTRACT, onSuccess: 'expand', onFailure: 'TERMINATE' },
    { id: 'expand', name: 'expand', script: INCIDENT_EXPAND, onSuccess: 'extract', onFailure: 'extract' }
  ];
}

describe('A1. validateChain rejects the exit-less onSuccess cycle (214th log)', () => {
  it('the incident graph (extract ⇄ expand, both always-ready) is rejected with the cycle path + teaching', () => {
    const out = validateChain(incidentGraph());
    assert.notEqual(out && out.valid, true, 'must be invalid: ' + JSON.stringify(out));
    assert.match(out.error, /onSuccess-only cycle/i);
    assert.match(out.error, /extract → expand → extract/, 'names the cycle path');
    assert.match(out.error, /maxIterations>\s*1|\{done:\s*false\}/, 'teaches the sanctioned exits');
  });
  it('a cycle WITHOUT the incident shape still passes when any edge exits (linear graph sanity)', () => {
    const out = validateChain([
      { id: 'a', name: 'a', script: 'return 1;', onSuccess: 'b', onFailure: 'TERMINATE' },
      { id: 'b', name: 'b', script: 'return 2;', onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }
    ]);
    assert.equal(out.valid, true);
  });
});

describe('A2. sanctioned loop idioms stay valid', () => {
  // 225th review #4: a maxIterations>1 budget alone is no longer an exit
  // declaration — the member must also carry a not-ready/failure signal
  // (a retry budget with no not-ready emission rejoins the cycle on ready
  // results and spins to the global cap). The poll fixtures now use a real
  // poll script shape.
  it('cycle with a poll step declaring maxIterations>1 AND a not-ready branch passes', () => {
    const steps = incidentGraph();
    steps[2].maxIterations = 5;
    steps[2].script = "const ok=await $clickInList(sel, sub); if(!ok.all) return {done:false}; return {done:true};";
    const out = validateChain(steps);
    assert.equal(out.valid, true, JSON.stringify(out));
  });
  it('maxIterations>1 WITHOUT any not-ready/failure token is rejected (225th review #4)', () => {
    const steps = incidentGraph();
    steps[2].maxIterations = 5;
    const out = validateChain(steps);
    assert.notEqual(out.valid, true, 'budget without a not-ready emission spins to the cap');
  });
  it('cycle with an explicit failure-signal token in a member script passes', () => {
    const steps = incidentGraph();
    steps[2].script = "const ok=await $click(sel); if(!ok) return {failed:true}; return {done:true};";
    const out = validateChain(steps);
    assert.equal(out.valid, true, JSON.stringify(out));
  });
  it('the orchestrator back-edge fixture (a⇄b, b maxIterations:50 + failure branch) passes', () => {
    const out = validateChain([
      { id: 'a', name: 'A', script: 'a', onSuccess: 'b', onFailure: 'TERMINATE', maxIterations: 1 },
      { id: 'b', name: 'B', script: 'b; if (stalled) return {failed:true}; return {ok:true};', onSuccess: 'a', onFailure: 'TERMINATE', maxIterations: 50 }
    ]);
    assert.equal(out.valid, true, JSON.stringify(out));
  });
});

describe('A3. the global-cap throw carries falsifiable evidence (214th log)', () => {
  async function runCycle() {
    const service = {
      targetUrl: 'http://example.com',
      steps: [
        { id: 'a', name: 'A', script: 'a', onSuccess: 'b', onFailure: 'TERMINATE' },
        { id: 'b', name: 'B', script: 'b', onSuccess: 'a', onFailure: 'TERMINATE' }
      ],
      config: { maxStepIterations: 6 }
    };
    const deps = {
      createTab: async (url) => ({ id: 1, url }),
      waitForTabLoad: async () => {},
      executeScript: async (tabId, script) => ({ script, ready: true }),
      captureSnapshot: async () => ({ html: '<html></html>' }),
      removeTab: async () => {},
      evaluateCondition: async () => true
    };
    return StepOrchestrator.execute(service, {}, deps);
  }
  it('rejects with stepId + traversal tail + per-step counts + cycle teaching', async () => {
    await assert.rejects(runCycle(), (err) => {
      assert.match(err.message, /STEP_ITERATION_EXCEEDED/);
      assert.ok(err.stepId, 'stepId attached (was null in the incident)');
      assert.equal(err.globalIteration, 7, 'global iteration count attached');
      assert.match(err.message, /a → b( → a)?/, 'recent traversal tail in the message');
      assert.match(err.message, /a×3, b×3|a×\d+, b×\d+/, 'per-step execution counts in the message');
      assert.match(err.message, /onSuccess|cycle/i, 'teaches the success-edge cycle cause');
      return true;
    });
  });
});

describe('B. VERIFY ECONOMICS note names remaining budget + median fits (214th log)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  it('a worst-shape verify no longer claims the wall budget is exhausted when median verifies fit', async () => {
    let calls = 0;
    const artifactSteps = [
      { id: 'collect', script: 'const n = await $count("div"); return {done:true, n};', onSuccess: 'extract', onFailure: 'TERMINATE' },
      { id: 'extract', script: 'const r = await $extractList("div", {t:{selector:"span"}}); return r;', onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }
    ];
    const tools = createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({}), epoch: 0 },
      runVerify: async () => {
        calls += 1;
        if (calls === 3) await new Promise((r) => setTimeout(r, 25)); // the one expensive verify
        else await new Promise((r) => setTimeout(r, 2)); // cheap priors: a real median > 0ms
        return { events: [], report: { ok: false, error: { message: 'x' }, detectors: {} }, raw: {} };
      },
      probeFactory: () => ({ hover: async () => ({ hovered: false }) }),
      getDraftService: () => ({ steps: artifactSteps, inputSchema: {}, outputSchema: {} }),
      applyArtifact: () => {},
      getTestInput: () => ({ keyword: 'k' }),
      getOutputSchema: () => ({ type: 'object' }),
      getSteps: () => artifactSteps
    });
    const CTX = {
      session: {
        state: () => ({ session: { artifactVersions: [] } }),
        budgets: { wallClockMs: 1000 },
        elapsedMs: 980 // remaining 20ms: < the 25ms expensive verify, ≫ the ~0ms median
      }
    };
    await tools.tools['verify.run']({}, CTX);
    await tools.tools['verify.run']({}, CTX);
    const r = await tools.tools['verify.run']({}, CTX);
    const note = String((r && r.note) || '');
    assert.match(note, /VERIFY ECONOMICS/);
    assert.match(note, /median-cost\s+verif/i, 'names how many median-cost verifies still fit');
    assert.match(note, /NOT exhausted|still fit/i, 'explicitly corrects the exhausted reading');
  });
});
