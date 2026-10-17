# CHIRP: audible, signed resilience demo

CHIRP is a **hackathon prototype** that turns a short signed code into an audible chirp. A prepared phone with the receiver page open and microphone permission can decode it offline and display fixed phrasebook text in its chosen language. The signing keys in this repo are **local demo keys**. A valid signature proves only that a matching demo key signed the code; it does not prove that a CAP file came from an agency or that an alert has public-warning authority. Do not use CHIRP for real emergency instructions.

Built for the InnovateLA x Dual-Use Hackathon, with a crisis response scenario and an ordinary event-operations scenario in Los Angeles. See `docs/PROPOSAL_REVIEW.md` for the scope and `docs/TWIST1_VERIFIED.md` for the federal funding pathway.

## Current modes

- **Full feature demo (default):** The console can compose alerts or map pasted CAP XML to fixed phrasebook codes, sign with a local demo key, play chirps, and optionally use on-device speech. The receiver shows signed alerts and unsigned chirps with different labels, records history, and has a help-request chirp. The optional local server stores a demo help queue and exposes Retell endpoints. CAP input is not authenticated. The receiver labels every signed alert **TEST ONLY**; no real warning authority is implied.
- **Strict demo (`?strict=1` on both console and receiver):** One Gate C TEST scenario, one-minute validity, English and unreviewed Spanish, and CAP preview only. Help stays as a local note. Use this when showing a controlled first-submission demonstration.

The receiver must already be open and listening. Node tests measure a waveform loopback (3.75 seconds FASTEST; 6.83 seconds FAST), not physical speaker-to-phone delivery. A real two-phone acoustic test, offline test, native-speaker review, staffed help queue, and live Retell call remain unverified. `shared/config.js` has no help endpoint or Retell number by default, so the app must say **NOT DELIVERED** for a request that has not reached a configured server.

## Run locally

```bash
node scripts/genkeys.mjs
node scripts/selftest.mjs
node scripts/test-demo-policy.mjs
node scripts/server-safety.mjs
python3 -m http.server 8000
```

Open `/console/` and `/receiver/` from the local server. Phones require a tested HTTPS origin for microphone access. Keep the mock help server on localhost until access control, retention, live staffing, and end-to-end operation are verified. `docs/DEVICE_TEST.md` has the real-device protocol.

For a **local synthetic help-queue demo**, start `server/server.mjs` with a `CHIRP_SUPERVISOR_TOKEN` and set `CHIRP_APP_ORIGIN` to the exact browser origin (for example `http://localhost:8000`). The server binds to `127.0.0.1`; without a supervisor token its private queue, callback, and alert-publish routes are unavailable. `HELP_ENDPOINT` remains empty until a test endpoint is deliberately configured in `shared/config.js`. A saved demo request does not mean a responder has accepted it.

## Built with

[ggwave](https://github.com/ggerganov/ggwave) for data over sound and [TweetNaCl.js](https://github.com/dchest/tweetnacl-js) for Ed25519 signatures. AI tools used in the build and any Retell or IBM Bob use must be reported accurately in the submission.
