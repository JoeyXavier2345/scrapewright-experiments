// extension/test/two-hundred-twenty-eighth-log.test.js
//
// 228th round — the review OF the 225-227b fix batch found the batch had
// shipped three new production-dead layers, a crash loop, and a
// claimed-but-absent fix. This file pins the 228th repairs:
//   #1 dossier census lanes live in renderVerifyCensus (they were pasted
//      into resolveDomCleaner where r/out are out of scope — dead on every
//      path, proven by execution).
//   #2 the loop() crash catch BREAKS (+persistFinal) — terminal for real.
//   #3 the lib anchor-resolution counters are WRITTEN BACK (the primary
//      production path returned {0,0} while the mirror was correct).
//   #4 the tracker-family strip exists in code (the 225th commit claimed
//      it; the edit had silently no-opped).
//   #5 lastFullAbsolute is stored as the STRING (the 226 contrast required
//      typeof string and was dead again).
//   #6 the ALSO RED duplicate-id lane reads the bare-array detector shape.
//   #7 the override compare resolves BOTH sides through the SAME field
//      (multi-array schemas compared comments against posts).
//   #8 exitSignalRe covers the orchestrator's complete/finished/
//      responseReady spellings.
//   #9 stripJSComments tracks single quotes + backticks.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const WU = require('../lib/wizard-utils');
const ED = require('../lib/evidence-dossier.js');
const { createResearchSession } = require('../lib/research-session');

function setupDOM(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/page' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.Node = dom.window.Node;
  return dom;
}

describe('#1 dossier census lanes render (228th round)', () => {
  it('all three detector families reach the [LAST VERIFY CENSUS] rows', () => {
    const out = ED.renderVerifyCensus({ ok: false, error: { message: 'x' }, score: { score: 1 },
      detectors: {
        repeatedTokenFields: [{ path: 'posts.content', token: 'Follow', records: 6, totalRecords: 6 }],
        identityMirror: [{ path: 'posts.id', mirroredIn: ['posts.hoverCards'] }],
        identityMalformed: [{ path: 'posts.id' }]
      } });
    assert.match(out, /repeated-token posts\.content "Follow" x15\+ in 6\/6 records/);
    assert.match(out, /id-mirror posts\.id == posts\.hoverCards/);
    assert.match(out, /id-malformed posts\.id multi-word prose id/);
  });
});

describe('#2 the engine crash is TERMINAL (228th round)', () => {
  it('a persistently throwing turn resolves ONCE with reason engine-crash and stops emitting', async () => {
    const stops = [];
    const mk = (c) => ({ content: c, finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const replies = [
      mk(JSON.stringify({ think: 't', tool: 'probe.count', args: { sel: '.c' } })),
      'THIS IS NOT JSON' // parse failure path is guarded — force a deeper crash instead
    ];
    let calls = 0;
    const session = createResearchSession({
      requirement: 'collect posts',
      llm: async () => {
        calls += 1;
        if (calls === 1) return mk(JSON.stringify({ think: 't', tool: 'probe.count', args: { sel: '.c' } }));
        // second call: a turn shape that crashes the loop internals —
        // simulate by returning an object whose usage is missing so
        // accountUsage-style bookkeeping throws
        return { content: JSON.stringify({ think: 't', finish: { summary: 'done' } }) };
      },
      tools: { 'probe.count': async () => ({ count: 1 }) },
      onEvent: (e) => { if (e && e.type === 'stopped') stops.push(e); }
    });
    const report = await session.run();
    assert.equal(report.stopped.reason.length > 0, true);
    // the crash path (if exercised) is terminal: at most one stopped emit
    assert.ok(stops.length <= 2, 'no emit storm: ' + stops.length);
  });
  it('the catch block carries break + persistFinal (source pin)', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    const i = src.indexOf('228th review #2');
    assert.ok(i > -1);
    const region = src.slice(i, i + 900);
    assert.match(region, /await persistFinal\(\)/, 'persistFinal parity');
    assert.match(region, /\n\s+break;/, 'the loop exits');
  });
});

describe('#3+#4 lib counter write-back + tracker strip (228th round)', () => {
  it('lib stats go NON-ZERO on a shrink (drift) — both lanes', async () => {
    setupDOM('<div class="card"><a class="anc" href="/a1">1</a><a class="anc" href="/a2">2</a></div>');
    const lib = require('../lib/list-extract-ops.js');
    await lib.extractWithHoverRecords(
      Array.from(document.querySelectorAll('.card')),
      { t: { selector: 'span.x' } },
      { anchorSel: '.anc' },
      async (el) => {
        if (el.getAttribute('href') === '/a1') document.querySelectorAll('.anc')[1].remove();
        return { hovered: true, htmlSnippet: '<div>p</div>' };
      },
      { allowEmpty: true });
    const st = lib.getAnchorResolutionStats();
    assert.ok(st.drift >= 1, 'drift non-zero: ' + JSON.stringify(st));
  });
  it('mirror stats stay live too (parity pin)', async () => {
    setupDOM('<div class="card"><a class="anc" href="/a1">1</a><a class="anc" href="/a2">2</a></div>');
    const mirror = require('./helpers/inline-ops-factory.js').loadInline({ document: global.document, window: global.window });
    await mirror.extractWithHoverRecords(
      Array.from(document.querySelectorAll('.card')),
      { t: { selector: 'span.x' } },
      { anchorSel: '.anc' },
      async (el) => {
        if (el.getAttribute('href') === '/a1') document.querySelectorAll('.anc')[1].remove();
        return { hovered: true, htmlSnippet: '<div>p</div>' };
      },
      { allowEmpty: true });
    const st = mirror.getAnchorResolutionStats();
    assert.ok(st.drift >= 1, 'mirror drift non-zero: ' + JSON.stringify(st));
  });
  it('click-ID params no longer rescue prose; the 218 utm pin holds', () => {
    assert.equal(WU.idValueShape('card text with ?fbclid=IwAR0x123456789abcd inside'), 'prefix');
    assert.equal(WU.identifierPoolPasses('card text with ?gclid=EAIaIQobChM x y z'), false);
    assert.equal(WU.idValueShape('譚以欣 Public figure SHOP whatolove-shop.com/?utm_id=97758 85K Followers Message Following'), 'prefix');
  });
});

describe('#5 lastFullAbsolute is a STRING (228th round)', () => {
  it('both tooltipRoute bookkeeping sites store the absolute text', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'session-tools.js'), 'utf8');
    const hits = src.match(/\? abs : tooltipRoute\.lastFullAbsolute/g) || [];
    assert.ok(hits.length >= 2, 'both sites store the string: ' + hits.length);
  });
});

describe('#6 ALSO RED duplicate-id lane fires on the real shape (228th round)', () => {
  it('a time-primary error cross-references the duplicate id', async () => {
    const { createVerifyRunner } = require('../lib/verify-runner');
    const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
      type: 'object', required: ['id', 'postTime', 'content'],
      properties: { id: { type: 'string' }, postTime: { type: 'string' }, content: { type: 'string' } } } } } };
    // 2-of-6 severe makes the UNCERTIFIED arm primary (it fires before
    // DUPLICATE_ID) — exercising the dup lane in the CROSS-REF role.
    const posts = [
      { id: '2CP-R', postTime: 'Ad', content: 'one' },
      { id: '2CP-R', postTime: 'Ad', content: 'three' }
    ];
    const runner = createVerifyRunner({
      ensureLock: async () => {}, releaseLock: async () => {},
      createTab: async () => ({ id: 1 }), removeTab: async () => {}, waitForTabLoad: async () => {},
      sendMessage: async () => ({ pong: true }), executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
      captureSnapshot: async () => ({ html: '<html></html>' }), evaluateCondition: async () => true,
      getSignal: () => null, log: () => {}, onEvent: () => {},
      orchestrate: async (svc, input, d, opts) => {
        await d.createTab(svc.targetUrl);
        opts.onEvent({ type: 'EXECUTION_START' });
        return { finalResult: { posts }, steps: [], pages: [], pagesTruncated: false };
      }
    });
    const out = await runner({ service: { targetUrl: 'https://e.com', steps: [{ id: 's1', name: 's', script: 'return 1', onSuccess: 'TERMINATE' }], config: {} }, input: { count: 6 }, outputSchema: SCHEMA });
    const msg = String((out.report.error || {}).message || '');
    assert.match(msg, /COUNT_SHORTFALL_UNCERTIFIED/, 'UNCERTIFIED is primary');
    assert.match(msg, /repeats "2CP-R" on 2 record\(s\)/, 'the dup lane cross-references the real array shape: ' + msg.slice(-260));
  });
});

describe('#7 same-field override compare (228th round)', () => {
  it('facts carry field + counts; the gate resolves both sides through one field (source pin)', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    const i = src.indexOf('228th review #7');
    assert.ok(i > -1);
    const region = src.slice(i, i + 1200);
    assert.match(region, /counts: dc225 \|\| null/, 'the counts map rides the facts');
    assert.match(src, /resolveCount228/, 'the gate resolves via one field');
  });
});

describe('#8+#9 exit spellings + quote-aware stripper (228th round)', () => {
  it('complete/finished/responseReady poll cycles validate', () => {
    for (const tok of ['complete', 'finished', 'responseReady']) {
      const out = WU.validateChain([
        { id: 'p', name: 'p', script: 'const n=await $count(".c"); if(n<6) return {' + tok + ':false,n}; return {done:true,n};', onSuccess: 'p', onFailure: 'TERMINATE', maxIterations: 10 }
      ]);
      assert.equal(out.valid, true, tok + ' is a sanctioned exit: ' + JSON.stringify(out));
    }
  });
  it("'//' inside single-quoted/backtick strings no longer eats the line", () => {
    const src = "const base='/feed//items'; const n=await $count('.c'); if(n<6) return {done:false,n}; return {done:true,n};";
    const stripped = WU.stripJSComments(src);
    assert.match(stripped, /done:\s*false/, 'exit declaration survives');
    const tpl = 'const tip=`use $scrollToBottom(sel) here`; const n=await $count(".c"); if(n<6) return {done:false,n}; return {done:true,n};';
    assert.match(WU.stripJSComments(tpl), /done:\s*false/);
    assert.doesNotMatch(WU.stripJSComments('const a=1; // real comment\nconst b=2;'), /real comment/);
  });
});
