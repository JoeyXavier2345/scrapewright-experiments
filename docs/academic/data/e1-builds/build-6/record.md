# Build 6 Engineering Fix Record

## Scope

This record tracks the post-experiment fix initiated after Build 6 terminated. It is engineering activity derived from Build 6 evidence, not part of the frozen Build 6 experimental run and not a retroactive repair of its outcome.

## Triggering evidence

- Generated detail URL: `/scrapy/scrapy`
- Runtime error: `CONTENT_SCRIPT_NOT_READY`
- Console trace: `console.log`, SHA-256 `CA1F8B60F8B07CBC7F3D44AB5365C5E4B5474EF876E5A91E228EDB34FE5F0C63`
- Source trace: `$openTab` forwarded its URL unchanged through `sandbox.js` → `content-script.js` → `background.js`.

## Root cause

Generated scripts may receive relative `href` values from the target DOM. `background.js:handleOpenTabExecute` previously passed those values directly to `createScrapeTab`. A relative URL could consequently resolve outside the parent page's HTTP(S) origin, producing a tab where Scrapewright's content script was unavailable. Readiness polling then surfaced the secondary symptom `CONTENT_SCRIPT_NOT_READY`.

## Fix started

1. Added `extension/lib/open-tab-url.js`, a shared pure URL-normalization helper.
2. Absolute HTTP(S) destinations are preserved.
3. Root-relative and path-relative destinations are resolved against the actual parent tab URL.
4. Missing parent context for a relative URL, invalid parent URLs, and non-HTTP(S) destinations fail explicitly with `INVALID_OPEN_TAB_URL`.
5. `background.js` now reads the parent tab URL, resolves the destination, logs normalization, and only then calls `createScrapeTab`.
6. Added `extension/test/open-tab-url.test.js` covering absolute, root-relative, path-relative, missing-parent, and unsafe-protocol cases plus background wiring/order.
7. Hardened the `OPEN_TAB_EXECUTE` listener to prefer the browser-authenticated `sender.tab.id` over a message-provided parent ID for both URL resolution and result routing.

## Verification progress

- Syntax checks passed for `extension/lib/open-tab-url.js` and `extension/background.js`.
- Initial focused regression suite: 130 passed, 0 failed. It covered URL normalization, background wiring, page tracking, scrape-tab lifecycle, tab activation, and step orchestration.
- Final post-hardening regression suite: 99 passed, 0 failed. It additionally verified service-worker import loading, diagnostic message relays, and authenticated sender-tab routing after the final background-listener change.

## Current status

The code fix and automated regression coverage are complete. No live Build 7 claim is made: Chrome must reload the modified unpacked extension, and the same workflow must be evaluated under a separately preregistered Build 7 to establish real-browser effectiveness.

## Experimental integrity

Build 6 remains failed and non-deployed. Any validation using this fix must occur in a separately preregistered Build 7 after the code is tested, committed, loaded into Chrome, and the environment is re-frozen.
