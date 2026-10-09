// extension/test/two-hundred-ninth-log.test.js
//
// 209th log (user's three observations on the in-flight 旅行 session):
//   1. "See more这么简单一直没正确触发" — the artifact's expand step was
//      `$click('[role=feed] > div div[role=button].xzsf02u')` — a CLASS
//      shared by every role=button on the page; CSS cannot target "the
//      button whose TEXT is See more", so the first .xzsf02u (a Like /
//      Follow button) got clicked 40 loop iterations in a row while the
//      SEE_MORE_UNEXPANDED census fired on EVERY verify (3,2,5,6,5 records).
//      FIX: textFilter option on $click and $clickInList — click only
//      matches whose textContent contains the filter.
//   2. "一直只能检测到5条" — the v7 identity census: 10 containers matched,
//      4 DISTINCT postId in the output. The collect step deduped by
//      $collectUntil({idAttr:'aria-posinset'}) — a POSITIONAL attribute
//      (remount duplicates share positions; distinct records can share one
//      after shifts). FIX: identity-attr lint — positional attrs are not ids.
//   3. "先逐一弹第一行再逐一弹第二行" — the model's anchorSel evolved from
//      the comma-UNION (a.x1i10hfl, a:has(span[aria-labelledby])… — one
//      per-card sweep covering both rows) to single-family 'h2 a' then
//      'h3 a' dry-runs (05:26:13 h2 a found 0 anchors; 05:26:19 h3 a),
//      i.e. split per-row calls. FIX: receipt note — single-family
//      anchorSel gets the union hint.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

function setupDOM(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/page' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.Node = dom.window.Node;
  return dom;
}

const { loadInline } = require('./helpers/inline-ops-factory.js');
const libOps = require('../lib/list-extract-ops.js');

const HTML = `
  <div class="card"><div class="btn xzsf02u" role="button">Like</div><div class="btn xzsf02u" role="button">See more</div></div>
  <div class="card"><div class="btn xzsf02u" role="button">Follow</div><div class="btn xzsf02u" role="button">See more</div></div>
`;

const CLICKED = [];
function mkOps(ops) {
  // clickInListItems is pure: containers, subSel, clickFn, delayMs, opts
  return ops;
}

for (const [label, getOps] of [['lib', () => libOps], ['inline mirror', () => loadInline({ document: global.document, window: global.window })]]) {
  describe(`clickInListItems textFilter — ${label} (209th log)`, () => {
    it('clicks ONLY the matches whose textContent contains the filter (See more, not Like/Follow)', () => {
      setupDOM(HTML);
      const clickedTexts = [];
      const r = getOps().clickInListItems(
        document.querySelectorAll('.card'),
        'div[role=button]',
        (el) => { clickedTexts.push(el.textContent.trim()); },
        0,
        { textFilter: 'See more' });
      assert.equal(r.clicked, 2, 'one see-more per card');
      assert.deepEqual(clickedTexts, ['See more', 'See more']);
      assert.equal(r.errors.length, 0);
    });
    it('no textFilter → first-match semantics unchanged (regression guard)', () => {
      setupDOM(HTML);
      const clickedTexts = [];
      const r = getOps().clickInListItems(
        document.querySelectorAll('.card'),
        'div[role=button]',
        (el) => { clickedTexts.push(el.textContent.trim()); },
        0);
      assert.equal(r.clicked, 2);
      assert.deepEqual(clickedTexts, ['Like', 'Follow']);
    });
    it('a card with NO matching-text sub-element reports skipped, not silent success', () => {
      setupDOM(HTML + '<div class="card"><div class="btn" role="button">Share</div></div>');
      const r = getOps().clickInListItems(
        document.querySelectorAll('.card'),
        'div[role=button]',
        () => {},
        0,
        { textFilter: 'See more' });
      assert.equal(r.clicked, 2);
      assert.equal(r.errors.length, 1, 'third card reports text-not-matched');
      assert.match(String(r.errors[0].reason), /See more/);
    });
    it('regex string filter (leading ~) matches by pattern', () => {
      setupDOM(HTML);
      const clickedTexts = [];
      getOps().clickInListItems(
        document.querySelectorAll('.card'),
        'div[role=button]',
        (el) => { clickedTexts.push(el.textContent.trim()); },
        0,
        { textFilter: '~^See\\s+more$' });
      assert.deepEqual(clickedTexts, ['See more', 'See more']);
    });
  });
}

describe('domClickInList wires textFilter (209th log, source audit)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  it('the wrapper passes opts.textFilter into clickInListItems', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = src.indexOf('clickInListItems(');
    const region = src.slice(i, i + 700);
    assert.match(region, /textFilter/, 'opts.textFilter reaches the pure helper');
  });
  it('$click textFilter: the click relay carries the filter (source audit)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
    const i = src.indexOf('result = await domClick(data.selector');
    assert.ok(i > -1, 'click relay found');
    assert.match(src.slice(i, i + 260), /data\.args && data\.args\[1\]/, '$click forwards args[1] (the textFilter opts)');
  });
});

describe('positional idAttr lint (209th log)', () => {
  const { createSessionTools } = require('../lib/session-tools');
  const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
  it('collectUntil with idAttr aria-posinset draws the POSITIONAL_IDENTITY lint', async () => {
    const steps = [{ id: 'collect', name: 'c', script: "await $collectUntil('[role=feed] > div', {targetCount: 10, idAttr: 'aria-posinset'});return 1;", onSuccess: 'TERMINATE', onFailure: 'TERMINATE' }];
    const deps = {
      rail: { executeDsl: async () => ({ result: { ok: true }, selectorDiagnostics: [] }), pageState: async () => ({ open: true, tabId: 1, url: 'https://example.com/search/posts' }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ report: { ok: true, error: null, aborted: false, score: { score: 100, isData: true, breakdown: {} }, schemaOk: true, schemaMissing: [], detectors: {}, steps: [], finalResult: null, pages: '0', eventCount: 0, events: [] }, events: [], raw: {} }),
      getDraftService: () => ({ targetUrl: 'https://example.com/search/posts?q={{k}}', steps }),
      applyArtifact: () => {},
      getTestInput: () => ({}), getOutputSchema: () => ({ type: 'object' }), getSteps: () => steps,
      ioConfirmBridge: { request: async () => ({ confirmed: true }) },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) })
    };
    const t = createSessionTools(deps);
    await t.tools['io.confirm']({ inputSchema: { type: 'object', required: ['q'] }, outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object' } } } } }, CTX);
    const out = await t.tools['service.update']({ steps }, CTX);
    const lint = (out.staticLint || []).find((l) => /POSITIONAL_IDENTITY/.test(String(l)));
    assert.ok(lint, 'lint present: ' + JSON.stringify((out.staticLint || []).slice(0, 3)));
    assert.match(lint, /href|identity/i);
  });
});
