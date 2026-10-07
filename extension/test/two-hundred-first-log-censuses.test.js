// extension/test/two-hundred-first-log-censuses.test.js
//
// 201st log (green session rs-1791370006196-1, result.json audit): the
// shipped result carried two requirement gaps that NO detector surfaced:
// (a) content fields ending "… See more" — the requirement family asks for
//     EXPANSION of the see-more affordance before extraction; the artifact
//     shipped truncated text undisclosed;
// (b) hovercards[] entries shipped as raw {link, htmlSnippet} while the
//     confirmed schema declared type/role/extras on the same items — the
//     popover went unparsed, and the finish summary claimed more than the
//     artifact delivered.
// Both censuses are report-only: they teach, they do not veto.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const WU = require('../lib/wizard-utils');

const SCHEMA = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          htmlSnippet: { type: 'string' },
          hovercards: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                link: { type: 'string' },
                htmlSnippet: { type: 'string' },
                type: { type: 'string' },
                role: { type: 'string' },
                extras: { type: 'object' }
              }
            }
          }
        }
      }
    }
  }
};

describe('detectSeeMoreUnexpanded (201st log)', () => {
  it('flags content-ish fields whose tail carries an unexpanded see-more affordance', () => {
    const data = { posts: [
      { content: 'Full text, nothing truncated' },
      { content: 'Mother and daughter go into the sea together! 40-year-old … See more' },
      { content: '前文内容…… 查看更多' },
      { content: 'tail with Show more' }
    ] };
    const r = WU.detectSeeMoreUnexpanded(data, SCHEMA);
    assert.ok(r, 'census fires');
    assert.equal(r.field, 'posts.content');
    assert.equal(r.affectedCount, 3);
    assert.deepEqual(r.samples.slice().sort(), [2, 3, 4]);
    assert.match(r.note, /\$click/i, 'note teaches the expansion exit');
  });

  it('clean content yields null', () => {
    const data = { posts: [{ content: 'plain full text' }, { content: 'another full text' }] };
    assert.equal(WU.detectSeeMoreUnexpanded(data, SCHEMA), null);
  });

  it('htmlSnippet fields are NOT flagged (the affordance button legitimately lives in markup)', () => {
    const data = { posts: [{ htmlSnippet: 'text <div role="button">See more</div>' }] };
    assert.equal(WU.detectSeeMoreUnexpanded(data, SCHEMA), null);
  });
});

describe('detectHovercardUnparsed (201st log)', () => {
  it('flags hovercard entries carrying raw html/link while schema-declared type/role/extras are ALL empty', () => {
    const data = { posts: [
      { hovercards: [{ link: 'https://example.com/a', htmlSnippet: '<div>popover</div>' }] },
      { hovercards: [{ link: 'https://example.com/b', htmlSnippet: '<div>popover2</div>', type: 'account', role: 'author' }] },
      { hovercards: [] }
    ] };
    const r = WU.detectHovercardUnparsed(data, SCHEMA);
    assert.ok(r, 'census fires');
    assert.equal(r.field, 'posts.hovercards');
    assert.equal(r.unparsedCount, 1);
    assert.equal(r.total, 2, 'entries with populated type/role do not count');
    assert.match(r.note, /type|role|extras/, 'note names the unparsed declared fields');
    assert.match(r.note, /skeletonSnippet/, 'note points at the parse aid');
  });

  it('no flag when the schema declares no parsing fields (the contract never promised them)', () => {
    const bareSchema = { type: 'object', properties: { posts: { type: 'array', items: { type: 'object', properties: {
      hovercards: { type: 'array', items: { type: 'object', properties: { link: { type: 'string' } } } }
    } } } } };
    const data = { posts: [{ hovercards: [{ link: 'https://example.com/a' }] }] };
    assert.equal(WU.detectHovercardUnparsed(data, bareSchema), null);
  });

  it('no flag when every populated entry is parsed', () => {
    const data = { posts: [{ hovercards: [{ link: 'x', type: 'account', role: 'author', extras: { followers: '51K' } }] }] };
    assert.equal(WU.detectHovercardUnparsed(data, SCHEMA), null);
  });
});
