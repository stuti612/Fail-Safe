# CHIRP physical and offline test protocol

**Status: no physical trials recorded.** This page is a repeatable procedure, not proof of phone delivery. The only measured airtime so far is digital waveform loopback in `docs/twist1-evidence.json`.

## Test setup

- Use a private room and tell everyone nearby that the spoken and acoustic message is a **TEST**. Use no live venue PA system or public crowd. A powered laptop speaker is enough for this first gate.
- Use the committed TEST build, a local demo venue secret, and an HTTPS receiver origin each phone can open. Record commit, URL origin, device model, OS/browser version, speaker, protocol, volume, approximate room noise, and test date. Never record the secret key.
- On each phone while online: open the receiver, refresh it twice after any service-worker update, select English or Spanish, tap **Start listening**, grant mic permission, and keep the screen unlocked and app foregrounded. Confirm the TEST-only banner and hypothetical Gate C/D wording. The Spanish draft has not had native-speaker review.
- Switch off cellular and Wi-Fi **after** the app is cached. Reload the receiver at the same origin. It must open and let you start listening without network. Record this as a separate pass/fail; a page that remains open without a reload has not proved offline startup.
- On the console, paste only `keys/coliseum-ops.secret` into the TEST key field. Do not copy the key into a screenshot or shared document. Use the signed TEST button, one repeat for latency measurement, and the same protocol/volume for all trials in a set.

## Measurement

At 1 m in a quiet room, transmit ten **new** signed TEST packets to each of two phones, one in English and one in Spanish. Wait out the 60 s same-zone cooldown or reset the console between independent trials only if the test log says so. Record each trial, including failures. Then repeat at 3 m, with background noise, and after a speaker-off check. Do not count a digital loopback as a phone trial.

| Trial | Phone | Radio off + offline reload passed? | Distance / noise | Protocol / volume | Packet start time | Card visible time or timeout | Correct signed TEST card? | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |

Use a synchronized wall clock or a video with both laptop and phone in frame to measure latency. Record the full transmitted duration separately. One-minute expiry means a late or delayed decode may be correctly rejected; note it rather than repeating until success.

## Safety and failure checks

1. With the receiver's `?debug=1` paste box, test malformed text, a validly encoded packet with a bad signature, an expired packet, and a signed emergency type. None should create a card or vibrate. This is a **software-path check**; repeat through the actual speaker path before claiming acoustic rejection.
2. Close and reopen the receiver after a signed TEST card. Its history must reverify the stored wire. A forged `chirp.history` entry must not display as verified. The Node policy test covers the wire verifier; the phone reload checks storage integration.
3. Turn the speaker off for one send. Record no reception as the expected result. Restore it and confirm the normal TEST packet can be heard again.
4. Tap the local help-note control while offline. It must say **NOT DELIVERED**. No human handoff, Retell call, or dispatcher response is established by this test.
5. Count phones or people in the room without a preloaded, unlocked, listening receiver. This is the **unreached group**, even if they are within speaker range.

## Go/no-go for a stage demonstration

At least 8/10 correct receives at 1 m in a quiet room on each tested phone is a **demo feasibility threshold only**. If either phone fails, show the real failure and use the tested single-phone scope; do not claim a reliable safety service. If no physical speaker-to-phone receive succeeds, present the signed packet and digital loopback as an engineering prototype and remove claims of a working acoustic phone demo.

The final evidence should report numerator and denominator per device and condition, median observed latency, offline reload result, negative-case result, exact commit, and the number of unreached people. Leave untested fields blank or `null`; never fill them from the Node loopback.
