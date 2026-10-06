# Environmental Failure Detection & Self-Healing — Design Spec

**Date:** 2026-10-06
**Status:** Approved (brainstorm session, all decisions confirmed)
**Evidence base:** rs-1791164334786 journal (Oct 4-5): 42min/33min/3.1h/9.7h away windows survived via bridge-parking; 6× SANDBOX_DEADLINE cluster at 01:55-01:57 and 23× popover_timeout at 12:16-12:19 during screen-lock; 17× popover_timeout at 15:28-15:33 with user present (popover_timeout alone is NOT lock-specific); 473× focusedWindow:false re-assertions; zero suspend-credit (no sleep, display-off only).

## Problem

Lazy-load sites need compositor frames; display-off/lock stops them. Both research and runtime phases lose data when the test machine's screen goes dark or the user interferes. The harness survives long windows (bridge parking + resume) but wastes verify rounds on environmental hover/scroll failures and misattributes them to field defects (schema renegotiation instead of waiting).

## Decisions (user-confirmed)

1. **Scope:** research AND runtime simultaneously (shared DSL infrastructure layer).
2. **Lock detection:** chrome.idle API first (active query); multi-signal synthesis fallback.
3. **Retry layer:** inside the operation, transparent to DSL callers.
4. **Required-field escalation:** environmental failures don't count toward the 2-failure ledger; post-recovery failures escalate directly to user annotation (skip schema-reneg suggestion).
5. **Unattended runtime:** active screen-keep-awake during sessions/tasks (chrome.power, default-on, settings toggle).

## §1 Screen-state detector — `lib/screen-state.js`

**Primary (active API):** manifest gains `"idle"` permission. The SW calls `chrome.idle.setDetectionInterval(15)` (API floor) at init and exposes a query to content-script/background consumers:

```
getScreenState() → { state: 'active'|'idle'|'locked'|'unknown', confidence: 0..1, source: 'api'|'synthesis'|'none' }
```

- `chrome.idle.queryState` reports `'locked'` when the OS screen is locked; display-off-without-lock reports `'idle'`. This directly covers the user's "screen off but no sleep" case.
- Consumer path: background exposes `GET_SCREEN_STATE` message; `withTabActivation`'s context (content-script) queries it on failure paths. Engine-side, the same state is readable via a session-evidence getter.

**Fallback (multi-signal synthesis):** when the API is unavailable (permission denied, platform variance), a synthesizer consumes signals that ALREADY exist:

| Signal | Source | Lock signature |
|---|---|---|
| `focusedWindow:false` density | TabActivation receipts | high during lock |
| consecutive dispatch-failure cluster | hover/scroll failure receipts | cluster ≥ 3 |
| dispatch wall ≫ per-op historical median | tool timing accumulator | > 5× median |
| zero suspend-credit | engine bookkeeping | machine awake, screen dark |

Output is the same shape with `source:'synthesis'`, `confidence ≤ 0.85`. Both channels are calibrated by the journal evidence: the 01:55 cluster matches lock; the 15:28 cluster (user present) must NOT match.

**Query timing (not polling):** hover/scroll failure paths ask ONCE on a timeout-class receipt. No background loop.

## §2 In-operation transparent retry

Applies to: `domHover`, `domExtractWithHover` (hover batch failure), `scroll-ops` (`scrollBy`/`scrollToBottom` stall), `domCollectUntil` rounds.

On a timeout-class failure:
1. Ask `getScreenState()`.
2. If `locked`/`idle` (confidence ≥ 0.75): enter wait-recover loop — re-query every 5s, one lightweight dispatch probe per cycle, total cap **90s**.
3. On recovery: re-run the original operation ONCE, full fidelity.
4. Outcomes:
   - success → return normal receipt plus `environmental:{recovered:true, waitedMs}` (diagnostic, no behavior change)
   - still failing after cap → honest receipt `environmental:{recovered:false, state, waitedMs}` + existing failure teaching
5. Wait time accounting: research phase — parked semantics (excluded from wallClock, same as bridges, disclosed via the 185th-round TIME BUDGET line); runtime — counts against the task budget.

Transparent to DSL callers: step scripts and the model never see the retry; they see success or an honest environmental failure.

## §3 Required-field ledger: environmental failures don't count

`tickFieldFailLedger` (171/177 rounds) gains:
- A verify/probe failure whose receipt chain carries `environmental` markers does NOT increment the field's failure count.
- When environmental state has RECOVERED (`active`) and the field still fails ≥ 2 real attempts → FIELD_ASSIST_REQUEST fires directly with the environmental history in the note (skips the schema-reneg advisory path): "the field failed N real attempts after the screen-lock window recovered — the page is not offering it under normal conditions; the user can point at the element."

## §4 Active screen keep-awake

`chrome.power.requestKeepAwake('display')` (no extra permission):
- Acquire: research session start / runtime task execution start (SW).
- Release: session stop (any reason) / task completion or failure.
- Settings toggle (options page, default ON) with one-line explanation (mirrors the Enhanced Mode precedent).
- SW suspension safety: keep-awake persists while the extension process lives; MV3 SW may suspend — re-assert on the SW events that already wake it (message handlers, alarms). A drift-guard test asserts acquire/release call pairing.
- Complements `scrapewright throttle on` (launcher flags stop background throttling; keep-awake stops display-off).

## §5 Resume-not-die (mostly exists; small disclosures)

- Minute-scale lock windows: transparently absorbed by §2 (no resume needed).
- Long windows: existing bridge parking + session persistence + resume unchanged (proven across the journal's four away windows).
- Stop detail / TIME BUDGET gains an `environmental waits Ns (screen locked/idle)` line item when §2 waits occurred (extends the 185th-round disclosure family).

## Testing

- `test/screen-state.test.js`: API channel shape; synthesis fallback on the journal-derived signal fixtures (the 01:55 lock cluster vs the 15:28 present-user cluster — both must classify correctly); unknown-state neutrality.
- Hover/scroll retry: mock screen-state resolver `locked→active` after N cycles → operation succeeds with `environmental.recovered`; never-recovered → honest receipt; non-environmental timeout → NO retry loop (existing path untouched).
- Ledger: environmental-marked failures don't count; post-recovery 2-failures fire FIELD_ASSIST with the history.
- Keep-awake: acquire/release pairing guard (source audit + unit); settings default.
- Prompt budget guards: no prompt-text growth in this round.

## Universality

No site tokens. All signals are generic web-extension mechanics (idle state, focus, dispatch timing). The detector is infrastructure; sites see nothing new.

## Out of scope (explicit)

- OS-level lock-screen prevention beyond chrome.power (no system settings changes).
- Wake-from-lock via input synthesis (out of authority).
- Mouse-interference-specific detection (user clicks/moves) — activation re-assertion already handles it; the synthesis channel treats it as generic focus loss.
