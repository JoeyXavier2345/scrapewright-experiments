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

Build 6 exposed a reproducible infrastructure boundary: generated relative detail links can defeat `$openTab` before selector quality is evaluated. The wizard's operationally green terminal display again did not imply semantic correctness. Because no compliant service was deployed, Build 6 supplies no zero-token runtime evidence.

