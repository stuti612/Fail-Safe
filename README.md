# CHIRP: Alerts That Travel by Sound

CHIRP turns any speaker into a signed, offline, multilingual alert channel. On an ordinary day it translates stadium and Metro announcements for LA28 crowds. In a disaster it reaches exactly the phones within earshot, even when the cell network is down.

Built at the InnovateLA x Dual-Use Hackathon (Resilience Comms lens).

## How it works

1. A responder picks an alert code and zone in the **console**, which signs it with the agency's Ed25519 key.
2. The signed code (100 characters) plays as an audible chirp through any speaker: a PA, a siren, a laptop.
3. The **receiver** on any phone in earshot decodes it offline, verifies the signature, and shows it in the phone's language from a built-in phrasebook. Unsigned or forged chirps are shown as UNVERIFIED.

## Run it

```bash
node scripts/genkeys.mjs      # create demo agency keys (keys/ is gitignored)
node scripts/selftest.mjs     # end-to-end check without a browser
python3 -m http.server 8000   # open http://localhost:8000
```

Phones need HTTPS for the microphone, so test on phones through GitHub Pages or a tunnel.

## Built with

[ggwave](https://github.com/ggerganov/ggwave) (data-over-sound), [TweetNaCl.js](https://github.com/dchest/tweetnacl-js) (Ed25519), Retell AI (voice), IBM Bob and Claude Code (AI coding assistants).
