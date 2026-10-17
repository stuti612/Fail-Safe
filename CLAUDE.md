# CLAUDE.md: CHIRP (Team Fail Safe)

> **Read this file first in every Claude session on this repo.**

---

## 1. CHIRP in one paragraph

**CHIRP turns any speaker into a signed, offline, multilingual alert channel.** An operator's console (on a **responder's phone**, or a laptop) encodes a short **signed code** as an audible chirp, a few seconds of sound, using data-over-sound (ggwave). Any phone within earshot with the CHIRP receiver open decodes it **with no cell signal, Wi-Fi or account**. The phone verifies the signature and shows the alert **in the phone owner's chosen language**, from a fixed, pre-written phrasebook. No AI translation happens at receive time.

**One line:** _Alerts carried by sound: one chirp, every language, no network._
**Pitch close:** _"Today's alerts wake you up. CHIRP works when they can't reach you, and speaks your language."_
**Pitch line:** _"Any responder's phone plus any loudspeaker becomes a multilingual alert channel. No new hardware."_

### The broadcaster is a phone, not a laptop

The console is a web page, so it runs on the phone a responder already carries. **The phone decides and signs; a loudspeaker carries the sound.** A phone speaker alone reaches only a few meters, so in the field the phone connects over **Bluetooth or an audio cable** to whatever is loud: a fire-truck loudspeaker, a stadium PA, a megaphone, a portable Bluetooth speaker. A laptop console stays supported (control rooms, backup).

---

## 2. Event facts

| Item               | Detail                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event              | InnovateLA × Dual-Use Hackathon F26, USC, Oct 16–18 2026                                                                                                                                                        |
| Team               | **Fail Safe**                                                                                                                                                                                                   |
| Lens               | **Resilience Comms** (sponsor **Retell AI**). Also entering **Best Build with IBM Bob** (all-lens)                                                                                                              |
| Devpost submission | **Sat Oct 17, 10:00 PM, no extensions.** Aim for a complete draft by **8:30 PM** and final by 9:30 PM                                                                                                           |
| Floor demo         | Sun 12:00–2:30 PM, Ginsburg Hall, **3 minutes, working thing first** (Best Demo, People's Choice)                                                                                                               |
| Finals             | 7 finalists named by Sat midnight. Finalist deck due Sun 9 AM. Pitch Sun 1:15 PM: **5 min (demo included) + 5 min Q&A**                                                                                         |
| Devpost needs      | Name, lens, one line, pitch deck (**≤10 slides**), demo video (**<3 min**), repo, all teammates, **responsible-use note**, tools used (honest, incl. AI tools), "How we used IBM Bob" section, poster (Twist 3) |
| Video rule         | If we used Retell or IBM Bob, the video must show our prompts                                                                                                                                                   |

**Scorecard (1–5 each):** dual-use fit (**breaks ties**) · technical execution · feasibility and impact · adapting to twists · demo and pitch.

**Resilience Comms lens criteria (judged with Retell):**

- **Technical depth:** a working voice, text or messaging flow (Retell voice agents encouraged).
- **Feasibility:** works when networks are weak or people speak different languages.
- **Impact:** reaches people that today's alerts miss.
- **Dual-use:** useful for everyday service and still works in a crisis.

---

## 3. The brief we answer

Automated systems misbehave. The usual response is a **"bang"**: shut it down, alert everyone at once. A bang works, but often costs more than the problem. The challenge is to find **the gentlest response that still works** for **one person who has to decide**, be **pre-emptive rather than reactionary**, and be useful on an **ordinary day** too.

**The ladder:** watch → ask → slow → hold → hand to a person. A build lives on one or two rungs. The hub's hint: the easiest way to show dual-use fit is to **name the second customer and the day they would use it**.

**Our four choices:**

| Choice              | CHIRP's answer                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person who decides  | The **operator who approves an alert**: a fire captain or incident commander deciding _who_ to warn; on ordinary days, a venue or transit operations lead                                   |
| Moment              | Crisis: evacuating specific blocks while cell service is down or jammed. Ordinary day: a gate jam at the Coliseum or SoFi, or a Metro reroute                                               |
| Second customer     | **"Tuesday, 6:40 PM: Coliseum event-ops lead re-routing 70,000 fans after a gate jam."** Venues and transit (SoFi, the Coliseum, LA Metro) for LA28. Also SCE planned power shutoffs (PSPS) |
| The bang we replace | A countywide push alert, like the **Jan 2025 LA County false evacuation alert (~10 million phones)**. CHIRP reaches only phones in earshot                                                  |

**Ladder mapping in the build:**

- **WATCH:** the receiver listens offline.
- **ASK:** "I need help" form sends a reply chirp and a POST; Retell `report_need`.
- **SLOW:** 60 s repeat cooldown per alert and zone, typed SEND for wide zones, 12 h validity cap.
- **HOLD:** an unsigned chirp is shown as UNVERIFIED and never buzzes.
- **HAND TO A PERSON:** a human approves every alert. A ranked help queue where a named person closes each entry, a Retell transfer to a human, and a callback ladder ending in a door knock.

---

## 4. The problem

1. **Language.** LA announcements and alerts are mostly in English. Millions of residents and LA28 visitors speak Spanish, Korean, Chinese, Tagalog, Vietnamese, Armenian and more.
2. **Networks fail.** In disasters (Jan 2025 Eaton and Palisades fires), towers lose power or jam, so phone alerts may never arrive.
3. **Over-reach.** Alerts can hit far too many people. The Jan 2025 false alert reached about 10 million phones countywide.

Sound is hyperlocal by physics, needs no network, and each phone renders it in its own language.

**CHIRP complements WEA; it does not replace it.** Wireless Emergency Alerts (AMBER, evacuation) are built into phones and carriers, so they wake a phone in a pocket and sound through silent mode, but they need working towers. A third-party app cannot trigger that override. Say it this way: _the siren gets your attention; CHIRP tells you what it means, in your language, when the network can't._

---

## 5. Users

| User                   | Who                                                                                                                                                         | What they do                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operator (decider)** | Incident commander, fire captain, venue or transit ops lead                                                                                                 | On **their own phone** (or a control-room laptop): picks a code and zone in the console, previews all languages, **approves**, broadcasts through a connected loudspeaker |
| **Receiver**           | Anyone nearby with the receiver open: residents, fans, riders, non-English speakers, **deaf and hard-of-hearing people** (sound becomes text and vibration) | Picks a language, taps Start listening, sees verified alerts, can tap "I need help"                                                                                       |
| **Shelter screen**     | A spare laptop or tablet in shelters, buses, senior centers                                                                                                 | Always listening, huge text, loud. Stands in for ~$15 dedicated receivers (future)                                                                                        |
| **Phone-line caller**  | People without smartphones                                                                                                                                  | Calls the Retell line, hears current alerts read aloud in their language, can be handed to a human                                                                        |
| **Second customer**    | SoFi, the Coliseum, LA Metro, SCE                                                                                                                           | Uses it every event day for multilingual wayfinding and notices                                                                                                           |

---

## 6. Architecture and file map

The most complete code is on branch **`agents-claude-codex`** (last commit ~4:28 AM). `main` has the 2 AM scaffold only. **Decide at kickoff whether to merge the branch into `main` via PR.** Humans work on `main`. Agent work goes on `agents-claude-codex` and merges via PR.

```
console/        Broadcaster console (must work at PHONE width, also laptop): compose → preview all languages → sign → encode → play
  app.js          main UI, log, spoof button, "Send test pattern"
  cap.js          CAP 1.2 / IPAWS import (paste XML → codes + zone)   [Twist 1 build]
  slow.js         SLOW rung: cooldown + typed SEND for wide zones
  speak.js        Spoken fallback after signed chirps (OS voices, phrasebook text)
  helpqueue.js    Ranked help queue: call back / escalate / close by a named person
receiver/       Phone PWA: tap to listen → decode → verify → localized alert,
                "I need help" (reply chirp + POST), Retell call button, ?debug=1 paste box
range/          Range-test logger page with CSV export
server/         Help server + Retell webhook/functions (MOCK mode without RETELL_API_KEY)
  server.mjs, core.mjs
shared/
  payload.js      Wire format v1 (pack/unpack, base64)
  trust.js        Ed25519 sign/verify against TRUSTED_KEYS
  keys.js         GENERATED public keys of trusted agencies (scripts/genkeys.mjs)
  audio.js        ggwave wrapper: initAudio / encode / play / listen (ONE instance)
  receive.js      Dedupe (signer+msgId), expiry, zone-distance check
  help.js         Reply-chirp codec (18 B → 24 chars, 1.45 s FASTEST)
  phrasebook.json Alert types, details, UI strings × 9 languages
  phrasebook.js   describe(alert, lang)
  zones.json      Zone id → LA place, lat/lon, radius, "wide" flag
  cap-map.json    CAP event/SAME code → phrasebook code
  config.js       RETELL_PHONE, HELP_ENDPOINT (empty), STRICT_DEMO (?strict=1)
  demo-policy.js  STRICT_DEMO acceptance rule (one signed TEST code)
vendor/         ggwave.js 0.4.0 (wasm inline), tweetnacl 1.0.3 (vendored for offline)
sw.js           Service worker: caches static files. **Bump VERSION when cached files change** (currently chirp-v11)
scripts/        genkeys.mjs · selftest.mjs · server-safety.mjs · sw-cache-safety.mjs ·
                test-demo-policy.mjs · mic-loopback.mjs (Playwright) · funding-evidence.mjs
keys/           Agency SECRET keys. Gitignored. **Never commit.**
retell/         agent_prompt.md + function schemas (get_active_alerts, report_need)
docs/           TWISTS.md, TWIST1_VERIFIED.md, DEVICE_TEST.md, IBM_BOB_LOG.md, samples/ (CAP XML)
AGENTS.md, HANDOFF.md   Message board and file locks when two coding agents share the repo
```

**Modes:** default = full mode. `?strict=1` = STRICT_DEMO, a TEST-only scope: one signed Coliseum Gate C TEST code, 1-minute validity, en/es only, CAP preview-only.

---

## 7. Wire format, codes, languages, zones

**Wire format v1 (`shared/payload.js`):** 11-byte body + 64-byte Ed25519 signature, base64 → **100 characters** (ggwave max ~140).
Body: `version(1) type(1) detail(1) zone(u16) expiresUnixMinutes(u32) msgId(u16)`.
Only **codes** go on air, never free text. Each phone renders the code from its own phrasebook.

**Alert types (append-only; never renumber):**
1 EVACUATE · 2 EVACUATION_WARNING · 3 SHELTER_IN_PLACE · 4 ROAD_CLOSED · 5 GATE_CHANGE · 6 BOIL_WATER · 7 POWER_SHUTOFF · 8 COOLING_CENTER_OPEN · 9 SMOKE_AIR · 10 AUTONOMOUS_HAZARD · 11 ALL_CLEAR · 12 TEST · 13 OFFICIAL_ALERT (generic CAP fallback)

**Details:** 0 NONE · 1–4 GO_NORTH/SOUTH/EAST/WEST · 5 NEAREST_EXIT · 6 FOLLOW_STAFF · 7 AVOID_AREA · 8 INDOORS_CLOSE_WINDOWS · 9 CHECK_NEIGHBORS · 10 TUNE_RADIO (KNX 1070) · 11 NEXT_OPEN_GATE · 12 BRING_ESSENTIALS · 13 DEMO_GATE_SCENARIO

**Languages (9):** English (reviewed), Spanish, Chinese, Korean, Tagalog, Vietnamese, Japanese, Portuguese, Russian (**not yet reviewed by native speakers**; set `reviewed: true` only after a human check).

**Zones:** 1–2 Altadena · 3–4 Pacific Palisades · 5 Malibu PCH · 10 Coliseum Gate C · 11 Coliseum all gates (wide) · 12 SoFi North entry · 20 Metro 7th St/Metro Center · 21 Union Station · 30 USC Ronald Tutor Hall · 99 LA County countywide (wide).

**Trusted demo agencies:** LA County OEM and Coliseum Event Ops (shows dual use).

**Receiver outcomes:**

| Status     | When                         | Display                                                                                                                               |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Verified   | Valid signature, not expired | Full alert in the chosen language; tone, flash; vibration on Android (quiet only if GPS positively places the phone outside the zone) |
| UNVERIFIED | Missing or invalid signature | Grey card, **never buzzes** (HOLD rung)                                                                                               |
| Expired    | Valid signature, past expiry | Marked expired, no alarm (blocks replayed recordings)                                                                                 |

---

## 8. Non-negotiable rules

1. **A person approves every alert.** Nothing broadcasts automatically. CAP import maps to codes and still requires operator review.
2. **No AI translation on air or at receive time.** Only pre-written phrasebook text, checked by native speakers.
3. **Receivers never track people.** No analytics. The only outbound traffic is the opt-in "I need help" POST, sent when online.
4. **Signing keys:** secret keys live only on the operator's device (`keys/` locally) and are never committed. Public keys are bundled in `shared/keys.js`. Phones get lost, so in the product the key is locked behind the phone's Face ID, fingerprint or passcode, issued **short-lived per shift or incident**, and revocable. For the demo, the key is pasted into the console and not stored.
   4b. **Approve stays mandatory on a phone:** big buttons, a full-screen preview, and a clear confirm step. A small screen under stress must not make sending easier than checking.
5. **Phrasebook codes are append-only.** Renumbering would make old phones show the wrong text.
6. **Validity is capped at 12 h** to bound replay. Revocation (cancel or all-clear flow) is still open.
7. **Every inbound call without a recorded need goes to human review.** We never automate "this caller needs nothing." Silence or voicemail never counts as reached.
8. **Honesty labels stay on:** unreviewed translations, demo keys, "NOT DELIVERED" while offline, "signed demo alert" (not "official").
9. **No fabricated stats or claims.** Measured numbers only; label anything synthetic or unverified. CHIRP has **no agency authority** and no IPAWS connection.

---

## 9. Technical gotchas

- **Turn off mic processing:** `echoCancellation`, `noiseSuppression` and `autoGainControl` must be false, or the browser filters out the chirp. `audio.js` already does this.
- **Exactly one ggwave instance per page.** Extra instances silently break decoding.
- **Base64 over the air.** ggwave's JS `encode` UTF-8-encodes strings, so raw binary gets corrupted.
- **HTTPS required on phones** for the mic. Use GitHub Pages or a tunnel (`npx localtunnel --port 8000`, ngrok). `localhost` works on a laptop.
- **Audio starts only after a tap** (iOS), hence the "Start listening" button. Wake Lock keeps the screen on.
- **iPhone Safari has no vibration.** Use Android for the buzz moment.
- **Audible protocols only.** Ultrasonic won't survive PAs or radio. Default **AUDIBLE_FAST 6.83 s**, FASTEST 3.75 s, NORMAL 9.90 s for a 100-char signed alert.
- **Service worker:** bump `VERSION` in `sw.js` whenever a cached file changes, and reload phones online once so the new cache is active before going offline.
- Run `node scripts/selftest.mjs` after touching `payload.js`, `trust.js`, `audio.js`, `help.js`, `receive.js` or `cap.js`.

**Run it:**

```bash
node scripts/genkeys.mjs        # once: keys/*.secret + shared/keys.js
node scripts/selftest.mjs       # sign + audio round-trip, no browser (84/84 on the branch)
python3 -m http.server 8000     # open http://localhost:8000
CHIRP_SUPERVISOR_TOKEN=… CHIRP_APP_ORIGIN=http://localhost:8000 node server/server.mjs   # help queue + Retell (127.0.0.1:8787; MOCK without RETELL_API_KEY)
```

In the console, paste the contents of `keys/la-county-oem.secret` into the key box.

---

## 10. Prototype now vs product later

- **Today's prototype:** the receiver is a **web page that must be open** and listening. That is all the demo needs. The console runs on a phone connected to a Bluetooth speaker.
- **Real product:** an **app installed once** with an **"alert mode"** that turns on listening when it matters: an event you attend, a fire-weather warning (sent as a normal push while the network still works), or always on by choice.
  - **Android:** a foreground service with a mic and a permanent notification. It can sound a loud full-screen alarm on a locked phone. Workable.
  - **iPhone:** harder. Background listening needs an active audio session (orange mic dot). Sounding through silent mode needs Apple's **Critical Alerts** entitlement, granted only to approved public-safety apps.
  - Costs on both: battery, and the trust question of an always-on mic. Decoding happens on the device and nothing is sent.
- **Broadcaster app:** the console as a responder app with the signing key in the phone's secure hardware, short-lived keys, one-tap pairing to the truck's loudspeaker or venue PA.
- **Long term:** OS-level support (like Android's earthquake alerts), **~$15 shelter receivers** (mic, screen, buzzer), and a pilot at SoFi or LA Metro.
- **Don't build today:** native apps, background listening, push notifications, accounts, free-text messages.

---

## 11. Status (from CONTEXT.md, branch snapshot Sat ~4:28 AM)

**Done and passing in software:** console (compose, preview, sign, play, spoof, test pattern, CAP import, SLOW rung, spoken fallback, help queue) · receiver (listen, verify, localized card, UNVERIFIED, dedupe, expiry, GPS zone check, help form, offline SW v11) · range page · help server + Retell webhook/mock · gates: selftest 84/84, server-safety 7/7, sw-cache-safety, test-demo-policy, mic-loopback (digital).

**Not yet done or verified:**

1. **Real speaker → phone test.** Nothing acoustic has been tested yet. Follow `docs/DEVICE_TEST.md`.
2. **GitHub Pages deploy** (phones need HTTPS). Needs a human push.
3. Merge `agents-claude-codex` → `main` (decision pending).
4. Retell agent and number created; `RETELL_PHONE` and `HELP_ENDPOINT` set; one real call tested.
5. Native-speaker review of the top codes and the help UI strings.
6. **Shelter-screen (kiosk) mode:** not built.
   6b. **Console on a phone:** not yet tested at phone width or playing from a phone into a Bluetooth speaker.
7. Demo audio files: one tampered and one **expired** signed chirp saved for the live demo.
8. Twist 2 response written; Twist 1 proof clip; deck, video, Devpost.

---

## 12. Plan for the rest of Saturday: 3 developers + 1 presenter

Split by code area so nobody edits the same files. **Each person edits only their own files.** Shared files (`console/index.html`, `CONTEXT.md`, `sw.js`): small edit, commit at once. A separate **presenter** owns the deck, poster, video edit, Devpost text and pitch, and receives clips and numbers from the developers.

### Dev 1: Platform and Broadcaster (the responder's phone)

**Owns:** `console/` (except `helpqueue.js`), `shared/payload.js`, `trust.js`, `keys.js`, `cap-map.json`, `sw.js`, `scripts/`, deployment.

1. **By 2:00 PM:** merge `agents-claude-codex` → `main`; `selftest` 84/84.
2. **By 2:15 PM:** **GitHub Pages live**; post the HTTPS link to the team (everyone is blocked on this).
3. Generate demo keys; console signs and plays on repeat.
4. **Console on a phone:** phone-width layout (stacked, large buttons, full-screen preview, clear Approve), plays the signed chirp from the phone into a Bluetooth speaker. Key pasted, never stored.
5. Save demo audio: one **tampered** chirp and one **expired** signed chirp.
6. Record the **Twist 1 proof clip**: CAP sample → chirp → Spanish phone.
7. Owns `sw.js` VERSION bumps; others ask Dev 1.
   **To presenter:** live link, CAP clip, demo audio files, clip of a phone console driving the speaker.

### Dev 2: Receiver and device testing (the public's phones)

**Owns:** `receiver/`, `range/`, `shared/receive.js`, `shared/style.css`, `docs/DEVICE_TEST.md`.

1. **2:15–3:00 PM:** first **real speaker → phone test** (iPhone + Android, Wi-Fi off) per `DEVICE_TEST.md`; fix what breaks. **Top risk: nothing acoustic is tested yet.**
2. **3:00–4:30 PM:** **shelter-screen kiosk mode** (`?kiosk=1`): huge text, always listening, loud, Wake Lock.
3. Accessibility: contrast, screen-reader announcement, flash.
4. **4:30–6:00 PM:** **range test** (1, 3, 5–10 m; quiet and crowd noise; both phones; console on a phone + Bluetooth speaker); export CSV.
5. Verify badges: verified buzzes, unverified never buzzes, expired marked, repeats shown once.
   **To presenter:** range CSV/table, screen recording of phones lighting up in airplane mode.

### Dev 3: Voice, languages and the help flow

**Owns:** `server/`, `retell/`, `shared/help.js`, `shared/config.js`, `shared/phrasebook.json`, `shared/zones.json`, `console/helpqueue.js`.

1. **2:00–3:30 PM:** **Retell agent** from `retell/agent_prompt.md`, phone number, `server.mjs` behind a tunnel, set `RETELL_PHONE` and `HELP_ENDPOINT`, one real inbound call (the lens's "working voice flow").
2. **3:30–4:30 PM:** "I need help" end to end: phone → console help queue → closed by a named person.
3. **Translations:** native speakers for Spanish, Korean, Chinese, Tagalog first; fix text; set `reviewed: true` only after a human check.
4. **Twist 2 build proof:** add a new language (e.g. Armenian) **via phrasebook only, no code change**, and show it working.
5. **6:00 PM go/no-go:** if Retell isn't working, switch it off cleanly; keep honesty labels.
   **To presenter:** recorded Retell call, added-language clip, list of reviewed languages.

### Check-ins

| Time    | Check                                                       |
| ------- | ----------------------------------------------------------- |
| 2:15 PM | Pages live; chirp decodes on both phones over HTTPS         |
| 4:30 PM | Full flow offline, console on a phone works. Feature freeze |
| 6:00 PM | Retell go/no-go; all clips to presenter                     |
| 7:00 PM | Bug fixes only; demo video recorded with all three devs     |
| 8:30 PM | Devpost draft submitted (presenter)                         |

**Sunday:** Dev 1 runs the **phone console** + speaker (laptop as backup), Dev 2 runs the receiver phones + shelter screen, Dev 3 is ready with a live Retell call, the presenter talks.

## 13. Testing plan

Play 10 signed chirps per row; record decodes (use `range/` and export CSV). Report failures too.

| Distance | Setting              | Speaker       | iPhone /10 | Android /10 |
| -------- | -------------------- | ------------- | ---------- | ----------- |
| 1 m      | Quiet                | Laptop        |            |             |
| 3 m      | Quiet                | Laptop        |            |             |
| 5–10 m   | Quiet                | Bluetooth     |            |             |
| 1 m      | Crowd noise          | Bluetooth     |            |             |
| 3 m      | Crowd noise          | Bluetooth     |            |             |
| 1 m      | Through a phone call | Phone speaker |            |             |

**Behavior checks:** works in airplane mode after first load · tampered → UNVERIFIED, no buzz · old chirp → Expired · repeats shown once · late opener catches the next repeat · all scripts render (Korean, Chinese, Japanese, Russian, Vietnamese) · shelter screen stays awake and alarms · screen reader announces the alert.

---

## 14. Demo plan

**Bring Sunday:** the **broadcaster phone** with the console + a loud Bluetooth speaker paired to it (laptop console as backup), 4 own phones preloaded in different languages (≥2 Android), shelter-screen laptop, printed QR codes, chargers, the **backup video**. Test in Ginsburg early. Keep the speaker within 1–2 m on the noisy floor.

**3-minute floor demo:**

| Time      | Action                                                                                                                                                                                 | Line                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0:00–0:20 | Everyone switches phones to airplane mode, visibly                                                                                                                                     | "Jan 2025: a mistaken alert hit ~10 million LA phones, and towers went down in the fires."     |
| 0:20–1:00 | Dev 1 taps Approve on the phone console; teammate announces "Gate C is closed, use Gate D" as the chirp plays; phones and shelter screen light up in Korean, Spanish, Chinese, Tagalog | "One chirp. Every language. No network."                                                       |
| 1:00–1:30 | Spoof button                                                                                                                                                                           | "A fake shows UNVERIFIED and never buzzes."                                                    |
| 1:30–1:50 | Play a recorded, expired signed chirp                                                                                                                                                  | "A replayed recording shows Expired."                                                          |
| 1:50–2:20 | A judge opens the page late and catches the next repeat                                                                                                                                | "It repeats, so latecomers still get it."                                                      |
| 2:20–3:00 | Range test slide                                                                                                                                                                       | "Today's alerts wake you up. CHIRP works when they can't reach you, and speaks your language." |

**5-minute finals pitch** (hub order): problem (0:30) → **working demo** → how it held up to the twists → where it goes (alert-mode app, Critical Alerts, $15 shelter receivers, SoFi or Metro pilot) and feasibility.
**Video (<3 min):** same order, one take, airplane icon visible. Show Retell or Bob prompts if used.

---

## 15. Twists and submission

| Twist                      | Response                                                                                                                                                                                                                                                                      | Build proof                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1. Federal funding pathway | **NSF SBIR Phase I** (America's Seed Fund): up to $305,000, 6–18 months, Project Pitch + invitation first. Research question: reliable authenticated acoustic reception through noisy venue speakers. No invitation or award yet. Paste-ready text: `docs/TWIST1_VERIFIED.md` | **CAP 1.2 / IPAWS import** in the console |
| 2. Make it global          | No towers or data plans needed; a new language = one phrasebook entry, a new region = zones.json. Works for World Cup and pilgrimage crowds, earthquake drills (e.g. Japan), regions with patchy coverage. **Still to write in `docs/TWISTS.md`**                             | Show a language added by config only      |
| 3. Poster                  | **Done:** CHIRP poster, 11×17 in. Add team name "Fail Safe" and the QR code to the deployed receiver; export PDF; upload with Devpost                                                                                                                                         | n/a                                       |

**Responsible-use note (draft):** Fake alerts are the main risk, so every chirp is signed and expires, and unsigned ones show as UNVERIFIED and never buzz. Phones only listen; nothing tracks people. A person approves every alert, translations are pre-written and human-checked, and CHIRP claims no agency authority.

**Devpost checklist:** name + lens + one line · deck ≤10 slides covering all 5 criteria · video <3 min · repo link · all teammates · responsible-use note · tools used (Claude Code, Codex, IBM Bob, Retell, ggwave, TweetNaCl) · "How we used IBM Bob" (`docs/IBM_BOB_LOG.md`) · poster · twist responses.

---

## 16. Honest limits (say them before judges ask)

- Phones in pockets won't hear it unless the page is open (today) or alert mode is on (future app).
- People without smartphones need the shelter screen, the spoken announcement or the Retell phone line.
- **Nothing acoustic has been measured yet.** Do not claim range or reliability until the device test is done.
- Not tested through a real PA system or KNX 1070 AM radio. Radio's narrow audio band may break decoding.
- CHIRP complements WEA and has no IPAWS connection. CAP is pasted by an operator.
- Replay is bounded by expiry (≤12 h), not prevented within that window. Revocation isn't built.
- Name clash: Chirp.io was a data-over-sound company acquired by Sonos (2020); LISNR does similar work. Our difference: **signed, multilingual public-safety alerts**.

**Facts to verify before they go on slides:** the Jan 2025 false alert date and phone count · cell outages in the Eaton and Palisades fires · LA28 visitor numbers and LA language count · current SBIR/STTR, DHS and FEMA program status.

---

## 17. Repo workflow

- Pull before working. Commit small; one short message line.
- Humans on `main` via PR; agent work on `agents-claude-codex`. With two agents, follow `AGENTS.md`: read `HANDOFF.md` and lock files before editing.
- Never commit `keys/`. Phrasebook codes are append-only. Bump `sw.js` VERSION when cached files change.
- Run the relevant test scripts after changes; paste results into `CONTEXT.md`.
- Log every IBM Bob use in `docs/IBM_BOB_LOG.md`.

**Fallback project:** GATEWISE (Ports & Logistics, terminal planner) is **frozen** and will not be submitted unless CHIRP becomes impossible to demo.

---

## 18. Glossary

| Term                 | Meaning                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| Chirp                | A few seconds of sound carrying a small piece of data                   |
| Data-over-sound      | Sending data as audio instead of over a network                         |
| ggwave               | Open-source library that encodes and decodes chirps                     |
| Ed25519 signature    | A cryptographic stamp only the real sender can make                     |
| Replay               | Recording a real chirp and playing it later or elsewhere                |
| WEA                  | Wireless Emergency Alerts: loud carrier-sent alerts (AMBER, evacuation) |
| CAP / IPAWS          | Common Alerting Protocol: the XML format of the US public alert system  |
| PWA / service worker | A web app that keeps working offline after the first load               |
| STRICT_DEMO          | `?strict=1` TEST-only mode                                              |
| PSPS                 | Public Safety Power Shutoff (SCE planned outages)                       |
| LA28                 | 2028 Los Angeles Olympic and Paralympic Games                           |
