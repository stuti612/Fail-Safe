# Audit track A: protocol, crypto, CAP, codecs and Node audio

The harnesses are `scripts/audit-a-protocol.mjs` and `scripts/audit-a-audio.mjs`. They use seeded randomized cases, throwaway Ed25519 keys kept in memory, and the vendored ggwave implementation. They do not read `keys/*.secret` or transmit sound through air. No application code was changed.

## Results

`AUDIT_SEED=20261017 node scripts/audit-a-protocol.mjs` with loopback permission: **138 PASS, 21 FAIL, 48 INFO**. The earlier sandboxed run had **136 PASS, 23 FAIL**: its embedded server gate failed with `EPERM`, and a malformed-CAP timing check crossed its 1-second threshold under higher load. The standalone `node scripts/audit-a-audio.mjs` also completed with seed 1 and returned nonzero. Its clean phase sweep found 3/1024 failed offsets on `AUDIBLE_FAST` and 16/1024 on `AUDIBLE_NORMAL`; the seed-20261017 integrated run found 0/1024 on all three protocols. These samples show why one clean run is insufficient for a reliability claim. A failing assertion records a reproducible defect or a gate that cannot run in this checkout; `INFO` records behavior without asserting it is safe. The Node audio SNR figures describe an idealized digital channel, not reception probability at a distance.

The normal `selftest.mjs` and `test-demo-policy.mjs` gates cannot run in this checkout because gitignored `keys/*.secret` are absent. Their throwaway-key shim runs passed **84/84** and **1/1**. The normal `server-safety.mjs` gate initially failed because the sandbox denied loopback listening (`EPERM`); a rerun with local network permission passed **8/8**. `sw-cache-safety.mjs` passed.

## Findings

### High

**A-H1 — CAP event matching can invert an alert's meaning.** `console/cap.js:55` uses substring matching. A CAP event of `Evacuation Order Lifted` becomes `EVACUATE`; `Evacuation Warning Cancelled` becomes `EVACUATION_WARNING`; `Shelter in Place Lifted` becomes `SHELTER_IN_PLACE`. `Protest activity downtown`, `Latest Wildfire Information`, and `Contest results` become `TEST`. Repro: run the event-text assertion in `audit-a-protocol.mjs` or paste these events into the CAP preview. The operator review is a guard, but the imported code is wrong. Fix: require an exact, reviewed event or SAME-code mapping, and send unknown or negated text to an explicit manual choice.

**A-H2 — CAP area matching can choose the wrong geographic scope.** `console/cap.js:22-31` scores overlapping words and silently takes the best zone. `Malibu; Los Angeles County, CA` maps to countywide zone 99, while `Exposition Park` maps to the narrow Coliseum Gate C zone; `Altadena` maps to one narrow sub-zone. Repro: `matchZone` assertions in Track A. The wide-zone typed `SEND` confirmation is the last guard in the countywide case. Fix: require an unambiguous exact area/geocode match; otherwise force a zone choice in the preview.

**A-H3 — A one-minute receiver clock lag drops a 12-hour alert without a card.** `receiver/app.js:141` compares the signed expiry to the receiver's current time plus exactly 720 minutes. An alert signed at the console's 12-hour maximum is accepted with aligned clocks and silently ignored when the receiver clock is one minute behind. Repro: the Track A max-validity/clock-skew assertion. Fix: allow bounded clock skew while retaining the maximum validity rule, and display an explicit rejection state when a verified wire is refused.

**A-H4 — Distinct help requests can merge on the 16-bit sound ID.** `shared/help.js:59,68-70` deduplicates on `reqId:createdMin:callId` alone. Two residents with different needs but the same random ID in one minute collapse into one; the second is treated as already added. Track A reproduces this with different need, location and life-threat values. For 50 random IDs in one minute, the approximate chance of at least one collision is 1.85%. Fix: send a larger ID in app POSTs, and require content agreement before treating a same-key report as a duplicate.

**A-H5 — A simulated 48 kHz sender to 44.1 kHz receiver did not decode.** `shared/audio.js:21-28` sets the ggwave sample rate to the browser's `AudioContext` rate. Track A generated a 48 kHz chirp, linearly resampled its samples to 44.1 kHz and decoded with a 44.1 kHz receiver: **0/5** for `AUDIBLE_FASTEST`, `AUDIBLE_FAST` and `AUDIBLE_NORMAL`. The 44.1 kHz, 1024-sample chunk check also failed, while 4096-sample chunks passed (`scripts/audit-a-audio.mjs:150-175,189-200`). This is a synthetic codec-path failure, not a measured speaker-to-phone failure. Reproduce on actual 44.1 kHz devices before deciding whether to change buffering or resampling.

### Medium

**A-M1 — Non-alert CAP message types can be imported.** `console/cap.js:46` rejects `Cancel` only. `Ack` and `Error` produce an alert with no warning in the Track A repro. Reject unsupported `msgType`s before mapping or broadcast.

**A-M2 — CAP expiry without a timezone depends on the operator's computer.** `console/cap.js:68` passes an offset-less timestamp to `Date.parse`; the same `2026-10-17T21:00:00` means instants seven hours apart in Los Angeles and UTC, with no warning. Require a CAP timestamp with a timezone offset.

**A-M3 — Long malformed CAP input can stall the synchronous parser.** `console/cap.js:14-16,36-45` scans with regular expressions on the main thread. Repeating an unclosed `<alert` within the allowed 64 KiB took **1.29 s** in the first run and **0.64 s** in the permitted rerun. This is a load-sensitive performance risk, not a consistently failing one-second assertion. Reject malformed XML cheaply or use a browser XML parser with a strict size cap.

**A-M4 — Help coordinates can wrap or turn into a real-looking false position.** `shared/help.js:35-36,47-54` writes unvalidated values into signed 16-bit centidegrees. `lat=327.68` round-trips as `-327.68`; `lat=NaN, lon=NaN` becomes `(0,0)` instead of unknown; the decoder accepts latitude 300 and longitude -300. Validate finite geographic bounds on both encode and decode.

**A-M5 — The server accepts expiry beyond the receiver's limit.** `server/core.mjs:33-41` checks only that a signed alert has not expired. A throwaway-signed alert expiring at the uint32 maximum is accepted for phone-line readout, while `receiver/app.js:141` refuses it. Enforce the same 12-hour cap on publication.

**A-M6 — Console cooldown can grow to an hour after clock adjustment.** `console/slow.js:8-9` subtracts wall-clock `now` from a saved send time. Moving the clock back one hour after a send yields a 3,660-second wait. Clamp the wait to the intended 60 seconds or use a monotonic timer for an active page.

**A-M7 — Encoding a reply chirp can interrupt decoding on the same ggwave instance.** `shared/audio.js:16-33` keeps one instance per page. Track A injected an `encode` midway through decoding a signed chirp with that instance, and the chirp was not decoded (`scripts/audit-a-audio.mjs:202-216`). A receiver that sends help while listening may miss an incoming chirp during that interval. Verify the overlap in a browser and pause/restart listening explicitly during send if needed.

### Low / content integrity

- `shared/help.js:31-32,48-49` can encode a language such as `é` or `中文` into bytes its own decoder rejects. Validate or normalize the two-letter language before encoding.
- Eight non-English languages lack detail code 13 text in `shared/phrasebook.json` (Track A checks every declared code and language). Provide reviewed text or an explicit fallback with a visible unreviewed label.
- Armenian's `ui.unverified` string has no colon, while `receiver/app.js:162` splits on a colon to make the short badge; the full warning becomes the badge. Use a separate badge string rather than punctuation parsing.
- `shared/payload.js:16-27` and `range/pattern.js` silently wrap out-of-range numeric fields. Existing callers should validate before encoding; add validation if these are exposed to untrusted inputs.

## Observations and limits

- The Ed25519 verifier accepts a malleated second signature for the same body, but receiver deduplication uses signer and message ID, so the Track A repro did not bypass deduplication. A small-order public key would be dangerous if one were ever bundled; key provisioning must validate public keys.
- Expired signed wires enter the receiver's seen set. Reusing their signer and 16-bit message ID can then suppress a later live alert. An unbounded seen set eventually treats all 65,536 IDs from one signer as duplicates within one listening session. These are replay/long-session design limits, not a measured demo failure.
- The CAP regex reader also treats comments and some CDATA as markup, and does not decode numeric character references. A human preview does not make its mapping deterministic.
- The full Node gate run is reported separately from the throwaway-key shim. A shim pass proves gate logic under synthetic keys; it does not prove deployment key provisioning.
- In the seed-20261017 digital SNR matrix, all three protocols decoded 5/5 at clean through 0 dB and -6 dB white noise; at -10 dB they decoded 2/5, 3/5 and 1/5, respectively. The sample is small and models additive noise only. It must not be used as a range or acoustic reliability claim.
