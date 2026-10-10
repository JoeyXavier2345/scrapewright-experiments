// extension/test/two-hundred-twentieth-log.test.js
//
// 220th log (session rs-1791611731391-1, pre-219 build 218-idshape-prose —
// the user pointed this log at the five 219 fixes; verdicts below):
//   A. 215-round RAW SOURCE warning: production-validated (page.open q=AI
//      warned PLAIN TEXT, the model pivoted to user.observe within 48s
//      instead of probing a dead tab for 25 turns). No fix needed.
//   B. 216-round REPEATED_TOKEN_FIELD: TRUE positive on content ("•" ×15+
//      separator chrome — the veto worked), but THREE FALSE reds on
//      posts.htmlSnippet: raw outerHTML repeats CLASS/ATTRIBUTE tokens
//      ("xat24cr", 'dir="auto"', 'height="16"') ×15+ by construction. The
//      false veto burned four verifies and forced the model to strip
//      attributes out of a contract field that asks for raw markup.
//      Fix: markup-shaped values (containing tags) are not text — skip.
//   C. Percent-encoded template opens (`q=%7B%7Bkeyword%7D%7D?raw=1`) slip
//      past the unreplaced-template check (`/{{keyword}}/` literal form
//      only) — the model burned three opens before landing the literal
//      form that DID warn. Fix: match the %7B%7B..%7D%7D form too.
//
// The five 219 fixes had no contradicting signatures in this log (no
// $openTab calls, no nested named/unnamed pairs, no Playwright syntax, no
// textContent-hidden-span case exercised).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const WU = require('../lib/wizard-utils');
const { createLiveRail } = require('../lib/live-rail');

const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
  type: 'object', required: ['content', 'htmlSnippet'],
  properties: { content: { type: 'string' }, htmlSnippet: { type: 'string' } } } } } };

const MARKUP_A = '<div class="x1l90r2v x1iorvi4 xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr " dir="auto">card a</div>';
const MARKUP_B = '<div class="x1l90r2v x1iorvi4 xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr xat24cr " dir="auto">card b</div>';
const BULLET_JUNK = '• '.repeat(16).trim();
const BULLET_JUNK2 = '• '.repeat(18).trim();

describe('B. repeated-token detector skips markup-shaped values (220th log)', () => {
  it('htmlSnippet carrying repeated class tokens ×15 in 2 records draws NO entry (the 07:17 false red)', () => {
    const out = WU.detectRepeatedTokenFields({ posts: [
      { content: 'real content a', htmlSnippet: MARKUP_A },
      { content: 'real content b', htmlSnippet: MARKUP_B }
    ] }, SCHEMA);
    assert.equal(out.length, 0, 'markup values are structural, not junk text: ' + JSON.stringify(out));
  });
  it('the bullet-separator content TRUE positive still fires (the 07:14 case)', () => {
    const out = WU.detectRepeatedTokenFields({ posts: [
      { content: BULLET_JUNK, htmlSnippet: '' },
      { content: BULLET_JUNK2, htmlSnippet: '' }
    ] }, SCHEMA);
    assert.equal(out.length, 1);
    assert.equal(out[0].token, '•');
  });
  it('cross-record confirmation ignores markup values (one text-junk record alone never fires)', () => {
    const out = WU.detectRepeatedTokenFields({ posts: [
      { content: BULLET_JUNK, htmlSnippet: '' },
      { content: 'normal readable post content here', htmlSnippet: MARKUP_A }
    ] }, SCHEMA);
    assert.equal(out.length, 0);
  });
});

describe('C. percent-encoded template opens draw the unreplaced warning (220th log)', () => {
  function railDeps(bodyText) {
    return {
      defaultUrl: 'https://example.com/search?q=%7B%7Bkeyword%7D%7D',
      createTab: async (url) => ({ id: 7, url }),
      removeTab: async () => {},
      waitForTabLoad: async () => {},
      getTab: async (id) => ({ id, url: 'https://example.com/search', title: 'S', status: 'complete' }),
      pingReady: async () => true,
      execute: async (tabId, snippet) => ({ result: bodyText, snippet }),
      acquireLock: async () => {},
      releaseLock: async () => {},
      log: () => {}
    };
  }
  it('the %7B%7B..%7D%7D form warns exactly like the {{..}} form', async () => {
    const rail = createLiveRail(railDeps('Normal rendered body text that is long enough to look hydrated for the search results page content.'));
    const r = await rail.pageOpen({});
    assert.match(r.warning || '', /template parameter|placeholder/i, 'encoded template warned: ' + (r.warning || ''));
  });
  it('the literal {{keyword}} form keeps its warning (regression pin)', async () => {
    const d = railDeps('Normal rendered body text that is long enough to look hydrated for the search results page content.');
    d.defaultUrl = 'https://example.com/search?q={{keyword}}';
    const rail = createLiveRail(d);
    const r = await rail.pageOpen({});
    assert.match(r.warning || '', /template parameter|placeholder/i);
  });
});
