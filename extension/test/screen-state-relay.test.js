// 197th round (spec §1 relay + §4 keep-awake): the background owns the
// authoritative chrome.idle query and the chrome.power keep-awake hold.
// Source-audited (the SW itself is not unit-runnable).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BG = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));

describe('screen-state relay + keep-awake (source audit)', () => {
  it('manifest declares the idle permission', () => {
    assert.ok(MANIFEST.permissions.indexOf('idle') !== -1, 'permissions: ' + MANIFEST.permissions.join(','));
  });
  it('SW handles GET_SCREEN_STATE and answers with the detector shape', () => {
    assert.match(BG, /GET_SCREEN_STATE/);
    assert.match(BG, /getScreenState\(\)/);
    assert.match(BG, /sendResponse\(\{ state:/);
  });
  it('keep-awake acquire/release pair exists with the settings gate', () => {
    assert.match(BG, /requestKeepAwake\('display'\)/);
    assert.match(BG, /releaseKeepAwake\(\)/);
    assert.match(BG, /screenKeepAwakeEnabled/, 'settings-gated (default on)');
  });
  // 197th-round review #7: the refcount is mirrored into storage.session and
  // re-asserted at SW init — an MV3 suspend between acquire and release must
  // not resurrect the worker with refs=0 while a holder page still lives.
  it('keep-awake refcount persists to storage.session and restores at SW init', () => {
    assert.match(BG, /screenKeepAwakeRefs/);
    assert.match(BG, /__persistKeepAwakeRefs/);
    assert.match(BG, /chrome\.storage\.session\.set\(\{ screenKeepAwakeRefs/);
    assert.match(BG, /chrome\.storage\.session\.get\(\{ screenKeepAwakeRefs: 0 \}/);
  });
  // 197th-round review #9: the synthesis channel is LIVE in the SW — the
  // detector gets a synthesis closure fed from the TabActivation receipt
  // window (focus-loss density + dispatch wall over median), so an
  // unavailable chrome.idle API no longer collapses to unknown/none.
  it('the SW wires a live synthesis closure from activation outcomes', () => {
    assert.match(BG, /__screenSynthesisSignals/);
    assert.match(BG, /__recordScreenActivationOutcome/);
    assert.match(BG, /__screenActivationOutcomes/);
    assert.match(BG, /focusedFalseDensity: lost \/ outs\.length/);
    assert.match(BG, /synthesis: function/);
  });
});
