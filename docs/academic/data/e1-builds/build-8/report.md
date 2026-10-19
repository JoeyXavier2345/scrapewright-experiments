# E1 Service A — Build 8 Report

## Status

**Outcome: Infrastructure failure.** The run exercised the raw relative URL path, but the live browser opened the destination under the extension origin and failed content-script readiness. The semantic output also failed. No service was deployed.

The user reported that Research had begun at the boundary recorded as `2026-10-19T14:49:56+08:00`. The terminal failure was logged at `2026-10-19T15:02:38.066+08:00`. The observed window is 762.066 seconds, based on the user-confirmed start boundary; the exact click timestamp was not separately supplied.

## Design

Build 8 carried forward the Build 7 task and configuration and added one Phase 1 instruction requiring the generated script to pass the raw repository DOM `href` directly to `$openTab`, without rewriting it. The target was to verify that the checked-out `$openTab` URL resolver converts the relative path using the authenticated parent page URL.

## Observed execution

1. Research generated two steps, `extract-search-results` and `scrape-details-for-first-three`.
2. The first test opened the GitHub search page and extracted five results. The generated step retained each raw URL as `_rawUrl` while separately constructing the absolute result URL.
3. The first detail-step attempt failed with `Cannot read properties of undefined (reading '0')`. Scrapewright performed one automatic repair and retested.
4. The retest passed `/scrapy/scrapy` into the background `$openTab` handler with the search tab as parent context.
5. The raw console contains no `Resolved relative $openTab URL` event. The opened tab instead had a URL under the Scrapewright `chrome-extension://` origin, ending in `/scrapy/scrapy`.
6. The background reported `CONTENT_SCRIPT_NOT_READY`; the detail step returned `{failed:true,...}` and the wizard ended with no required `query` or `repositories` result.
7. No user-invoked Auto-Fix round was used after this failure, and nothing was deployed.

## Targeted infrastructure assessment

**Classification: Infrastructure failure.** The raw relative URL demonstrably reached the background handler, but the running browser did not resolve it to `https://github.com/scrapy/scrapy`. The extension-origin navigation and readiness failure show the targeted behavior did not operate in this session.

The checked-out source contains the resolver and logs a `Resolved relative $openTab URL` event when it changes a relative input. The saved live trace has no such event. The exact runtime cause is unconfirmed. The preflight record did not verify that Chrome had reloaded the unpacked extension from the checkout containing commit `e84a2c5`, so a stale or differently loaded extension is a plausible explanation, not a proven one. Build 8 does not live-validate the fix.

## Semantic assessment

| Criterion | Result |
|---|---|
| Five ordered search records | Step 1 returned records; full compliance not established |
| Raw relative href passed to `$openTab` | Pass; `/scrapy/scrapy` appears in the background start event |
| URL resolved to expected GitHub destination | Fail |
| Detail page content-script readiness | Fail: `CONTENT_SCRIPT_NOT_READY` |
| Required final output | Fail; final result is a failure object with `query` and `repositories` missing |
| Read-only boundary | No violation observed |
| Eligible for deployment | No |

## Token accounting

The local raw console contains three returned usage records totaling 55,617 prompt tokens, 21,590 completion tokens, and 77,207 total tokens (18,861 reasoning tokens and 15,360 cached prompt tokens). It contains only two recorded LLM request-URL lines, so these values are a measured lower bound and request-level reconciliation remains incomplete. Reconcile the official window against provider usage before appending a Build 8 row to `e1-tokens.csv`. Missing usage must not be treated as zero or estimated.

## Evidence

- Preregistration: `preregistration.md`
- Observations: `observations.md`
- Sanitized console: `console.log`, SHA-256 `47B23A2A8C77DFAEB47F85C214265F8CDB1E4FE9F33E8DA041D4F5C40969ABF4`
- Raw console is retained only in ignored local storage at `.tmp/build-8-private/console.raw.log`, SHA-256 `51F0048219CB4828AE19D49A80478C27688149EA50CB36DD01DF58D07D3EB78D`
- Phase screenshots: `phase1-research-start.png`, `research-tab-load-timeout.png`, `phase2-generated-steps.png`, `phase3-schema-test-input.png`, `phase4-initial-test.png`, `phase5-initial-failure.png`

## Bounded conclusion

Build 8 verified that the generated detail script passed the raw relative path `/scrapy/scrapy` to the background handler. In the running Chrome session, that path became an extension-origin URL instead of the GitHub destination and failed readiness. The preflight did not verify the loaded extension version, preventing attribution to the checked-out resolver code. The run is terminal and not deployable. A future live validation requires confirming Chrome is running the unpacked extension from the intended checkout before beginning a separately preregistered build.
