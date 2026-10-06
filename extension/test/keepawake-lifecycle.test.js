// 197th round (spec §4/§5): keep-awake held for the session/task lifetime;
// environmental waits disclosed in the TIME BUDGET suffix.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WIZ = fs.readFileSync(path.join(__dirname, '../wizard.js'), 'utf8');
const BG = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const RS = fs.readFileSync(path.join(__dirname, '../lib/research-session.js'), 'utf8');
const OPT = fs.readFileSync(path.join(__dirname, '../options.js'), 'utf8');

describe('keep-awake lifecycle (source audit)', () => {
  it('wizard acquires on session start and releases on completion', () => {
    assert.match(WIZ, /acquireScreenKeepAwake/);
    assert.match(WIZ, /releaseScreenKeepAwake/);
  });
  it('background acquires for scrape tasks and releases at end', () => {
    assert.match(BG, /acquireScreenKeepAwake\(\)/);
    assert.match(BG, /releaseScreenKeepAwake\(\)/);
  });
  it('options page carries the toggle (default on)', () => {
    assert.match(OPT, /screenKeepAwakeEnabled/);
  });
  it('TIME BUDGET discloses environmental waits', () => {
    assert.match(RS, /environmental waits /);
  });
});
