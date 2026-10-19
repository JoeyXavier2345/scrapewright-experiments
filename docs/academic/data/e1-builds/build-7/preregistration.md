# E1 Service A — Build 7 Preregistration

## Status

Build 7 preparation was preregistered before Phase 1 Research. The user confirmed that Build 7 had started, and the preserved Phase 1 screenshot shows active analysis at `2026-08-28T15:58:27+08:00`. This evidence-anchored timestamp is the official interactive start.

Preparation, automated tests, extension reload, tab refresh, and connectivity checks are preflight activity and are excluded from Build 7 wall time and token accounting.

## Experimental objective

Build 7 tests whether the post-Build 6 `$openTab` URL-normalization fix allows the frozen GitHub repository-search workflow to reach and inspect the first three repository detail pages without `CONTENT_SCRIPT_NOT_READY` caused by relative links.

The build also evaluates the complete preregistered semantic output. Removal of the Build 6 infrastructure error is necessary but is not sufficient for success.

## Controlled intervention

Build 7 changes exactly one intended runtime variable relative to Build 6: the unpacked extension includes commit `e84a2c5` (`fix: resolve relative open-tab URLs`).

The fix:

- preserves absolute HTTP(S) destinations;
- resolves root-relative and path-relative destinations against the authenticated parent tab URL;
- rejects missing or invalid parent context and non-HTTP(S) destinations with `INVALID_OPEN_TAB_URL`;
- prefers `sender.tab.id` over a message-provided parent tab identifier.

No generated selector, script, workflow step, test output, or Auto-Fix response may be manually edited during the build.

## Frozen configuration

| Parameter | Value |
|---|---|
| Service identifier | `e1-a-github-repository-search` |
| Initial URL | `https://github.com/search?q=web+scraping&type=repositories` |
| Test input | `query = "web scraping"` |
| Provider setting | OpenAI |
| Actual API service | Alibaba Cloud Model Studio |
| Model | `deepseek-v4-pro` |
| Per-request timeout | 300 seconds |
| Maximum output tokens | 16,384 |
| Browser | User's already-running authenticated Chrome session through Scrapewright |
| Data scope | Public repository data only |
| Account-changing actions | Prohibited |
| Intended runtime change from Build 6 | Relative `$openTab` URL normalization only |

The API key, account identity, and workspace-specific endpoint identifier must not be recorded in publishable artifacts.

## Frozen wizard input

Reuse all four Phase 1 fields from `../build-5/preregistration.md` under **Exact Phase 1 wizard input** verbatim and without character-level edits:

1. Target URL
2. Input parameters
3. Page operations and data to collect
4. Output structure

## Preflight gates

All gates must pass before the Research button is activated:

1. Verify the checked-out extension contains commit `e84a2c5` and no uncommitted extension changes.
2. Run the focused URL-normalization and background-wiring automated tests; record the command, pass count, fail count, and timestamp.
3. Reload the unpacked extension in Chrome.
4. Refresh the existing GitHub target tab after the extension reload so its content script is current.
5. Confirm native-host health on port 8765, extension connectivity, and an idle job queue.
6. Open a fresh wizard instance for Build 7; do not reuse a Build 6 wizard state.
7. Open the relevant DevTools consoles, enable Preserve log, show all levels, and clear preflight output.
8. Confirm provider/model, timeout, maximum output tokens, initial URL, and test input match the frozen configuration.
9. Confirm there is no CAPTCHA, login wall, abuse warning, or access restriction. If present, do not start.

Failure of any preflight gate blocks the official build start and must be recorded as preflight evidence, not as a Build 7 experimental failure.

## Execution procedure

1. Record the official start timestamp immediately when Phase 1 Research is activated.
2. Allow Research and generation to proceed without editing generated artifacts.
3. Capture Phase 1, generated steps/selectors, Phase 3 schemas and test input, Phase 4, and Phase 5 evidence when each becomes available.
4. During execution, preserve evidence showing the raw detail URL, parent tab URL, resolved absolute URL, opened tab destination, readiness result, and returned enrichment data.
5. If the first test fails, preserve the complete failure before invoking any repair.
6. Permit at most three user-invoked Auto-Fix rounds, matching the prior bounded procedure. Record each invocation and outcome separately. Automatic internal repair activity must also remain visible in the log.
7. Do not manually change selectors, scripts, iteration counts, schemas, inputs, or returned output between attempts.
8. Stop immediately on a read-only-boundary violation, CAPTCHA, access restriction, account-changing action, unexpected private-data exposure, or loss of evidence capture.
9. Save the complete unfiltered console log and screenshots before navigating away.
10. Record the terminal timestamp only after semantic assessment, not merely when the UI reports operational success.

## Primary infrastructure assertions

For each of the first three detail-page operations:

- a relative repository link must be resolved to the expected absolute HTTPS URL on `github.com`;
- the resolved URL must correspond to the selected search-result repository;
- the opened tab must load that destination and expose the Scrapewright content script;
- readiness polling must not terminate with `CONTENT_SCRIPT_NOT_READY` due to relative-URL handling;
- tab results must route through the authenticated sender/parent context;
- unsafe or non-HTTP(S) navigation must not occur.

If generated code never supplies a relative URL, the workflow may still be assessed semantically, but Build 7 does not exercise the targeted fix and cannot claim live validation of relative-URL normalization.

## Semantic decision rule

The build succeeds only if all of the following are true:

1. Exactly five repository records are returned in original displayed order.
2. Every record contains every declared key and no undeclared wrapper or extra result nesting.
3. Names, owners, descriptions, absolute repository URLs, displayed star counts, languages, and updated text are grounded in the permitted pages.
4. Records one through three contain detail-page-grounded `about`, `topics`, and `defaultBranch`. A genuinely absent field may use the frozen null/empty representation only when the page visibly lacks it after loading.
5. Records four and five contain `about: null`, `topics: []`, and `defaultBranch: null`, and their detail pages are not opened.
6. The returned query exactly equals `web scraping`.
7. No value is fabricated, substituted, inferred from prior knowledge, or silently omitted.
8. The workflow remains strictly read-only.

An operationally green wizard, disappearance of `CONTENT_SCRIPT_NOT_READY`, or successful URL normalization does not override failed semantic acceptance.

## Outcome classification

Classify the terminal result as exactly one of:

- **Pass:** targeted infrastructure behavior is exercised successfully, every semantic criterion passes, and the read-only boundary holds.
- **Semantic failure:** detail navigation operates, but returned data violates the semantic decision rule.
- **Infrastructure failure:** navigation, content-script readiness, routing, host connectivity, or execution prevents semantic evaluation.
- **Inconclusive:** the targeted relative-URL path is not exercised, evidence capture is incomplete, or an external restriction invalidates the run.
- **Safety stop:** a prohibited action or data boundary is reached or attempted.

Deployment is allowed only after a **Pass** classification. No other classification is eligible for deployment.

## Evidence and accounting requirements

- Save the full console export as `console.log` before analysis.
- Capture screenshots that establish configuration, generated workflow, relative and resolved URLs, each failure or repair state, final output, and semantic assessment.
- Record observations contemporaneously in `observations.md` and the final classification in `report.md`.
- Compute and record SHA-256 hashes for the console log and material screenshots.
- Record the official start and terminal timestamps with timezone and calculate wall time from those boundaries.
- Reconcile every LLM request against Alibaba Model Studio usage for the official window. Browser logs are supporting evidence, not the sole source when incomplete.
- Record missing token data as unavailable, never as zero and never as an invented estimate.
- Append one Build 7 row to `../../e1-tokens.csv` only after the report and accounting are complete.

## Stop conditions

Terminate without deployment when any of the following occurs:

- more than three user-invoked Auto-Fix rounds would be required;
- the frozen configuration or wizard input changes;
- evidence capture becomes incomplete or filtered;
- a CAPTCHA, abuse warning, login requirement, or access restriction appears;
- a prohibited account-changing action is attempted;
- the output cannot be assessed against the semantic rule;
- the workflow opens detail pages for results four or five;
- the workflow accesses private content or a non-permitted origin.
