// extension/test/two-hundred-eighteenth-log.test.js
//
// 218th log (session rs-1791598081229-1, 旅行): CAPTURED_VALUE_UNBOUND went
// red FOUR times on posts.id, each time claiming "the pipeline already
// captured a satisfying value" — and quoting a PAGE-CARD PROSE BLOB
// ("譚以欣Olivia Page · Public figure SHOP: … 85K Followers"). The full
// 188-char pool sample contains utm_id=97758: idValueShape's /\d{4,}/ rule
// matched the TRACKING TOKEN inside the prose, so the whole blob passed the
// identifier semantic. Binding posts.id from that blob would ship a utm
// token as the identity. Two stacked flaws:
//   1. idValueShape classifies PROSE as 'scoped' when any 4-digit run
//      hides inside it (and utm_* params — tracking, not identity —
//      trigger the id-param rule directly).
//   2. the veto message prints an 80-char HEAD slice of the passing
//      candidate, so even the token that passed was invisible — the model
//      fought four rounds against a "satisfying value" it could not see.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const WU = require('../lib/wizard-utils');
const { createVerifyRunner } = require('../lib/verify-runner');

const INCIDENT_BLOB = '譚以欣Olivia Page · Public figure SHOP: www.whatolove-shop.com BLOG: www.whatolove.com 工作邀約：oliviawawa@gmail.com whatolove-shop.com/?utm_id=97758_v0_s00_e0_tv0 85K Followers Message Following';

describe('A. idValueShape never classifies prose as scoped (218th log)', () => {
  it('the incident blob (prose containing utm_id=97758) is prefix, not scoped', () => {
    assert.equal(WU.idValueShape(INCIDENT_BLOB), 'prefix');
    assert.equal(WU.semanticPredicatePasses('identifier', INCIDENT_BLOB), false);
  });
  it('a bare tracking URL whose only id basis is a utm param is prefix', () => {
    assert.equal(WU.idValueShape('https://shop.example.com/promo?utm_id=97758&utm_source=feed'), 'prefix');
  });
  it('regression pins: real id shapes stay scoped, vanity paths stay prefix', () => {
    assert.equal(WU.idValueShape('https://example.com/posts/pfbid.abcdef123456x'), 'scoped');
    assert.equal(WU.idValueShape('https://example.com/profile.php?id=100077'), 'scoped');
    assert.equal(WU.idValueShape('1000771234'), 'scoped');
    assert.equal(WU.idValueShape('https://example.com/Evie.'), 'prefix');
    assert.equal(WU.idValueShape(''), 'empty');
  });
});

describe('B. the rescue message shows the passing token (218th log)', () => {
  const SCHEMA = { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: {
    type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } };
  function makeRunner(poolPopoverText) {
    const failingIds = ['https://example.com/Evie.', 'https://example.com/OtherAuthor.'];
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
        return {
          finalResult: { posts: failingIds.map((iv) => ({ id: iv })) },
          steps: [{ stepId: 'extract', stepName: 'extract', result: { recs: [
            { hovercards: [{ popoverText: poolPopoverText }] },
            { hovercards: [{ popoverText: poolPopoverText }] }
          ] } }],
          pages: [], pagesTruncated: false
        };
      }
    };
    return createVerifyRunner(deps);
  }
  const SERVICE = {
    targetUrl: 'https://example.com/search?q=x',
    steps: [{ id: 'extract', name: 'extract', script: 'return {};', onSuccess: 'TERMINATE' }],
    config: {}
  };
  it('an identifier rescue quotes the token that passed, not a head slice', async () => {
    const longToken = 'pfbid.' + 'a'.repeat(90);
    const poolText = 'Leading prose that runs well past eighty characters before the real identity link appears https://example.com/posts/' + longToken;
    const runner = makeRunner(poolText);
    const out = await runner({ service: SERVICE, input: { keyword: 'k', count: 2 }, outputSchema: SCHEMA });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /CAPTURED_VALUE_UNBOUND/);
    assert.ok(out.report.error.message.indexOf('a'.repeat(60)) !== -1,
      'the passing token is quoted in full — head-slice would have cut it: ' + out.report.error.message.slice(0, 260));
  });
  it('the incident shape no longer fires the rescue at all (prose pool cannot satisfy an identifier)', async () => {
    const runner = makeRunner(INCIDENT_BLOB);
    const out = await runner({ service: SERVICE, input: { keyword: 'k', count: 2 }, outputSchema: SCHEMA });
    assert.doesNotMatch(String((out.report.error && out.report.error.message) || ''), /CAPTURED_VALUE_UNBOUND: posts\.id/);
  });
});
