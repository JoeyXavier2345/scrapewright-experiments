# E1 Service A — Build 8 Preregistration

## Status

Prepared after Build 7 reached its terminal state. **Terminal — Infrastructure failure.** The user-reported start boundary was `2026-10-19T14:49:56+08:00`; the exact click time was not supplied. The run ended at `2026-10-19T15:02:38.066+08:00`. See `report.md` and `observations.md`. Token usage still requires provider reconciliation.

Build 7 is immutable and terminal. This is a new run, not a retry or repair of Build 7.

## Objective

Exercise the relative-URL normalization boundary added in commit `e84a2c5` using the same public GitHub search workflow. Build 7 did not test that boundary because generated code converted every repository href to an absolute URL before `$openTab` received it.

## Single planned intervention

Compared with Build 7, add one explicit instruction to the Phase 1 operations field: when opening each of the first three repository pages, pass the repository link's raw DOM `href` directly to `$openTab`; do not resolve, concatenate, prefix, or otherwise rewrite the href in generated code. The background URL resolver must perform the normalization. Do not hand-edit generated scripts or any other wizard artifact.

Add this sentence verbatim to the Phase 1 **Page operations and data to collect** field, immediately after the instruction to open only the first three repository detail pages:

> When opening those first three repository pages, pass each repository link's raw DOM href directly to `$openTab`. Do not resolve, concatenate, prefix, or otherwise rewrite the href before calling `$openTab`. The background URL resolver must perform the normalization.

This changes one prompt instruction to make the targeted runtime boundary observable. It is not a controlled replication of Build 7's exact prompt. Record the wording exactly as entered and treat any other configuration difference as a protocol deviation.

## Frozen configuration

Carry forward Build 7 values only after confirming each during preflight:

| Parameter | Frozen value |
|---|---|
| Service identifier | `e1-a-github-repository-search` |
| Initial URL | `https://github.com/search?q=web+scraping&type=repositories` |
| Test input | `query = "web scraping"` |
| Provider/model/endpoint | Same as Build 7; verify in UI; do not record secret endpoint identifiers or keys |
| Request timeout | 300 seconds |
| Maximum output tokens | 16,384 |
| Browser | User's already-running authenticated Chrome session through Scrapewright |
| Data scope | Public GitHub repository data only |
| Account-changing actions | Prohibited |
| Repair bound | At most three user-invoked Auto-Fix rounds |

Reuse the exact Build 5 input/output schemas and task text, with only the single raw-href instruction above added. Keep all other inputs unchanged. Do not deploy during this validation run.

## Preflight gates

Before activating Research:

1. Confirm the checked-out extension includes `e84a2c5` and the working extension code is unchanged from the version under evaluation.
2. Run and record the focused URL-resolver/background-wiring regression checks and their result. This is preflight, not experimental evidence.
3. Reload the unpacked extension in Chrome and refresh the GitHub target tab.
4. Confirm native-host health on port 8765, extension connectivity, and an idle job queue.
5. Open a fresh wizard; do not reuse Build 7 state.
6. Verify provider/model, endpoint configuration, timeout, output budget, target URL, test input, and all frozen task text. Do not capture or publish secrets.
7. Configure DevTools to show all levels, clear filters, enable Preserve log, and confirm evidence capture is working.
8. Confirm no CAPTCHA, login wall, abuse warning, or access restriction is present. If any appears, do not start.

If any gate fails, record a preflight stop; do not count it as a Build 8 run.

## Execution and evidence

1. At Research activation, record the local timestamp with timezone and capture the visible start state.
2. Do not edit generated scripts, selectors, schemas, inputs, iteration limits, or outputs. Allow automatic repairs and at most three user-invoked Auto-Fix rounds; record each separately.
3. For each of the first three detail operations, capture the raw DOM href, the `$openTab` argument at the background boundary, parent tab URL, resolved HTTPS URL, opened destination, content-script readiness, and returned data. Establish that the input reaching the resolver is actually relative.
4. Stop on any read-only-boundary violation, CAPTCHA/access restriction, prohibited action, private-data exposure, or loss of complete evidence capture. Never open detail pages for results four or five.
5. Export the complete unfiltered console before navigating away. Sanitize workspace-specific endpoint identifiers in the publishable copy; keep any raw sensitive export local and ignored.
6. Record observations contemporaneously. Hash the console and material screenshots. Record the terminal timestamp after semantic assessment.
7. Reconcile all LLM requests against provider usage for the official window. Missing usage is unavailable, never zero or estimated.
8. Add a Build 8 token row only after the report and accounting are complete.

## Decision rules

**Primary targeted outcome: Pass** only if a raw relative href reaches the resolver, resolves to the expected HTTPS GitHub repository URL using the authenticated parent context, opens that destination, and exposes the content script without `CONTENT_SCRIPT_NOT_READY`, unsafe navigation, or incorrect result routing.

Classify the targeted outcome as **Inconclusive** if generated code rewrites the href before the resolver, evidence is incomplete, or an external restriction prevents assessment. Classify **Infrastructure failure** if the relative input reaches the resolver but navigation/readiness/routing fails. Any prohibited action is a **Safety stop**.

Separately report semantic output against the Build 7 frozen rule: exactly five ordered records, all declared keys, grounded first-three `about`/`topics`/`defaultBranch`, null/empty enrichment for records four and five without opening their pages, exact query, and no fabricated values. A targeted infrastructure pass does not imply semantic success. No outcome other than semantic success is eligible for deployment; deployment is outside this run in all cases.

## Stop conditions

Stop without deployment if more than three user-invoked repairs would be needed; frozen settings or task text change beyond the one planned instruction; evidence is incomplete; an access restriction appears; a prohibited action is attempted; semantic assessment is impossible; or any of results four or five is opened.
