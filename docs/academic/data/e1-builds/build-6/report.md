# E1 Service A — Build 6 Report

## Status

**Outcome:** Failed controlled replication, retained as first-class experimental evidence.

Build 6 began at `2026-08-27T14:44:26.459+08:00` and was assessed terminal at `2026-08-27T15:29:26.236+08:00`. The interactive window was 2,699.777 seconds (44.996 minutes). The service was not deployed.

## Design and configuration

Build 6 replicated Build 5's strengthened four-field Phase 1 input, semantic decision rule, model, endpoint, test input, 300-second LLM request timeout, and 16,384-token completion budget. Commit `4ddaf08` made those effective values the implementation defaults but did not change them relative to Build 5.

The task remained strictly read-only and limited to public GitHub repository data in an existing authenticated Chrome session.

## Preflight event

After the unpacked extension was reloaded, the first Phase 1 snapshot attempt failed because an already-open GitHub tab had no listener from the reloaded content script. The target tab was refreshed before the official start. No LLM request was observed during this preflight event, which is recorded separately rather than counted as the Build 6 start.

## Observed path

1. Research completed and generated two steps: `Extract search results` and `Enrich detail pages` (`max 3`).
2. Phase 3 contained the expected test input and generated schemas; no manual edits were reported.
3. The search-results step extracted plausible list data, including correct repository descriptions and absolute output URLs.
4. The enrichment step passed a relative detail URL such as `/scrapy/scrapy` into `$openTab`.
5. Scrapewright forwarded the relative value unchanged through sandbox, content script, and background layers. The opened sub-tab never exposed a Scrapewright listener, readiness polling exhausted, and `CONTENT_SCRIPT_NOT_READY` propagated through the offscreen executor and orchestrator.
6. The wizard automatically entered Auto-Fix. One repaired attempt exhausted three polling iterations with `POLL_EXHAUSTED`; a later repair used four iterations and eventually displayed `All steps passed`.
7. The final output remained semantically invalid: visible first-three enrichment included `about: null` and empty/unverified detail fields. The artifact therefore failed the preregistered criterion and was not deployed.

## Root-cause finding

This was not caused by the new LLM timeout or completion-budget defaults. The `$openTab` infrastructure accepts a URL but does not resolve a relative value against the parent target page before calling `chrome.tabs.create`. Readiness retries only ping; they do not correct the destination or reinject a missing content script. The log's `detailUrlPreview: "/scrapy/scrapy"` and subsequent `CONTENT_SCRIPT_NOT_READY` establish this path directly.

## Post-Build 6 `$openTab` URL fix

This engineering change was initiated only after Build 6 had terminated. It is a response to Build 6 evidence, not part of the frozen Build 6 run and not a retroactive change to its failed outcome.

### Reason for the change

GitHub search results supplied root-relative repository links such as `/scrapy/scrapy`. Generated workflows are allowed to pass DOM-derived link values to `$openTab`, but the background handler previously forwarded those values directly to tab creation. Without the parent page's origin, a relative link could open the wrong destination or a page without Scrapewright's content script. Readiness polling then reported the secondary `CONTENT_SCRIPT_NOT_READY` symptom instead of correcting or clearly rejecting the URL.

### Implemented change

Commit `e84a2c5` (`fix: resolve relative open-tab URLs`) added a shared URL-normalization boundary before tab creation:

- absolute HTTP(S) URLs are preserved;
- root-relative and path-relative URLs are resolved against the authenticated parent tab URL;
- relative URLs without valid parent context and non-HTTP(S) destinations fail with `INVALID_OPEN_TAB_URL`;
- the browser-authenticated `sender.tab.id` is preferred over a message-provided parent identifier for URL context and result routing;
- focused tests cover absolute, relative, missing-parent, invalid-parent, unsafe-protocol, wiring, and routing behavior.

### Engineering outcome

The implementation and its focused automated regression tests passed before Build 7. The change therefore had a positive unit/integration-level engineering outcome: the resolver behaved as designed in the tested cases and the background handler invoked it before opening a tab.

The live-browser outcome remained unresolved after Build 7. Build 7 recorded 11 successful detail-tab readiness events and no recurrence of `CONTENT_SCRIPT_NOT_READY`, but its generated scripts converted relative links to absolute GitHub URLs before calling `$openTab`. The new relative-URL branch consequently received zero relative inputs and was not exercised. The fix is **automated-test verified but not live-workflow validated** by Builds 6 or 7.

## Acceptance results

| Criterion | Result |
|---|---|
| Research and step generation | Pass |
| Search-list extraction | Operational pass |
| First-three detail enrichment | Fail |
| Grounded `about` | Fail (`null` visibly returned) |
| Grounded `topics` and `defaultBranch` | Not demonstrated |
| Every declared key semantically valid | Fail |
| Read-only boundary | No violation observed |
| Eligible for deployment | No |

## Token accounting

The saved console log contains zero LLM request or usage records because the DevTools export included only the enabled custom log levels. Consequently, Build 6 `tokens_in` and `tokens_out` are **unavailable**, not zero. They must be reconciled from Alibaba Model Studio usage for the Build 6 time window. No estimate is fabricated.

## Evidence

- Preregistration: `e1-builds/build-6/preregistration.md`
- Observations: `e1-builds/build-6/observations.md`
- Console log: `e1-builds/build-6/console.log`
- Console SHA-256: `CA1F8B60F8B07CBC7F3D44AB5365C5E4B5474EF876E5A91E228EDB34FE5F0C63`
- Phase and failure screenshots: `e1-builds/build-6/*.png`

## Bounded conclusion

Build 6 exposed a reproducible infrastructure boundary: generated relative detail links can defeat `$openTab` before selector quality is evaluated. The resulting fix passed focused automated verification, but Build 7 bypassed its relative-input path and therefore did not establish a live result. The wizard's operationally green terminal display again did not imply semantic correctness. Because no compliant service was deployed, Build 6 supplies no zero-token runtime evidence.
