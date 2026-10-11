// extension/test/two-hundred-twenty-ninth-log.test.js
//
// 229th log (session rs-1791700696366-1, build 228, 31 min, 7 verifies,
// disclosed best-effort ship). The gates worked (SELECTOR_OVERFILTERED with
// differential, runtime '.' selector caught at verify, FAMILY_MISS with
// census, SUPPLY shortfall identity census, SHELL_ENTRIES 7/9) — the model
// correctly diagnosed the genuine supply ceiling (~2-4 organic posts per
// keyword page) and tried the sanctioned exit: lower the contracted count.
// The endgame dead-ended:
//   1. service.update({testInput:{keyword:'trip',count:2}}) → correctly
//      rejected TEST_INPUT_UNCONFIRMED (changing test values requires
//      re-confirmation — rule 9).
//   2. io.confirm re-proposal WITHOUT testInput → auto-confirmed as "same
//      contract, proceeding" — the receipt never named the exit: include
//      the NEW testInput in the re-confirmation call. The model shipped
//      disclosed instead, and the finish note had to say "TEST_INPUT
//      UNCONFIRMED blocked adoption".
//
// Fix: the same-contract auto-confirm receipt, when the call carried NO
// testInput and confirmed values exist, names the standing values and the
// renegotiation exit.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionTools } = require('../lib/session-tools');

const SCHEMAS = {
  inputSchema: { type: 'object', required: ['keyword', 'count'], properties: { keyword: { type: 'string' }, count: { type: 'number' } } },
  outputSchema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } }
};

function makeTools() {
  const confirmed = [];
  return {
    tools: createSessionTools({
      rail: { executeDsl: async () => ({}), pageState: async () => ({ open: true, tabId: 1, url: 'https://example.com/s?q={{keyword}}' }), ensureLock: async () => {}, releaseLock: async () => {}, dispose: async () => {}, tabId: 1 },
      runVerify: async () => ({ events: [], report: { ok: true, error: null, detectors: {} }, raw: {} }),
      getDraftService: () => null,
      applyArtifact: () => {},
      getTestInput: () => ({}), getOutputSchema: () => SCHEMAS.outputSchema, getSteps: () => [],
      ioConfirmBridge: { request: async (p) => { confirmed.push(p); return { confirmed: true, testInput: (p && p.testInput) || { keyword: 'trip', count: 6 } }; } },
      probeFactory: () => ({ snippet: async () => ({ result: 'ok' }) })
    }).tools,
    confirmed
  };
}

describe('229th round — the renegotiation dead-end is named', () => {
  it('a testInput-less re-proposal after confirmation names the standing values + the include-testInput exit', async () => {
    const { tools, confirmed } = makeTools();
    const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
    await tools['io.confirm'](Object.assign({ testInput: { keyword: 'trip', count: 6 } }, SCHEMAS), CTX);
    assert.equal(confirmed.length, 1, 'the first proposal prompts the user');
    const again = await tools['io.confirm'](Object.assign({}, SCHEMAS), CTX); // NO testInput
    assert.equal(again.confirmed, true);
    assert.match(again.note, /carried NO testInput/);
    assert.match(again.note, /"keyword":"trip","count":6/, 'names the standing confirmed values');
    assert.match(again.note, /send io\.confirm AGAIN WITH the new testInput/);
    assert.match(again.note, /lower count toward the observed page supply/);
  });
  it('a re-proposal WITH unchanged testInput keeps the plain same-contract note (regression pin)', async () => {
    const { tools } = makeTools();
    const CTX = { session: { state: () => ({ session: { artifactVersions: [] } }) } };
    await tools['io.confirm'](Object.assign({ testInput: { keyword: 'trip', count: 6 } }, SCHEMAS), CTX);
    const again = await tools['io.confirm'](Object.assign({ testInput: { keyword: 'trip', count: 6 } }, SCHEMAS), CTX);
    assert.equal(again.confirmed, true);
    assert.doesNotMatch(again.note, /carried NO testInput/, 'testInput present — no renegotiation note');
  });
});
