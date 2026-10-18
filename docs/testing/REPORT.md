# CHIRP testing audit

**Branch:** `testing/full-audit`, based on `main` at `0bcda8d`

**Date:** October 17, 2026 (Pacific)

**Scope:** protocol and codecs (A), help server and Retell interface (B), Chromium end-to-end (C), and a review of test evidence (D). This audit changes tests and reports only; the findings describe the application as tested.

## Method and environment

The audit ran the eleven executable `scripts/audit-*.mjs` suites. `audit-a-gate-shim.mjs` is a helper invoked by `audit-a-protocol.mjs`; `audit-c-lib.mjs` is a library, not a standalone test. Track A uses Node, seeded fuzz cases, synthetic signing keys and the vendored ggwave codec. Track B sends real HTTP and raw TCP traffic to the local server, uses mock Retell credentials, then restores the server queue. Track C runs the real pages in Chromium and feeds generated WAVs to Chromium's fake microphone. [Track D](D-test-review.md) reviews what passing checks do and do not prove.

The host is macOS Darwin 25.0.0 on Apple M2, Node v26.7.0, with Playwright Chromium. Servers bound only to `127.0.0.1` on ports 8901–8981. No real keys, real Retell calls, public tunnel traffic, physical speaker or phone measurements were used. Browser routes substituted throwaway public keys and a local config; the help suite used a fake supervisor token. The initial sandboxed B/C run was invalid because `listen` returned `EPERM`; the reported B/C results come from a rerun with loopback permission. Generated WAVs and raw run logs remained in `/private/tmp/chirp-audit-run/`; they are not part of the PR.

## Results

| Track / command | PASS | FAIL | INFO | Meaning |
| --- | ---: | ---: | ---: | --- |
| A `audit-a-protocol.mjs` (seed 20261017) | 138 | 21 | 48 | Permitted rerun; includes five digital-audio failures and two missing-secret gate failures. |
| A `audit-a-audio.mjs` (standalone seed 1) | 16 | 7 | 10 | Different clean phase result from the integrated run; see A report. |
| B `audit-b-server.mjs` | 90 | 36 | — | 126 assertions; two Critical failures are the same aborted-body crash root cause. |
| C `audit-c-smoke.mjs` | 84 | 5 | 10 | Four 320 px overflow checks and one small selector target fail. |
| C `audit-c-receiver.mjs` | 41 | 3 | 1 | Unsigned spoof displacement and untranslated fallback. |
| C `audit-c-audio.mjs` | 15 | 1 | 16 | Full 20-cell fake-microphone matrix; Silence leaves the current ring playing. |
| C `audit-c-i18n.mjs` | 44 | 26 | 5 | Missing detail 13, English UI leftovers and 320 px overflow across languages. |
| C `audit-c-offline.mjs` | 35 | 1 | 5 | Offline app reload passed; the offline status pill overflows at 390 px. |
| C `audit-c-a11y.mjs` | 88 | 24 | 19 | Final rerun after a bounded Escape-event wait in the test; contrast and labeling failures remain. |
| C `audit-c-console.mjs` | 36 | 1 | 6 | Signed/unsigned digital console loopbacks passed; preview falls back to English for detail 13. |
| C `audit-c-help.mjs` | 33 | 1 | 5 | Local MOCK help flow and sound/POST merge passed; caller number hidden by note. |

Every `FAIL` is retained as evidence, not counted as a release gate that must be made green by this documentation-only audit. The normal `selftest.mjs` and `test-demo-policy.mjs` need gitignored local signing secrets and could not start in this clean checkout. Both passed under the throwaway-key shim (84/84 and 1/1). `server-safety.mjs` passed 8/8 with loopback permission; `sw-cache-safety.mjs` passed.

The first sandboxed Track A run had 136 PASS and 23 FAIL. Its embedded `server-safety.mjs` could not bind to loopback, and the malformed-CAP timing check took 1.29 s under load; in the permitted rerun the gate passed and that input took 0.64 s. The other Track A failure classes persisted.

The Node digital-noise table decoded all 5/5 trials per protocol from clean through -6 dB additive white noise, then 1–3/5 at -10 dB. Its 48 kHz sender to 44.1 kHz receiver simulation decoded 0/5 for every protocol. This is a codec-path observation with a small synthetic sample; it is **not** an acoustic range or delivery-rate measurement.

In the Chromium fake-microphone matrix, `fast` and `fastest` each decoded 4/4 clean through -6 dB additive white noise. At -9 dB the first run decoded 3/4 for each; at -12 dB the best run decoded 1/4. The suite also showed verified alarm, expired and untrusted cards, replay suppression, and digital sound-to-console help decoding. The a11y test's first Escape failure was a harness timing race: `scripts/audit-c-a11y.mjs:108` now waits for the dialog `close` event and status; both Escape assertions passed on rerun. No application code was edited.

## Ranked findings

The detailed repro inputs and lower-severity ledger are in [A-protocol.md](A-protocol.md), [B-server.md](B-server.md), and [C-browser.md](C-browser.md). File and line references below point to the audited application at base `0bcda8d`.

### Critical

| ID | Finding, minimal repro and fix |
| --- | --- |
| B-C1 | **A disconnected HTTP client crashes the entire help server.** `server/server.mjs:71,76` reads a request body with uncaught `for await`. Open a TCP connection, send a partial body with a larger `Content-Length`, then close it: the Node process exits. A GET with a body also triggers it without auth. Catch stream rejection and add an aborted-upload regression; preserve the queue and callback service. |

### High

| ID | Finding, minimal repro and fix |
| --- | --- |
| A-H1 | **CAP can invert message meaning.** `console/cap.js:55` maps `Evacuation Order Lifted` to `EVACUATE`. Match reviewed event/SAME codes exactly and force a manual choice for unknown or negated events. |
| A-H2 | **CAP can select the wrong zone.** `console/cap.js:22-31` maps `Malibu; Los Angeles County, CA` to countywide zone 99 and `Exposition Park` to narrow Gate C. Require an unambiguous area/geocode match or an operator zone choice. |
| A-H3 | **Small clock skew silently drops a maximum-validity alert.** `receiver/app.js:141` refuses a signed 12-hour alert when the receiver clock is one minute behind. Add bounded clock-skew tolerance and show a visible rejection state. |
| A-H4 / B-M5 | **Different residents' help requests can merge.** `shared/help.js:59,68-70` keys only on a 16-bit request ID and minute. Submit two different needs with the same values; the second gets `added:false`. Use a wider app POST ID and compare contents when deduplicating. |
| A-H5 | **Synthetic 44.1 kHz reception fails.** `shared/audio.js:21-28`; `scripts/audit-a-audio.mjs:150-200` resamples 48 kHz chirps to 44.1 kHz and gets 0/5 decodes per protocol. Verify with a real 44.1 kHz phone, then correct rate handling or buffering. |
| B-H1 | **A queued help request can be acknowledged then deleted.** `server/core.mjs:71,122`, `server/server.mjs:35`: POST with `createdMin = now-1500` returns `added:true`, but GET `/help` has no entry. Base retention on server receipt time and never report delivery for a pruned request. |
| B-H2 | **Restart stops callback escalation.** `server/server.mjs:53-67,88-109` keeps timers and mock steps only in memory. Start a callback, restart after call 2, then wait: no door-knock step appears. Persist each transition and resume or flag incomplete ladders at startup. |
| B-H3 | **An agent-only transcript stops escalation as “answered.”** `server/core.mjs:147` counts the agent's words. Pass `Agent: Hello...\nUser:` to `callbackOutcome`; it returns `answered`. Count caller speech only, preferably from structured transcript turns. |
| C-H1 | **An unsigned “All clear” replaces a verified evacuation on screen.** `receiver/app.js:128-155`: paste a verified EVACUATE, then an unsigned ALL CLEAR. The primary card becomes `All clear` with an unverified badge; 30 spoofs erase the verified entry from history. Keep verified alerts primary and bound unverified history separately. |

### Medium

| ID | Finding, minimal repro and fix |
| --- | --- |
| A-M1–M3 | `console/cap.js:14-16,46,68` accepts `Ack`/`Error` as alerts, interprets an offset-less expiry differently by timezone, and took 1.29 s then 0.64 s on one malformed 64 KiB input across two runs. Reject unsupported message types and offset-less dates; use a bounded XML parser. |
| A-M4 / B-M6 | `shared/help.js:35-36,47-54` wraps invalid coordinates, and `server/core.mjs:70` persists a 90 KB `lat` value. Send `lat=327.68` or a 90 KB string. Validate finite bounds at both codecs and HTTP ingress. |
| A-M5 / B-L10 | `server/core.mjs:38` accepts a signed 30-day alert while receivers enforce 12 hours. Apply the same cap before adding it to phone readout. |
| A-M7 | `shared/audio.js:16-33` uses one ggwave instance to encode and decode. A synthetic encode midway through decode lost the incoming chirp. Reproduce in browser; pause/restart listening during a help send if overlap matters. |
| B-M1/M2 | `server/core.mjs:91-93,137` lets a duplicate callback webhook skip steps and a second callback POST start a parallel ladder. Record handled call IDs and reject a second active callback. |
| B-M3 | `server/server.mjs:80` permits unauthenticated mock Retell webhooks; one forged callback outcome marked a ladder answered in the local test. Require a mock secret or disallow exposed mock mode. |
| B-M4 | `server/core.mjs:50`, `shared/phrasebook.json:66` read type 13 as “Official alert” despite the demo label. Use neutral, reviewed text. |
| B-M7/M8 | `server/server.mjs:76` corrupts multibyte UTF-8 split across chunks, causing valid Retell HMACs to fail; `server/core.mjs:55` misses Spanish “no puedo respirar” in triage. Buffer bytes before decoding; review multilingual life-threat phrases with native speakers. |
| C-M1/M2 | At 320 px the receiver/range overflow (`shared/style.css:184-185,207-223`); a signed unknown type shows English fallback in Spanish (`shared/phrasebook.js:37`). Constrain layouts and localize the fallback. |
| C-M3/M4 | `receiver/app.js:244-265` leaves the current ringtone playing **1.52 s** after Silence; `receiver/index.html:29,43` and `receiver/app.js:389` leave English safety/status text in non-English views. Stop the active audio source and localize the UI with reviewed strings. |
| C-M5/M6 | `shared/style.css:141-145` and dark-theme colors yield small text/buttons below the 4.5:1 audit threshold; `index.html:16,20`, `receiver/index.html:49`, `console/app.js:192` contain nested link/buttons and unlabeled CAP selects. Adjust colors and use labeled, single interactive controls. |
| C-M7 | `console/helpqueue.js:67` displays a phone caller's note in place of their number. A mock `report_need` with `from_number` and note offered Call back but showed only the note. Show both to the authorized supervisor. |

### Low and Info

The track reports include each lower-priority reproduction. Notable limits: the cooldown grows after a backward clock adjustment (`console/slow.js:8-9`); a future client timestamp can defeat help-data retention (`server/core.mjs:122`); closing a help request twice overwrites the named handler (`server/core.mjs:114`); the receiver language picker measures 34 px high (`receiver/index.html:26`, `shared/style.css:93-99`); and the Armenian unverified badge displays its whole sentence because the UI splits on a colon (`receiver/app.js:162`). INFO observations include the committed public tunnel URL in `shared/config.js`, unreviewed translations, non-canonical base64 accepted by the decoder, and the finite 16-bit message-ID space.

## Readiness and limits

The audited build is **not ready to be presented as a dependable public-warning or staffed help service** while the Critical server crash, misleading CAP/zone and spoof display paths, and help-loss/callback findings remain. A green digital or Chromium check does not establish acoustic delivery or iPhone/Android behavior. The next device proof is the 10-trial-per-condition procedure in `docs/DEVICE_TEST.md`, with real speaker-to-phone tests, offline reload, alarms and screen-reader checks. There are no measured physical range or reliability numbers in this audit.
