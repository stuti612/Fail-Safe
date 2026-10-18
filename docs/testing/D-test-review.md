# Audit track D: review of the test evidence

I read the new audit harnesses and the existing gate calls. This is a review of what a green check actually proves; it is not an additional device test. Line references are to the audit branch at base `0bcda8d`.

## Strong evidence

- Track A uses seeded data and throwaway Ed25519 keys in memory. It exercises wire boundaries, signature rejection, receiver decisions, CAP mapping and ggwave encode/decode. Failures are logged with their inputs. `scripts/audit-a-protocol.mjs` also runs the existing gates both normally and, where keys are needed, through `scripts/audit-a-gate-shim.mjs`.
- Track B drives the real HTTP server over loopback, including raw TCP bodies and server restarts. It checks the persisted queue and restores any queue file it found before the run (`scripts/audit-b-server.mjs:42-75`, `:966-973`). It uses synthetic Retell credentials and makes no calls.
- Track C drives real page code in Chromium and checks rendered state, storage, errors and network behavior. The key and config overrides are explicit in `scripts/audit-c-lib.mjs:64-79`. Its fake microphone exercises `getUserMedia` through the browser decoder, without an acoustic path (`scripts/audit-c-audio.mjs:1-7`).

## False-pass risks and missing evidence

| Priority | Evidence boundary | Why a passing check is narrower than the product claim | Next proof |
| --- | --- | --- | --- |
| High | Physical delivery | Both audio harnesses synthesize samples and decode them in software. Chromium reads a WAV as its microphone (`scripts/audit-c-audio.mjs:60-88`). Speaker, room acoustics, phone microphones, Bluetooth, PA filtering, noise processing and phone-call compression are absent. | Use `docs/DEVICE_TEST.md` with real phones and a speaker; retain raw trial counts and failures. |
| High | Live help service | Track B uses mock callback timing and fake Retell signatures; Track C's help server deletes `RETELL_API_KEY` and `RETELL_FROM_NUMBER` (`scripts/audit-c-help.mjs:18-27`). Green checks do not prove a real inbound call, outbound callback, staffing or tunnel behavior. | Test a real call, webhook, callback and named handoff in a controlled deployment. |
| High | Trusted deployment keys | A inserts throwaway keys; C serves a replacement `shared/keys.js` (`scripts/audit-c-lib.mjs:28-42`, `:75`). This is appropriate for safety, but green sign/verify checks do not prove the locally held secret matches a committed public key. The normal gate run separately reports whether this checkout can run. | Provision a dedicated authorized test key; compare its public key and run a safe end-to-end send on devices. Never commit the secret. |
| Medium | Browser/device diversity | The phone profile changes viewport, touch and user agent in Chromium (`scripts/audit-c-lib.mjs:24-25`). It does not run WebKit, Safari or Android Chrome. In particular, an iPhone user agent on Chromium cannot prove iOS mic, Wake Lock, service worker or vibration behavior. | Repeat the device checklist on iPhone Safari and Android Chrome. |
| Medium | Best-of-two audio threshold | `scripts/audit-c-audio.mjs:122-135` calls the clean and +10 dB cells PASS if either of two runs decodes all four. A miss in the first run remains visible in the log and matrix, but the headline PASS can hide unstable reliability. Other SNR cells are INFO and cannot fail the script for lost decodes. | Report each run's numerator and denominator, and use enough physical trials for a reliability claim. |
| Medium | SW update | `scripts/audit-c-offline.mjs:94-100` downgrades a failed route-based update simulation to INFO. A green overall script can therefore coexist with an unproved version update path. | Test an actual changed `sw.js` over HTTPS on a previously installed phone. |
| Medium | External endpoint in smoke tests | `scripts/audit-c-smoke.mjs:31-39` ignores navigation errors, separates blocked endpoint errors from other console errors, and uses a routed empty config for its main green checks. This verifies the UI in isolation, not the committed tunnel's availability. | Test the deployed URL and configured endpoint separately; keep the isolation checks. |
| Low | Static source assertions | Some Track A checks match source text, for example the receiver's 12-hour cap (`scripts/audit-a-protocol.mjs:287`), and Track C's locale direction check is a grep (`scripts/audit-c-i18n.mjs:25-27`). These can pass while runtime behavior changes elsewhere. | Pair them with runtime boundary tests when this code changes. |
| Low | Check count versus coverage | One `PASS` may cover many cases, and one `FAIL` may represent several symptoms from the same root cause. Totals are check counts, not a safety score or probability of successful alert delivery. | Use the findings and per-condition data, not the aggregate count, to decide readiness. |

## Test-harness reliability

The scripts use fixed ports 8901–8981, so parallel audit runs can collide. Track B also owns `server/queue.json`; Track C help refuses to start if that file exists. Run these suites sequentially. The reports distinguish assertion failures from harness aborts, and preserve the output needed to reproduce each. The generated screenshots show Chromium states, not independent proof that a screen reader announced them or that a phone alarm was felt.

The initial a11y run had one false failure: the test pressed Escape and immediately inspected the status before the dialog's asynchronous `close` handler updated it. `scripts/audit-c-a11y.mjs:108` now waits up to two seconds for closure and the cancellation status, then asserts the same behavior. On rerun both light and dark Escape checks passed; the other 24 failures remained. This is the only audit-script change made after the handoff.
