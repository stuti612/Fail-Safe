# Audit track C: browser and digital microphone end-to-end

The eight runnable `scripts/audit-c-*.mjs` suites use Chromium and real page JavaScript. A Python static server binds to `127.0.0.1` on its assigned port; the help suite also starts the local Node help server with a fake supervisor token. The browser gets throwaway trusted keys through a routed `shared/keys.js` and, for most checks, a local test config. The digital microphone suite feeds generated WAV files through Chromium's fake microphone. No speaker, real phone, public service or Retell account was used.

The first run was invalid because the filesystem sandbox denied loopback `listen` (`EPERM`). Results below are from the permitted local-socket rerun. A nonzero script exit means one or more assertion failures, unless the log says the harness aborted.

## Results

The pass/fail table is in `REPORT.md`. The full digital microphone matrix took 850 seconds: `fast` and `fastest` each decoded 4/4 clean, +10 dB, 0 dB and -6 dB white-noise chirps. At -9 dB, `fast` decoded 3/4 then 4/4 on retry; `fastest` decoded 3/4 in both runs. At -12 dB the best runs decoded only 1/4. These are four synthetic trials per cell, and a retry is reported separately. Host load spiked during some late cells, so the matrix cannot establish acoustic reliability. The WAVs and JSON matrix remained in `/private/tmp/audit-c/`.

The a11y test initially marked the light-theme Escape action as a failure because it read the status before the dialog's asynchronous `close` event. I added a bounded wait in `scripts/audit-c-a11y.mjs:108` and reran the suite: **88 PASS, 24 FAIL**; both Escape checks passed. No application code changed.

The Chromium screenshots were generated during testing and are available in the [audit snapshot at `65548d3`](https://github.com/stuti612/Fail-Safe/tree/65548d3/docs/testing/screens). They are excluded from this report-only PR and are not acoustic or physical-device evidence.

## Findings

### High

**C-H1 — An unsigned ALL CLEAR spoof becomes the primary card.** `receiver/app.js:128-155` adds an unverified alert to the front of history; the render path uses the front as the primary card. In `audit-c-receiver.mjs`, a verified `EVACUATE` was followed by one unsigned `ALL CLEAR`. The main card then read `All clear` with an `UNVERIFIED` badge. Thirty unsigned spoofs also pushed the verified evacuation out of the 30-entry history (`receiver/app.js:144-146`). The spoof did not trigger the verified alarm, but it can cover the actionable alert on screen. Keep a current verified alert primary until a trusted replacement or expiry, and keep unverified entries in a separate bounded list.

### Medium

**C-M1 — The receiver and range page overflow at 320 px.** `shared/style.css:207-223,276-281` and `:184-185` leave the receiver language selector extending to 331 px, kiosk mode to 382 px, and the range table to 369 px. `audit-c-smoke.mjs` reproduces this by setting a 320 px viewport and checking `scrollWidth` and offscreen elements. A horizontal swipe becomes necessary on a narrow phone. Constrain the selector and table layout; retest the 320 px and kiosk views.

**C-M2 — Unknown alert type is not localized.** In `audit-c-receiver.mjs`, after selecting Spanish, a signed unknown type 200 showed `Unknown alert (200)` in English. The fallback is in `shared/phrasebook.js:37`; use a localized UI string or a safe localized generic label.

**C-M3 — “Silence alarm” does not stop the sound currently playing.** `receiver/app.js:244-265` increments `alarmRun` and stops vibration but awaits a full `play(ringCycle())`; it keeps the current buffer playing. The digital microphone suite tapped Silence and measured another **1.52 seconds** of sound, with zero `AudioBufferSourceNode.stop()` calls. Stop the current source when Silence is pressed, and keep the loop cancellation for later cycles.

**C-M4 — Non-English receiver views retain English instructions.** `receiver/index.html:29,43` hardcodes the demo warning and Silence button; `receiver/app.js:389` hardcodes the Online/Offline pill. In the i18n suite, Spanish, Chinese, Korean, Tagalog, Vietnamese, Japanese, Portuguese, Russian and Armenian all left these English strings visible. The fallback detail 13 also appears in English for eight of those languages (`shared/phrasebook.json:83`, `shared/phrasebook.js:23-39`). Move safety and status text into reviewed phrasebook entries; do not silently fall back for alert instructions.

**C-M5 — Several visible controls and alert texts miss the audit's WCAG AA contrast threshold.** The a11y suite computed light card ratios of **4.11–4.35:1** for small severe/moderate/info text (`shared/style.css:141-145`); dark mode's help button was **3.26:1**, the 911 line **2.99:1**, and primary console/range buttons **2.68:1**. The harness approximates solid backgrounds and opacity, so verify final colors with a browser accessibility tool, then raise the failing pairs above 4.5:1 for normal text.

**C-M6 — Nested links/buttons and unlabeled CAP zone selects impede keyboard and screen-reader use.** `index.html:16,20` and `receiver/index.html:49` place buttons inside anchors. `console/app.js:192` creates CAP zone `<select>` controls without an accessible label; both light and dark a11y checks found three unlabeled selects. Style anchors as buttons, and label each zone choice with its CAP area.

**C-M7 — The help queue hides a caller's phone number when they also left a note.** `console/helpqueue.js:67` chooses `q.note || q.from` for the Where column. The help suite sent a mock phone report with `from_number=+15555550100` and note `need insulin`; the row showed only the note, though it offered a Call back button. Show both the note and number to an authorized supervisor, subject to the existing retention rules.

### Low

**C-L1 — Receiver language picker is 34 px high.** `audit-c-smoke.mjs` measured `#lang` at 129 × 34 px, below the suite's 44 px touch target threshold. Increase its effective target height, including padding or label interaction.

**C-L2 — The offline status pill overflows at 390 px.** `audit-c-offline.mjs` loaded a cached receiver, switched the browser offline and measured document width 420 px against a 390 px viewport. `shared/style.css:214-223` keeps the pill on one line beside the language selector. Let the header wrap or shorten the localized status text.

## Evidence boundaries

- The desktop and phone profiles are Chromium. A phone viewport and iPhone user agent do not make Chromium behave like Safari or Android Chrome.
- The digital microphone receives a WAV through the browser's fake device. This tests the page's `getUserMedia` and decode path, but not a speaker, microphone, Bluetooth link or room acoustics.
- The help suite uses MOCK Retell mode and a local HTTP server. It does not verify a real phone call or staffed response.
- The browser key route means the cryptographic UI tests do not prove a deployed private key matches the committed public key.
