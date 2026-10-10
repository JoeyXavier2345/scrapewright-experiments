// extension/test/two-hundred-sixteenth-log.test.js
//
// 216th log (session rs-1791556272583-1, 旅行 — GREEN finish with honest
// disclosures, then the deployed run exposed what the green could not see):
// the required content field shipped "Facebook" ×44 in BOTH verify records
// (a container-level brand/link-label string the binding aggregated), and
// postId mirrored the author PAGE url — identical to hoverCards[0].url in
// both records (entity-scoped identity: two posts by one author would
// collide). The verify passed GREEN: no detector owns repeated-token
// content, and no detector names an id that mirrors a shipped URL.
//
// Environmental items checked and healthy this round (no fixes): the
// llm:error "Failed to fetch" stop after 11 attempts was a real provider
// outage (user resumed via fresh engine — by design), and user.observe made
// its production round trip (the user answered, the model re-scoped the
// population).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const WU = require('../lib/wizard-utils');
const { createVerifyRunner } = require('../lib/verify-runner');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = {
  type: 'object', required: ['posts'],
  properties: { posts: { type: 'array', items: {
    type: 'object', required: ['content', 'hoverCards'],
    properties: {
      postId: { type: 'string' },
      content: { type: 'string' },
      hoverCards: { type: 'array', items: { type: 'object' } }
    }
  } } }
};

const JUNK = 'Facebook ' + 'Facebook '.repeat(43).trim() + ' t 1 m';
const JUNK2 = 'Facebook ' + 'Facebook '.repeat(39).trim() + ' k 9 z q';

const INCIDENT_POSTS = [
  { postId: 'https://example.com/siaosparrow', content: JUNK, hoverCards: [{ url: 'https://example.com/siaosparrow', name: '小麻雀', type: 'page', htmlSnippet: '<div class="page-card">Page card with a verified badge and follower count plus category label</div>' }] },
  { postId: 'https://example.com/euroleeguide', content: JUNK2, hoverCards: [{ url: 'https://example.com/euroleeguide', name: '欧洲李导', type: 'page', htmlSnippet: '<div class="page-card">Second page card with a verified badge and follower count plus category label</div>' }] }
];

describe('A. detectRepeatedTokenFields (216th log)', () => {
  it('the incident shape (same token ×44 across records) yields an entry naming the token', () => {
    const out = WU.detectRepeatedTokenFields({ posts: INCIDENT_POSTS }, SCHEMA);
    assert.equal(out.length, 1);
    assert.equal(out[0].token, 'Facebook');
    assert.match(out[0].path, /posts\.content/);
    assert.match(out[0].note, /container-level|brand|link-label/i);
  });
  it('organic varied content stays silent', () => {
    const posts = [
      { content: 'Great road trip through the southwest with stops at every canyon', hoverCards: [] },
      { content: '欧洲五日游攻略分享，包含交通与住宿建议', hoverCards: [] }
    ];
    assert.equal(WU.detectRepeatedTokenFields({ posts }, SCHEMA).length, 0);
  });
  it('a single junk record does not fire (cross-record confirmation is the false-positive shield)', () => {
    const posts = [
      { content: JUNK, hoverCards: [] },
      { content: 'Normal post content about travel and food', hoverCards: [] }
    ];
    assert.equal(WU.detectRepeatedTokenFields({ posts }, SCHEMA).length, 0);
  });
});

describe('B. detectIdentityMirror (216th log)', () => {
  it('postId equal to hoverCards[].url yields the entity-scoped advisory', () => {
    const out = WU.detectIdentityMirror({ posts: INCIDENT_POSTS }, SCHEMA);
    assert.equal(out.length, 1);
    assert.match(out[0].path, /posts\.postId/);
    assert.match(out[0].note, /entity-scoped|author/i);
    assert.match(String(out[0].mirroredIn), /hoverCards/);
  });
  it('a post-scoped permalink that also appears as a hover target stays silent (legit same-scope mirror)', () => {
    const posts = [
      { postId: 'https://example.com/posts/111', content: 'a', hoverCards: [{ url: 'https://example.com/author1' }] },
      { postId: 'https://example.com/posts/222', content: 'b', hoverCards: [{ url: 'https://example.com/author2' }] }
    ];
    assert.equal(WU.detectIdentityMirror({ posts }, SCHEMA).length, 0);
  });
});

// ---------- verify-runner integration ----------

function makeRunner(finalPosts) {
  const deps = {
    ensureLock: async () => {},
    releaseLock: async () => {},
    createTab: async () => ({ id: 1 }),
    removeTab: async () => {},
    waitForTabLoad: async () => {},
    sendMessage: async () => ({ pong: true }),
    executeScript: async () => ({ result: 'ok', selectorDiagnostics: [] }),
    captureSnapshot: async () => ({ html: '<html></html>' }),
    evaluateCondition: async () => true,
    orchestrate: async (svc, input, d, opts) => {
      await d.createTab(svc.targetUrl);
      opts.onEvent({ type: 'EXECUTION_START' });
      opts.onEvent({ type: 'STEP_ITERATION', stepId: 's4', iteration: 1, resultPreview: '{"done":true}' });
      return { finalResult: { posts: finalPosts }, steps: [], pages: [], pagesTruncated: false };
    }
  };
  return createVerifyRunner(deps);
}

const SERVICE = {
  targetUrl: 'https://example.com/search?q=x',
  steps: [
    { id: 's1', name: 'settle', script: 'await $waitForStable("div");', onSuccess: 's4' },
    { id: 's4', name: 'shape', script: 'return {posts: []};', onSuccess: 'TERMINATE' }
  ],
  config: {}
};

describe('C. verify integration (216th log)', () => {
  it('REQUIRED repeated-token content vetoes the run RED', async () => {
    const runner = makeRunner(INCIDENT_POSTS);
    const out = await runner({ service: SERVICE, input: { keyword: 'k', count: 2 }, outputSchema: SCHEMA });
    assert.equal(out.report.ok, false);
    assert.match(out.report.error.message, /REPEATED_TOKEN_FIELD/);
    assert.match(out.report.error.message, /Facebook/);
    assert.match(out.report.error.message, /posts\.content/);
  });
  it('OPTIONAL repeated-token stays green with the report-only census attached', async () => {
    const schemaOpt = JSON.parse(JSON.stringify(SCHEMA));
    schemaOpt.properties.posts.items.required = ['hoverCards'];
    const runner = makeRunner(INCIDENT_POSTS);
    const out = await runner({ service: SERVICE, input: { keyword: 'k', count: 2 }, outputSchema: schemaOpt });
    assert.equal(out.report.ok, true);
    assert.ok(Array.isArray(out.report.detectors.repeatedTokenFields) && out.report.detectors.repeatedTokenFields.length === 1);
  });
  it('the identity mirror rides the report without vetoing (postId is optional here)', async () => {
    const cleanPosts = INCIDENT_POSTS.map((p) => Object.assign({}, p, { content: 'real content about ' + p.hoverCards[0].name }));
    const runner = makeRunner(cleanPosts);
    const out = await runner({ service: SERVICE, input: { keyword: 'k', count: 2 }, outputSchema: SCHEMA });
    assert.equal(out.report.ok, true);
    assert.ok(Array.isArray(out.report.detectors.identityMirror) && out.report.detectors.identityMirror.length === 1);
  });
  it('the finish-disclosure lane unions repeated-token fields into JUNK-VALUES (source pin)', () => {
    const rs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'research-session.js'), 'utf8');
    const i = rs.indexOf('lastVerifyJunkFields = (jfList.length');
    assert.ok(i > -1, 'the union assignment exists');
    const region = rs.slice(i - 400, i + 900);
    assert.match(region, /repeatedTokenFields/, 'repeated-token fields join the junk finish lane');
  });
});
