# CHIRP: TEST Venue Advisory by Sound

CHIRP is a prototype for sending a signed **TEST** gate advisory through audible sound. A prepared phone must have the page cached, microphone permission granted, and the receiver open and listening. The current build has no agency or venue authority, no verified public-warning use, and no measured venue reach.

Built at the InnovateLA x Dual-Use Hackathon (Resilience Comms lens).

## How it works

1. The **console** signs one hypothetical Gate C TEST scenario with a local demo key. It does not offer evacuation or all-clear commands. Its CAP parser is preview-only and cannot broadcast.
2. The 100-character code can be encoded as an audible chirp. The Node self-test verifies only an in-memory waveform round trip; a physical speaker-to-phone test is still required.
3. A prepared, actively listening **receiver** accepts only the signed in-scope TEST code, shows it as a simulation, and ignores forged, expired and out-of-scope packets. This build displays English and unreviewed Spanish. Its help note stays on the phone and is **not delivered**.

## Run it

```bash
node scripts/genkeys.mjs      # create demo signing keys (keys/ is gitignored)
node scripts/selftest.mjs     # end-to-end check without a browser
node scripts/test-demo-policy.mjs  # signed TEST policy checks
python3 -m http.server 8000   # open http://localhost:8000
```

Phones need a tested HTTPS origin for microphone permission. Do not publish the app as a safety service. See `docs/PROPOSAL_REVIEW.md` for the operational and physical test gates.

## Built with

[ggwave](https://github.com/ggerganov/ggwave) (data-over-sound), [TweetNaCl.js](https://github.com/dchest/tweetnacl-js) (Ed25519), and coding assistants. Retell and IBM Bob use must be reported only if actually implemented.
