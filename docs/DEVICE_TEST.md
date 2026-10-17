# CHIRP physical and offline test protocol

**Status: no physical speaker-to-phone trials recorded.** This page is a repeatable procedure, not proof of phone delivery. Node waveform timing is in `docs/twist1-evidence.json`.

## Digital browser microphone check (completed)

On Oct 17, `scripts/mic-loopback.mjs` fed generated WAV audio to headless Chromium's **fake microphone**. The range page decoded 3/3 numbered patterns; the receiver displayed the signed TEST `SHELTER IN PLACE` card for Union Station; the browser reported no page errors. This checks the browser's `getUserMedia` → audio processing → decode → render path. The source was digital audio, so this result says nothing about speaker volume, room noise, phone microphone sensitivity, range, or offline phone startup. Run it again after audio or receiver changes; use `CHIRP_TEST_ORIGIN` if port 8765 is occupied.

```bash
python3 -m http.server 8877 --bind 127.0.0.1
CHIRP_TEST_ORIGIN=http://127.0.0.1:8877 node scripts/mic-loopback.mjs
```

## Test setup

- Use a private room and tell everyone nearby that the spoken and acoustic message is a **TEST**. Use no live venue PA system or public crowd. A powered laptop speaker is enough for this first gate.
- Use the strict TEST mode (`?strict=1` on console and receiver), a local demo venue secret, and an HTTPS receiver origin each phone can open. Record commit, URL origin, device model, OS/browser version, speaker, protocol, volume, approximate room noise, and test date. Never record the secret key. The default full feature demo has broader alert types; test those only with a separate explicit TEST briefing and the on-screen TEST warning.
- On each phone while online: open the receiver, refresh it twice after any service-worker update, select English or Spanish, tap **Start listening**, grant mic permission, and keep the screen unlocked and app foregrounded. Confirm the TEST-only banner and hypothetical Gate C/D wording. The Spanish draft has not had native-speaker review.
- Switch off cellular and Wi-Fi **after** the app is cached. Reload the receiver at the same origin. It must open and let you start listening without network. Record this as a separate pass/fail; a page that remains open without a reload has not proved offline startup.
- On the console, paste only `keys/coliseum-ops.secret` into the TEST key field. Do not copy the key into a screenshot or shared document. Use the signed TEST button, one repeat for latency measurement, and the same protocol/volume for all trials in a set.

## Measurement

First open `/range/` on each phone and send ten numbered **unsigned TEST patterns** from the console at 1 m in a quiet room. Log sent and decoded counts. Repeat at 3 m and with background noise. This measures the acoustic link without showing crisis instructions. Then, in strict mode, transmit ten **new** signed Gate C TEST packets to each of two phones, one in English and one in Spanish. Wait out the 60 s same-zone cooldown or reset the console between independent trials only if the test log says so. Record each trial, including failures. Repeat after a speaker-off check. Do not count a digital loopback as a phone trial.

| Trial | Phone | Radio off + offline reload passed? | Distance / noise | Protocol / volume | Packet start time | Card visible time or timeout | Correct signed TEST card? | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |

Use a synchronized wall clock or a video with both laptop and phone in frame to measure latency. Record the full transmitted duration separately. One-minute expiry means a late or delayed decode may be correctly rejected; note it rather than repeating until success.

## Safety and failure checks

1. With the strict receiver's `?strict=1&debug=1` paste box, test malformed text, a validly encoded packet with a bad signature, an expired packet, and a signed emergency type. None should create a card or vibrate. This is a **software-path check**; repeat through the actual speaker path before claiming acoustic rejection. In default full mode, the signed emergency type is intentionally displayed as a TEST simulation.
2. Close and reopen the receiver after a signed TEST card. Its history must reverify the stored wire. A forged `chirp.history` entry must not display as verified. The Node policy test covers the wire verifier; the phone reload checks storage integration.
3. Turn the speaker off for one send. Record no reception as the expected result. Restore it and confirm the normal TEST packet can be heard again.
4. Tap the local help-note control while offline. It must say **NOT DELIVERED**. No human handoff, Retell call, or dispatcher response is established by this test. In default full mode, test the help chirp separately and verify that a real console microphone records it before claiming that path works.
5. Count phones or people in the room without a preloaded, unlocked, listening receiver. This is the **unreached group**, even if they are within speaker range.

## Badge, alarm and shelter-screen checks (full mode)

Software path checked in desktop Chromium with `?debug=1` paste (dev2 branch, Oct 17): a signed alert shows **✔ Demo signature**, vibrates, flashes and is announced to screen readers; an exact repeat adds no card; an expired signed alert shows a grey **⏱ This alert has expired** card with no vibration, tone or flash; an unsigned alert shows **⚠ UNVERIFIED** with no vibration, tone or flash; all three survive a reload. **Not yet checked on a phone or through a speaker.** Repeat each over audio:

1. Play `docs/demo-audio/expired.wav` near a listening phone → Expired card, no buzz.
2. Console spoof button → UNVERIFIED card, no buzz.
3. Signed alert → Android vibrates, both phones sound a ~4 s hi-lo alarm (1.6/1.2 kHz, below the chirp band, Silence button) and flash.
4. iPhone VoiceOver / Android TalkBack on → the new alert is read out once (not again every 30 s).
5. Shelter screen: open `/receiver/?kiosk=1` on a laptop (optional `&langs=en,es,zh,ko`), tap Start. Check: fullscreen, header says **Mic OK**, screen stays awake for 10+ min, a signed alert shows huge text in all listed languages and sounds a ~8 s siren with a **Silence alarm** button. Unplug/replug the mic or switch tabs and back: header shows **Mic restarting…** then **Mic OK**, and the next chirp still decodes.

## Go/no-go for a stage demonstration

At least 8/10 correct receives at 1 m in a quiet room on each tested phone is a **demo feasibility threshold only**. If either phone fails, show the real failure and use the tested single-phone scope; do not claim a reliable safety service. If no physical speaker-to-phone receive succeeds, present the signed packet and digital loopback as an engineering prototype and remove claims of a working acoustic phone demo.

The final evidence should report numerator and denominator per device and condition, median observed latency, offline reload result, negative-case result, exact commit, and the number of unreached people. Leave untested fields blank or `null`; never fill them from the Node loopback.
