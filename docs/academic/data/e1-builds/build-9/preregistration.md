# E1 Service A — Build 9 Preregistration

## Status

Prepared after terminal Build 8. **Terminal — protocol deviation and semantic failure; targeted resolver behavior observed to pass.** The user-reported start boundary was `2026-10-19T15:25:27+08:00`; terminal assessment was recorded at `2026-10-19T17:43:42+08:00`. See `report.md` and `observations.md`. All nine request/usage pairs reconcile in the saved console; token totals are recorded in the report and aggregate CSV.

Build 8 remains terminal and unchanged in outcome. Build 9 is a new run, not a retry or repair of Build 8.

## Objective

Determine whether the URL-normalization helper works in the live workflow when Chrome is confirmed to run the unpacked extension from this checkout with commit `e84a2c5`.

Build 8's console showed the raw relative URL `/scrapy/scrapy` entering the background handler, followed by an extension-origin tab and `CONTENT_SCRIPT_NOT_READY`. After Build 8, the user confirmed that `OpenTabUrl.resolveOpenTabUrl` returns the expected GitHub URL in the Service Worker console. The precise Build 8 runtime extension path/version remains unverified.

## Controlled configuration

Repeat Build 8's task, prompt, schemas, model/provider, test input, timeout, output-token budget, repair limit, and read-only boundary without edits. Use the exact Build 8 Page 1 input and its single added raw-href instruction verbatim. Do not manually modify generated code, selectors, step limits, schemas, or output.

The intended operational condition is that Chrome has freshly loaded this checkout's `extension/` directory after verifying the code contains commit `e84a2c5`. This is a preflight condition, not a Phase 1 prompt change. No code edits are planned.

| Parameter | Frozen value |
|---|---|
| Service identifier | `e1-a-github-repository-search` |
| Initial URL | `https://github.com/search?q=web+scraping&type=repositories` |
| Test input | `query = "web scraping"` |
| Provider/model/endpoint | Same as Build 8; verify in UI; never record key or workspace-specific endpoint identifier |
| Request timeout | 300 seconds |
| Maximum output tokens | 16,384 |
| Browser/data boundary | Existing authenticated Chrome session; public GitHub repository data only |
| Account-changing actions | Prohibited |
| User-invoked Auto-Fix limit | At most three |
| Deployment | Prohibited during this validation run |

## Preflight gates

Do not activate Research until every gate passes:

1. Verify the unpacked extension's **Loaded from** path is exactly this repository's `extension/` directory, and the source contains commit `e84a2c5` with no uncommitted extension-code changes.
2. Reload that extension in `chrome://extensions`, then refresh the GitHub search tab.
3. Open the Scrapewright **Service Worker** DevTools console (not the Options-page console) and evaluate:

   ```js
   OpenTabUrl.resolveOpenTabUrl('/scrapy/scrapy', 'https://github.com/search?q=web+scraping&type=repositories')
   ```

   The result must be `https://github.com/scrapy/scrapy`. Save a screenshot showing the Service Worker context, expression, and result. If `OpenTabUrl` is undefined or the result differs, stop and repair preflight; do not start Build 9.
4. Confirm host health on port 8765, extension connectivity, and an idle queue.
5. Open a fresh wizard and verify the frozen settings and exact Build 8 Phase 1 input. Enable Preserve log, select all console levels, clear filters, and confirm the log is recording.
6. Confirm the GitHub page loads without a CAPTCHA, login wall, abuse warning, or access restriction.

Record failed gates as preflight evidence; they are not Build 9 experimental failures.

## Execution and evidence

1. Record local timestamp and screenshot at Research activation.
2. Capture each wizard phase and the complete unfiltered console. During detail navigation, establish the raw `_rawUrl`, background `handleOpenTabExecute` input, authenticated parent URL, `Resolved relative $openTab URL` event, absolute tab destination, content-script readiness, and returned detail data.
3. Open only detail pages for results one through three. Stop if results four or five are opened or if any safety/access boundary is reached.
4. Preserve the initial test failure before any user-invoked Auto-Fix. Permit automatic repair and up to three user-invoked rounds; record each separately. Do not deploy.
5. Save the complete raw console only under ignored local storage (for example `.tmp/build-9-private/console.raw.log`). Redact workspace endpoint identifiers in the publishable console and screenshots.
6. Hash the console and material screenshots. Record terminal time after semantic assessment.
7. Reconcile every LLM request with provider usage. Missing usage is unavailable, not zero or estimated. Add a token CSV row only after the report and accounting are complete.

## Decision rules

**Targeted Pass:** a raw relative href reaches the background handler, resolves against the authenticated GitHub parent URL to the correct HTTPS repository URL, opens there, and reaches content-script readiness without an unsafe destination or routing error.

**Infrastructure failure:** the relative input reaches the handler but is not resolved correctly, the destination/readiness/routing fails, or the verified helper fails in the live run.

**Inconclusive:** generated code rewrites the link before the background boundary, required evidence is incomplete, or an external access restriction prevents assessment.

Separately assess semantic output against Build 8's frozen rule. A targeted infrastructure pass does not imply semantic success. No result from this validation run is eligible for deployment.

## Stop conditions

Stop without deployment if a preflight gate fails, the frozen configuration changes, more than three user-invoked repairs would be needed, evidence capture becomes incomplete, an access restriction appears, a prohibited action is attempted, or results four/five are opened.
