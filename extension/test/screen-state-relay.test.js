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
});
