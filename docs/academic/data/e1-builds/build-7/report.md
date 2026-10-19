# E1 Service A — Build 7 Report

## Status

**Outcome:** Inconclusive targeted validation with confirmed semantic failure. Retained as first-class experimental evidence; not deployed.

Build 7 began at `2026-08-28T15:58:27+08:00` and reached its terminal result at `2026-08-28T17:04:05+08:00`. The official interactive window was 3,938 seconds (65 minutes 38 seconds).

## Design

Build 7 was preregistered to change one intended runtime variable relative to Build 6: commit `e84a2c5`, which resolves relative `$openTab` destinations against the authenticated parent tab URL. The Build 5 task specification, model, endpoint, test input, 300-second request timeout, 16,384-token output budget, read-only boundary, and semantic decision rule remained frozen.

The run permitted at most three user-invoked Auto-Fix rounds and prohibited deployment unless every semantic criterion passed.

## Observed path

1. Research generated two steps: `Extract search results` and `Enrich detail pages`.
2. The initial Step 1 execution returned five plausible GitHub search records, including root-relative repository URLs such as `/scrapy/scrapy`.
3. Initial Step 2 execution failed before detail navigation with `Unexpected end of input`.
4. Automatic repair produced executable enrichment code. That code manually prefixed non-absolute URLs with `https://github.com` before calling `$openTab`.
5. Across subsequent attempts, the console recorded 11 detail-tab starts and 11 successful content-script readiness events. No `CONTENT_SCRIPT_NOT_READY` or `INVALID_OPEN_TAB_URL` occurred.
6. The wizard initially reported `All steps passed!`, but the returned records omitted `about`, `topics`, and `defaultBranch`. Repeated enrichment iterations returned `done: false` and still terminated operationally.
7. User-invoked Auto-Fix round 1 ended with an explicit test failure but did not produce the required fields.
8. Round 2 again displayed operational success with semantically incomplete records.
9. Round 3 added terminal schema validation and correctly returned `failed: true` with `Record 0 missing required key: about`.
10. The bounded repair budget was exhausted. No service was deployed.

## Targeted intervention result

**Did the `$openTab` relative-URL fix work in Build 7? Not determined.** Build 7 did not send a relative URL to the fixed background boundary, so the run neither proves nor disproves the fix's live behavior.

The Build 6 symptom did not recur: all recorded detail tabs reached the content script. However, Build 7 cannot attribute this to commit `e84a2c5` because generated scripts converted every relative repository URL to an absolute URL before `$openTab` reached the background handler. The background log contains zero relative `$openTab` inputs.

Under the preregistered outcome rules, failure to exercise the targeted relative-URL path makes the controlled intervention result **inconclusive**. The run demonstrates healthy absolute-URL detail navigation, not live validation of relative-URL normalization.

| Fix question | Build 7 evidence | Verdict |
|---|---|---|
| Did `CONTENT_SCRIPT_NOT_READY` recur? | No; 11 of 11 opened detail tabs became ready | Symptom absent |
| Did `$openTab` receive a relative URL? | No; zero relative inputs reached the background handler | Target path not exercised |
| Can the absent symptom be attributed to `e84a2c5`? | No; generated code made URLs absolute first | Not attributable |
| Did the fix work in this live build? | No direct execution evidence | **Not determined** |

## Semantic assessment

| Criterion | Result |
|---|---|
| Exactly five ordered repository records | Operationally observed |
| Every declared key present | Fail |
| First-three detail-page enrichment | Fail |
| Grounded `about` | Fail; terminal validator reported missing key |
| Grounded `topics` and `defaultBranch` | Not demonstrated |
| Records four and five use frozen null/empty values | Not fully demonstrated |
| Read-only boundary | No violation observed |
| Eligible for deployment | No |

The final repair improved correctness by converting a false green result into an explicit schema failure. It did not repair extraction semantics.

## Token accounting

The console contains 12 LLM request records and 8 returned usage records:

| Metric | Returned total |
|---|---:|
| Prompt tokens | 166,631 |
| Completion tokens | 42,707 |
| Total tokens | 209,338 |
| Reasoning tokens | 36,860 |
| Cached prompt tokens | 24,576 |

These values are a measured lower bound. Four requests have no returned usage record and may have incurred provider-side usage. Alibaba Model Studio must be used to reconcile the official Build 7 window; missing usage is not represented as zero or estimated.

## Evidence

- Preregistration: `preregistration.md`
- Contemporaneous observations: `observations.md`
- Sanitized console: `console.log`
- Sanitized console SHA-256: `7DBABD7B0A9C3096471623D18F16C2CB3231113293EC67B736E47753EF08C0C3`
- Raw local console SHA-256: `33C6A291B440F94F393A37C97680179162ECDABB42B9DE9601EBC2B2456DD8BB`
- Phase, failure, and repair screenshots: `*.png`

The publishable console redacts 21 occurrences of the workspace-specific LLM endpoint. The raw export is retained only in ignored local storage and must not be published.

## Bounded conclusion

Build 7 does not show whether the relative `$openTab` fix worked: generated code bypassed the targeted path by constructing absolute URLs itself. The absence of the Build 6 readiness symptom is encouraging but cannot be credited to the fix. Build 7 independently confirms a remaining semantic reliability problem: operational step completion can coexist with missing required enrichment fields. The final validator detected that defect, and the run terminated safely without deployment.
