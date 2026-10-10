// extension/test/two-hundred-nineteenth-log.test.js
//
// 219th round (user-directed defect sweep — the five items left open by
// earlier rounds' audits):
//   1. OPENTAB_DUPLICATES_TARGET matched ORIGIN equality only — a legit
//      DETAIL-page $openTab (same origin, different path family) drew the
//      "redundant third tab" lint. Fire on path-shape equality or a shared
//      non-root directory (the 204th variant-reopen class); pass detail
//      pages.
//   2. attr:'textContent' routed to readTextProperty (innerText-first) —
//      an EXPLICIT textContent request got visual-text semantics, silently
//      dropping hidden spans (the labelledby carriers). Honor the explicit
//      property.
//   3. detectDuplicateNestedEntries: a NAMED entry (typed) and its UNNAMED
//      re-capture (no type/role) produced different identity keys — the
//      same entity twice escaped grouping. Empty-disc entries join the
//      matching idish group.
//   4. report.events (TAG strings, engine contract) vs eventCount (raw
//      run-event count) — the two names read as the same thing. Rename the
//      counter to rawEventCount; pin both contracts.
//   5. Playwright chaining syntax ("sel >> nth=1") burned a round (218th
//      session, self-healed one call later) — the invented-pseudo lint did
//      not see '>>' engine syntax. Extend the candidate extraction.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function setupDOM(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/page' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.Node = dom.window.Node;
  return dom;
}

// ---------- 1. OPENTAB_DUPLICATES_TARGET scope ----------

describe('1. OPENTAB_DUPLICATES_TARGET path-shape scoping (219th round)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  function runLint(steps, targetUrl) {
    const t = createSessionTools({
      rail: { executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1, url: targetUrl }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => ({ targetUrl, steps }),
      applyArtifact: () => {},
      getTestInput: () => ({}), getOutputSchema: () => ({ type: 'object' }), getSteps: () => steps,
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) })
    });
    const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
    return (async () => {
      await t.tools['io.confirm']({ inputSchema: { type: 'object', required: ['q'] }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } }, CTX);
      return t.tools['service.update']({ steps }, CTX);
    })();
  }
  it('a SAME-PATH re-open (template shape equal) still draws the lint', async () => {
    const steps = [{ id: 'a', name: 'a', script: "await $openTab('https://example.com/search/top?q=travel', async()=>({})); return {done:true};", onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const out = await runLint(steps, 'https://example.com/search/top?q={{keyword}}');
    assert.ok((out.staticLint || []).some((l) => /OPENTAB_DUPLICATES_TARGET/.test(String(l))), 'same-shape re-open flagged');
  });
  it('a VARIANT page in the same directory (204th class) still draws the lint', async () => {
    const steps = [{ id: 'a', name: 'a', script: "await $openTab('https://example.com/search/posts/?q=travel', async()=>({})); return {done:true};", onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const out = await runLint(steps, 'https://example.com/search/top?q={{keyword}}');
    assert.ok((out.staticLint || []).some((l) => /OPENTAB_DUPLICATES_TARGET/.test(String(l))), 'shared-directory variant flagged');
  });
  it('a DETAIL page in a different path family passes silently', async () => {
    const steps = [{ id: 'a', name: 'a', script: "await $openTab('https://example.com/posts/pfbid.123456789012', async()=>({})); return {done:true};", onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const out = await runLint(steps, 'https://example.com/search/top?q={{keyword}}');
    assert.ok(!((out.staticLint || []).some((l) => /OPENTAB_DUPLICATES_TARGET/.test(String(l)))), 'detail page not flagged');
  });
});

// ---------- 2. attr:'textContent' honors the explicit property ----------

describe('2. explicit textContent/innerText property reads (219th round)', () => {
  const HTML = `<div class="card"><span style="display:none">hidden-value</span><span>visible-value</span></div>`;
  for (const [label, getOps] of [['lib', () => require('../lib/list-extract-ops.js')], ['inline mirror', () => require('./helpers/inline-ops-factory.js').loadInline({ document: global.document, window: global.window })]]) {
    it(`${label}: attr:'textContent' reads hidden text; attr:'innerText' prefers visible`, async () => {
      setupDOM(HTML);
      // jsdom does not implement innerText (it renders undefined) — stub the
      // browser behavior so the innerText-first path is actually exercised.
      for (const el of document.querySelectorAll('.card, .card *')) {
        Object.defineProperty(el, 'innerText', { configurable: true, get() { return 'visible-value'; } });
      }
      const out = await getOps().extractListRecords(
        Array.from(document.querySelectorAll('.card')),
        { tc: { selector: 'span', attr: 'textContent' }, it: { selector: 'span', attr: 'innerText' } },
        { allowEmpty: true });
      assert.equal(out[0].tc, 'hidden-value', 'textContent = the DOM property, not visual text');
      assert.equal(out[0].it, 'visible-value', 'innerText keeps the visual-text-first semantics');
    });
  }
});

// ---------- 3. nested duplicate: named + unnamed same entity groups ----------

describe('3. detectDuplicateNestedEntries — empty-disc joins the idish group (219th round)', () => {
  const WU = require('../lib/wizard-utils');
  it('a typed entry and its untyped re-capture (same link) are one group', () => {
    const data = { posts: [{
      postId: 'p1',
      hovercards: [
        { link: '/groups/123456789012345', type: 'group', kv: { name: 'photo club' } },
        { link: '/groups/123456789012345' }
      ]
    }] };
    const out = WU.detectDuplicateNestedEntries(data, { type: 'object', properties: { posts: { type: 'array', items: { type: 'object', properties: { hovercards: { type: 'array', items: { type: 'object' } } } } } } });
    assert.equal(out.length, 1, 'the pair groups: ' + JSON.stringify(out));
    assert.equal(out[0].count, 2);
  });
  it('two DIFFERENT types on the same link stay separate (regression pin)', () => {
    const data = { posts: [{
      postId: 'p1',
      hovercards: [
        { link: '/watch/123456789012', type: 'video' },
        { link: '/watch/123456789012', type: 'page' }
      ]
    }] };
    const out = WU.detectDuplicateNestedEntries(data, { type: 'object', properties: { posts: { type: 'array', items: { type: 'object', properties: { hovercards: { type: 'array', items: { type: 'object' } } } } } } });
    assert.equal(out.length, 0, 'distinct typed entities on one link are not duplicates');
  });
});

// ---------- 4. rawEventCount naming ----------

describe('4. report counter renamed rawEventCount (219th round)', () => {
  it('verify report carries rawEventCount (raw run events), events stays TAG strings', async () => {
    const { createVerifyRunner } = require('../lib/verify-runner');
    const deps = {
      ensureLock: async () => {}, releaseLock: async () => {},
      createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }),
      executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }),
      evaluateCondition: async () => true,
      orchestrate: async (svc, input, d, opts) => {
        await d.createTab(svc.targetUrl);
        opts.onEvent({ type: 'EXECUTION_START' });
        opts.onEvent({ type: 'STEP_ITERATION', stepId: 's1', iteration: 1, resultPreview: '{"done":true}' });
        return { finalResult: { posts: [{ a: 1 }] }, steps: [], pages: [], pagesTruncated: false };
      }
    };
    const runner = createVerifyRunner(deps);
    const out = await runner({
      service: { targetUrl: 'https://example.com/', steps: [{ id: 's1', name: 's', script: 'return {};', onSuccess: 'TERMINATE' }], config: {} },
      input: {}, outputSchema: { type: 'object', properties: { posts: { type: 'array', items: { type: 'object' } } } }
    });
    assert.equal(typeof out.report.rawEventCount, 'number', 'rawEventCount present');
    assert.ok(!('eventCount' in out.report) || out.report.eventCount === out.report.rawEventCount, 'the ambiguous name is gone or aliased identically');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'verify-runner.js'), 'utf8');
    assert.match(src, /rawEventCount:\s*events\.length/, 'the raw counter is the renamed key');
  });
});

// ---------- 5. Playwright chaining syntax lint ----------

describe('5. invented-syntax lint covers Playwright chaining (219th round)', () => {
  const WU = require('../lib/wizard-utils');
  it("'sel >> nth=1' is an invented-syntax candidate", () => {
    const out = WU.extractInventedPseudoCandidates("const x = await $('div[role=article] >> nth=1');");
    assert.ok(out.some((c) => />>/.test(c.sel)), 'candidate extracted: ' + JSON.stringify(out));
  });
  it('plain CSS stays out of the candidate list', () => {
    const out = WU.extractInventedPseudoCandidates("const x = await $('div[role=article]:nth-of-type(2) a[href]');");
    assert.equal(out.filter((c) => />>/.test(c.sel)).length, 0);
  });
});
