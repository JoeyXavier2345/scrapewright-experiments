// extension/test/two-hundred-fourth-log.test.js
//
// 204th log (session rs-1791433141127-1, three resumed fragments, v1-v9
// never green): the model asked for `attr:'textContent'` on the RIGHT
// container all session — the same selector's `attr:'outerHTML'` returned
// 50062 chars while `attr:'textContent'` returned EMPTY every time.
// Root cause: DOM_PROPERTY_READS covers only outerHTML/innerHTML, so the
// most natural DOM read fell through to getAttribute('textContent') →
// null. Five sites (lib readField/readFieldAll, the inline mirror, and
// $extract's two paths) share the bug. This session's entire
// non-convergence traces to it: content '' → the model re-probed
// selectors/hovers for 20+ turns while the user watched chaotic popover
// sweeps that never converged.
//
// Second finding (the 3-tab observation): the artifact authored an `open`
// step with $openTab(posts URL) while the StepOrchestrator ALREADY opens
// the service targetUrl tab — 3 target-site tabs visible (rail + target +
// transient sub-tab), and the sub-tab is destroyed at step end so later
// steps never ran on the page the model "opened". service.update now
// amends targetUrl (same-origin), and a lint teaches the duplication.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { loadInline } = require('./helpers/inline-ops-factory.js');

const libOps = require('../lib/list-extract-ops.js');

function setupDOM() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/page' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.Node = dom.window.Node;
  return dom;
}

const SOURCES = [
  ['lib/list-extract-ops.js', () => libOps],
  ['content-script inline factory', () => loadInline({ document: global.document, window: global.window })]
];

const HTML = `
  <div class="card"><div class="c">Hello textContent world</div><span data-x="attr-value">x</span></div>
  <div class="card"><div class="c">Second card text</div><span data-x="attr-value-2">y</span></div>
`;

for (const [label, getOps] of SOURCES) {
  describe(`attr:'textContent' reads the DOM PROPERTY (204th log) — ${label}`, () => {
    it('returns the element text, not getAttribute null', () => {
      setupDOM();
      document.body.innerHTML = HTML;
      const out = getOps().extractListRecords(
        Array.from(document.querySelectorAll('.card')),
        { content: { selector: '.c', attr: 'textContent' } });
      assert.equal(out[0].content, 'Hello textContent world');
      assert.equal(out[1].content, 'Second card text');
    });
    it('attr:\'innerText\' reads the property too', () => {
      setupDOM();
      document.body.innerHTML = HTML;
      const out = getOps().extractListRecords(
        Array.from(document.querySelectorAll('.card')),
        { t: { selector: '.c', attr: 'innerText' } });
      assert.equal(out[0].t, 'Hello textContent world');
    });
    it('real ATTRIBUTES still read via getAttribute (no regression)', () => {
      setupDOM();
      document.body.innerHTML = HTML;
      const out = getOps().extractListRecords(
        Array.from(document.querySelectorAll('.card')),
        { x: { selector: 'span', attr: 'data-x' } });
      assert.equal(out[0].x, 'attr-value');
    });
    it('huge text is capped with a disclosed marker (50K, mirroring the HTML cap)', () => {
      setupDOM();
      document.body.innerHTML = '<div class="card"><div class="c">' + 'z'.repeat(60000) + '</div></div>';
      const out = getOps().extractListRecords(
        Array.from(document.querySelectorAll('.card')),
        { content: { selector: '.c', attr: 'textContent' } });
      assert.ok(out[0].content.length < 51000, 'capped, got ' + out[0].content.length);
      assert.match(out[0].content, /truncated/i, 'cap is disclosed');
    });
  });
}

describe('$extract paths read textContent as a property (204th log, source audit)', () => {
  const cs = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
  it('EVERY attr-read site includes textContent/innerText (both $extract paths, not just the first)', () => {
    // indexOf() audited only the FIRST of the two sites — a regression in
    // the second $extract path would pass unnoticed. Walk ALL occurrences.
    const re = /attr === 'outerHTML' \|\| attr === 'innerHTML'/g;
    let m;
    let count = 0;
    while ((m = re.exec(cs)) !== null) {
      count += 1;
      assert.match(cs.slice(m.index, m.index + 400), /textContent/, 'site ' + count + ' (offset ' + m.index + ') covers textContent');
    }
    assert.ok(count >= 2, 'both content-script attr-read sites audited, found ' + count);
  });
});

describe('service.update targetUrl amendment + $openTab duplication lint (204th log)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  const STEPS = [{ id: 's1', name: 'one', script: 'return 1', onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
  const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
  function makeDeps(over) {
    const applied = [];
    const deps = {
      rail: { executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1 }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => ({ targetUrl: 'https://example.com/search/top?q={{keyword}}', steps: STEPS }),
      applyArtifact: (a) => { applied.push(a); },
      getTestInput: () => ({}), getOutputSchema: () => ({ type: 'object' }), getSteps: () => STEPS,
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) })
    };
    return { deps: Object.assign(deps, over || {}), applied };
  }
  async function confirm(t) {
    await t.tools['io.confirm']({ inputSchema: { type: 'object', required: ['keyword'] }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } }, CTX);
  }

  it('same-origin targetUrl amendment lands on the artifact (steps-less)', async () => {
    const { deps, applied } = makeDeps();
    const t = createSessionTools(deps);
    await confirm(t);
    const out = await t.tools['service.update']({ targetUrl: 'https://example.com/search/posts?q={{keyword}}' }, CTX);
    assert.equal(out.targetUrlAmended, true, 'got: ' + JSON.stringify(out));
    const withUrl = applied.filter((a) => a.targetUrl);
    assert.equal(withUrl.length, 1);
    assert.equal(withUrl[0].targetUrl, 'https://example.com/search/posts?q={{keyword}}');
  });

  // 211th review F4: {steps, targetUrl} in ONE update used to hit the
  // targetUrl branch and return early — the steps were silently discarded
  // (the receipt blessed an artifact that never landed).
  it('steps + targetUrl in ONE update → BOTH land in a single applyArtifact payload', async () => {
    const newSteps = [{ id: 's1', name: 'one', script: 'return 1', onSuccess: 's2', onFailure: 'TERMINATE' }, { id: 's2', name: 'two', script: 'return 2', onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const { deps, applied } = makeDeps({ getSteps: () => STEPS });
    const t = createSessionTools(deps);
    await confirm(t);
    const out = await t.tools['service.update']({ steps: newSteps, targetUrl: 'https://example.com/search/posts?q={{keyword}}' }, CTX);
    assert.equal(out.updated, true, 'got: ' + JSON.stringify(out));
    const withUrl = applied.filter((a) => a.targetUrl);
    assert.equal(withUrl.length, 1, 'exactly one URL-bearing apply: ' + JSON.stringify(applied.map((a) => Object.keys(a))));
    assert.equal(withUrl[0].targetUrl, 'https://example.com/search/posts?q={{keyword}}');
    assert.equal(withUrl[0].steps.length, 2, 'the NEW steps ride the same payload');
    assert.equal(withUrl[0].steps[1].id, 's2');
    assert.match(String(out.note || ''), /targetUrl amended with this update/, 'receipt discloses the bundled amendment');
  });

  it('cross-origin targetUrl is rejected even when bundled with steps (validation always runs)', async () => {
    const { deps } = makeDeps({ getSteps: () => STEPS });
    const t = createSessionTools(deps);
    await confirm(t);
    const out = await t.tools['service.update']({ steps: STEPS, targetUrl: 'https://other-site.example.com/search' }, CTX);
    assert.match(out.error, /same origin/i);
  });

  it('wizard applySessionArtifact applies targetUrl amendments (211th review F1, source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'wizard.js'), 'utf8');
    const fn = src.slice(src.indexOf('function applySessionArtifact'));
    const body = fn.slice(0, fn.indexOf('\n}') + 2);
    assert.match(body, /a\.targetUrl === 'string'/, 'a targetUrl branch exists');
    assert.match(body, /wizardState\.targetUrl = /, 'it writes wizardState.targetUrl');
    assert.match(body, /getElementById\('targetUrl'\)/, 'the UI input is synced (best-effort)');
  });

  it('cross-origin targetUrl is REJECTED (redirection guard)', async () => {
    const { deps } = makeDeps();
    const t = createSessionTools(deps);
    await confirm(t);
    const out = await t.tools['service.update']({ targetUrl: 'https://other-site.example.com/search' }, CTX);
    assert.match(out.error, /same origin/i);
  });

  it('a step $openTab-ing the service origin draws the duplication lint', async () => {
    const openStep = { id: 'open', name: 'open', onSuccess: 's1', onFailure: 'TERMINATE', script: "await $openTab('https://example.com/search/posts?q='+encodeURIComponent(__input__.keyword), async()=>{await $wait('div');});return {opened:true};" };
    const { deps } = makeDeps({ getSteps: () => [openStep], getDraftService: () => ({ targetUrl: 'https://example.com/search/top?q={{keyword}}', steps: [openStep, STEPS[0]] }) });
    const t = createSessionTools(deps);
    await confirm(t);
    const out = await t.tools['service.update']({ steps: [openStep, STEPS[0]] }, CTX);
    const lint = (out.staticLint || []).find((l) => /OPENTAB_DUPLICATES_TARGET/.test(String(l)));
    assert.ok(lint, 'lint present, got: ' + JSON.stringify(out.staticLint || out.error));
    assert.match(lint, /destroyed at step end/, 'teaches the sub-tab lifetime');
    assert.match(lint, /targetUrl/, 'teaches the amendment exit');
  });
});
