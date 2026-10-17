# CHIRP: Project Context

> **Living file.** Read this before working on the repo, and update it whenever a decision, status, or measured fact changes. Newest entries go at the top of each log.

## 1. Event facts

- **Event:** InnovateLA x Dual-Use Hackathon F26, USC, Oct 16–18 2026
- **Submission deadline:** **Sat Oct 17, 10:00 PM on Devpost. No extensions.** Aim to submit by 9:30 PM.
- **Finals:** Sun 12:00–3:30 PM, Ginsburg Hall. Finalists' deck is due Sun 9 AM.
- **Lens:** Resilience Comms (sponsor **Retell AI**). Also entering **Best Build with IBM Bob**.
- **Twists:** Fri 11:30 PM, Sat 4:30 AM, Sat 7:00 AM (one flyer says 9:30 AM, so check the portal). Each response is due **within 6 hours**. Judges want build changes, not just slide changes.
- **Scorecard (1–5 each):** dual-use fit (breaks ties), technical execution, feasibility and impact, adapting to twists, demo and pitch.
- **Devpost needs:** name, lens, one line, deck, demo video, repo, all teammates listed, a **responsible-use note**, the tools used, and a "How we used IBM Bob" section.

## 2. The prompt, in one breath

Automated systems misbehave. The usual response is a "bang" (shut it down, alert everyone), and that often costs more than the problem. Find the **gentlest response that still works** for **one person who has to decide**. The ladder is **watch → ask → slow → hold → hand to a person**. It must be useful on an ordinary day too. Name the second customer.

## 3. What we're building

**CHIRP turns any speaker into a signed, offline, multilingual alert channel.**
A responder's console encodes a short **signed code** as an audible chirp (data-over-sound, using ggwave). Phones within earshot decode it **offline**, verify the signature, and show the alert in **the phone's own language** from a fixed phrasebook, so no AI translation is involved at receive time.

- **Decider:** the fire captain or incident commander choosing *who* to warn. The "bang" is a countywide push alert, like the Jan 2025 LA County false alert. CHIRP warns only the people within earshot.
- **Second customer (ordinary Tuesday):** "Tuesday, 6:40 PM, Coliseum event-ops lead re-routing 70,000 fans after a gate jam" → multilingual wayfinding for LA28. Also SCE planned power shutoffs (PSPS) and LA Metro.
- **Ladder mapping:** unsigned chirps are shown as UNVERIFIED and never buzz the phone (**hold**) · "I need help" is queued offline (**ask**) · Retell voice line in the caller's language reaches a human (**hand to a person**).

## 4. Architecture and file map

```
console/      Broadcaster console (compose → sign → encode → play, spoof button, log)
receiver/     Phone PWA (tap to listen → decode → verify → show in user's language,
              "I need help" offline queue, Retell call button, ?debug=1 paste box)
shared/
  payload.js     Wire format v1 (pack/unpack, base64)
  trust.js       Ed25519 sign/verify against TRUSTED_KEYS
  keys.js        GENERATED public keys of trusted agencies (scripts/genkeys.mjs)
  audio.js       ggwave wrapper: initAudio / encode / play / listen
  phrasebook.json  Alert types, details, UI strings × 9 languages
  phrasebook.js    Loads phrasebook + zones, describe(alert, lang)
  zones.json       Zone id → LA place name
  config.js        RETELL_PHONE, HELP_ENDPOINT (both empty for now)
vendor/       ggwave.js 0.4.0 (wasm inline), tweetnacl 1.0.3 (vendored, so it works offline)
sw.js         Service worker: caches everything, network-first. BUMP VERSION when files change.
scripts/      genkeys.mjs (demo agency keys) · selftest.mjs (Node end-to-end test)
keys/         Agency SECRET keys. Gitignored. Never commit.
retell/       Retell agent prompt and setup notes
docs/         TWISTS.md (twist responses) · IBM_BOB_LOG.md
```

**Wire format v1 (shared/payload.js):** 11-byte body + 64-byte Ed25519 signature → base64, **100 chars**.
Body: `version(1) type(1) detail(1) zone(u16) expiresUnixMinutes(u32) msgId(u16)`.
Codes are append-only. Never renumber a phrasebook code, because old phones would show the wrong text.

## 5. Measured facts (from `node scripts/selftest.mjs`)

| Protocol | Airtime for a 100-char signed alert | Node round-trip |
|---|---|---|
| Audible FASTEST | 3.75 s | ✅ |
| Audible FAST (default) | 6.83 s | ✅ |
| Audible NORMAL | 9.90 s | ✅ |

- ggwave raw bandwidth is about 8–16 bytes/s, with a max payload of about 140 bytes.
- **Gotcha:** ggwave's JS `encode` takes a JS string and UTF-8-encodes it, so raw binary gets corrupted. That's why we use base64.
- **Gotcha:** ggwave has a small fixed **instance limit**. Creating extra instances silently breaks decoding. Use exactly one per page (audio.js already does this).
- **Not yet measured:** real speaker→phone range and noise robustness. Test at 1 m, 3 m and 10 m in a loud room.

## 6. How to run

```bash
CHIRP_SUPERVISOR_TOKEN=… CHIRP_APP_ORIGIN=http://localhost:8000 node server/server.mjs   # help queue + Retell (127.0.0.1:8787; MOCK without RETELL_API_KEY)
node scripts/genkeys.mjs        # once: creates keys/*.secret and shared/keys.js
node scripts/selftest.mjs       # sign + audio round-trip check, no browser
python3 -m http.server 8000     # then open http://localhost:8000
```
- On a laptop, `localhost` counts as secure, so the mic works.
- **Phones need HTTPS.** Deploy with GitHub Pages (Settings → Pages → main / root), or tunnel with `npx localtunnel --port 8000` or ngrok.
- In the console, paste the contents of `keys/la-county-oem.secret` into the key box.
- On iOS: tap "Start listening" (required for audio), and keep the screen on (wake lock is requested automatically).

## 7. Sponsor tools

| Sponsor | Use | Status |
|---|---|---|
| **Retell AI** (our lens) | A multilingual voice agent: the "Call for help in my language" button, plus a call-in line for people without smartphones that reads the current alerts aloud. Never-automate rules hand calls to a human. Stretch goal: outbound callbacks for queued help requests ("what if they don't pick up?"). Use the $10 credits. | Prompt drafted in `retell/agent_prompt.md`. Agent and number not created yet |
| **IBM Bob** (all-lens prize) | Build real features in Bob (next up: CAP/IPAWS import, the help-request server, Retell webhook). Log every use. | Log template in `docs/IBM_BOB_LOG.md` |
| Southern California Edison (food sponsor) | Pitch only: SCE runs planned power shutoffs (PSPS). Our POWER_SHUTOFF code is a natural everyday customer | n/a |
| Terminal49 | Only if a twist pushes us toward ports (gate-queue chirps for truckers). Needs real API data | Not planned |

Be honest on Devpost: the base code was written with Claude Code, and we should name which features were built in Bob. The rules require listing all tools.

> **Branch (Sat ~4:20 AM, user):** agent work (Claude + Codex) goes on `agents-claude-codex`, not `main`. Five humans work on `main`; merge via PR. `main` has everything up to `ef58a32`.

## 7b. Lanes (two agents share this repo: pull first, commit small, stay out of the other lane's files)

> **USER DECISION (Sat ~4:00 AM), binding for both agents:** follow the user's P0/P1/P2 brief in full. CAP import **broadcasts**; phones accept all signed phrasebook alerts; unsigned chirps are **shown as UNVERIFIED and never buzz** (HOLD rung); "I need help" still POSTs to HELP_ENDPOINT when online. Codex's TEST-only scope (`shared/demo-policy.js`, TEST ONLY banners, 1-min validity, locked languages, CAP broadcast disabled) stays **only behind `STRICT_DEMO` in `shared/config.js`, default `false`**. Honesty labels (unreviewed translations, demo keys, "NOT DELIVERED" while offline) are welcome and stay on in both modes. Codex: please commit your current work as-is; Claude will wire the flag on top.

- **Claude Code:** P0.1 CAP import (`console/cap.js`, `shared/cap-map.json`, `docs/samples/`), P0.2 spoken fallback (`console/speak.js`), P2.6 SLOW rung, STRICT_DEMO flag, P1.3 reply-chirp codec + console help queue (`shared/help.js`, `console/helpqueue.js`), P1.4 Retell webhook/mock (`server/`), selftest cases for those.
- **Codex:** P1.3 receiver side of "I need help" (encode + play reply chirp, coarse GPS, POST), P1.4 Retell dashboard agent + number, P1.5 replay/zone safety, P2.7 range test.
- Shared files (`console/index.html`, `console/app.js`, `sw.js`, `CONTEXT.md`, `scripts/selftest.mjs`): small surgical edits, commit right away.

## 8. Status

**Sat ~3:30 PM (Dev 2): receiver, badges, kiosk.** Branch `dev2`.
- Expired signed chirps now show a grey **Expired** card, no buzz/tone/flash (fixes the demo beat 1:30 gap). Three badges: Demo signature / UNVERIFIED / Expired.
- Verified alerts: Android vibration + 2-beep tone (660/880 Hz, below the chirp band) + 3-flash screen flash; screen readers announce each new alert once.
- **Shelter screen `?kiosk=1`** (`&langs=en,es,zh,ko`): huge text, stacked languages, ~6 s siren with Silence, fullscreen, wake lock, mic watchdog.
- Contrast to WCAG AA for severe/moderate fills (`shared/style.css`); receiver restyled.
- Checked in desktop Chromium via `?debug=1` paste only. selftest 84/84, demo-policy, sw-cache-safety, server-safety 8/8 PASS. **No real speaker → phone test yet.** sw.js not bumped (network-first, so online reload picks it up; Dev 1 may bump).

**Sat ~2:45 PM (Dev 1): console on a phone.**
- Every signed broadcast (compose and each CAP area) now opens a **full-screen review**: the alert card, every language, validity, signer, and airtime before Approve (app phones get it in 6.8 s; full broadcast ≈ N s). Big Approve and Cancel buttons. A wide zone needs SEND typed in the review (replaces `prompt()`). Over 3 spoken languages shows a warning. The spoof button skips the review (attack demo).
- Speech is **interleaved** with the repeats (chirp, lang 1, chirp, lang 2), so no language waits behind every repeat. Default spoken languages are `en es`.
- Phone layout (≤600 px): stacked fields, 48 px buttons, tables scroll sideways. All styles in `console/index.html`; `shared/style.css` untouched.
- Checked in headless Chrome at 390×844: cancel sends nothing, wide zone stays locked until SEND, Approve plays, CAP sample 1 goes through the review. selftest 84/84, sw-cache-safety and demo-policy PASS. sw `chirp-v13`. **Not yet tried on a real phone + Bluetooth speaker.**

**Sat 1:50 PM (Dev 1):**
- `agents-claude-codex` merged into `merge-agents` → **PR #2 to main** (awaiting merge). Gates on the merge: selftest 84/84, server-safety 8/8, sw-cache-safety, test-demo-policy all PASS.
- **Demo keys regenerated** (old secrets were not in the repo). `shared/keys.js` updated, sw `chirp-v12`. Secrets live only on Dev 1's laptop in `keys/`. Any chirp signed with older keys now shows UNVERIFIED.
- **Demo audio:** `docs/demo-audio/tampered.wav` (Gate C alert flipped to EVACUATE after signing → UNVERIFIED) and `expired.wav` (valid coliseum-ops signature, expired 1 h before generation). `node scripts/make-demo-audio.mjs` regenerates them; rerun if the keys change.
- **Gap (Dev 2):** the receiver drops expired chirps silently (`receiver/app.js` onChirp → `ignored expired chirp`), so demo beat 1:30 ("shows Expired") shows nothing yet.
- GitHub Pages: needs a repo admin (stuti612).

**Snapshot at push (Sat ~4:15 AM):**
- **Ladder in the build:** WATCH (receiver listens offline) → ASK (help form → reply chirp + POST; Retell `report_need`) → SLOW (60 s repeat cooldown, typed SEND for wide zones, 12 h validity cap) → HOLD (unsigned = UNVERIFIED, never buzzes; STRICT_DEMO) → HAND TO A PERSON (ranked help queue, a named person closes each entry, Retell transfer, callback ladder ending in a door knock).
- **Gates, all green:** `node scripts/selftest.mjs` 84/84 · `scripts/server-safety.mjs` 7/7 · `scripts/sw-cache-safety.mjs` · `scripts/test-demo-policy.mjs` · `scripts/mic-loopback.mjs` (needs Playwright).
- **Verified only in software/headless browser.** Not yet tested: speaker → phone acoustics, a real Retell call/number, spoken fallback with real OS voices, GitHub Pages deploy.
- **Receiver buzz rule fixed (Codex, fe74fd5):** a verified alert buzzes unless GPS positively places the phone outside the zone; no fix → still buzzes. Strict TEST mode stays quiet.
- Service worker cache: `chirp-v11` (includes `range/` and the revised receiver).

**Done (Sat ~4:10 AM, Claude + Codex reviews):**
- Server hardened against Codex's 7-case gate (`scripts/server-safety.mjs` 7/7): supervisor token, every un-recorded call goes to human review, en+es life words, PII retention 1 h/24 h, refuses a corrupt queue. Outbound callback ladder: call → retry → SMS (no provider: skipped, logged) → door knock; silence/voicemail are never "reached".
- Validity capped at 12 h on console and receiver (bounds replay). The CAP batch stops on the first failure.
- P2.7 range test: console "Send test pattern" + `range/` logger page with CSV export. `scripts/mic-loopback.mjs`: real ggwave audio fed as the browser mic → range 3/3 + receiver shows the signed alert (digital, not acoustic).
- `retell/agent_prompt.md`: setup + function schemas matching the server.

**Done (Sat ~3:55 AM, Claude):**
- STRICT_DEMO flag (`?strict=1`): Codex's TEST-only scope. The default full mode restores CAP broadcast, the HOLD rung (unsigned = UNVERIFIED, no buzz), the receiver help form → reply chirp + POST, a GPS "another area" check, and the console HELP QUEUE.
- `shared/help.js` reply-chirp codec (18 B → 24 chars, 1.45 s FASTEST). `shared/receive.js` (dedupe by signer+msgId, expiry, zone distance). `server/` help server + Retell webhook/functions + mock mode.
- selftest 71/71. Headless e2e passes for both modes. Real-device and real-Retell tests are still pending.

**Done (Sat ~3:45 AM, Claude, earlier):**
- SLOW rung (`console/slow.js`): same alert to same zone blocked for 60 s; wide zones (`"wide": true` in zones.json: Coliseum all gates, new zone 99 LA County countywide) need typed SEND confirm. 6 selftest cases, browser-checked.
- CAP/IPAWS import in the console (`console/cap.js`, `shared/cap-map.json`, 3 samples in `docs/samples/`). 18 selftest cases. New phrasebook type 13 OFFICIAL_ALERT (generic fallback).
- Spoken fallback (`console/speak.js`): after a signed chirp, the console reads the alert aloud in the chosen languages (OS voices, offline where installed). Log shows chirp + speech + total airtime. Not yet measured on real speakers.

**Done (Sat ~2 AM):**
- Repo scaffold. Wire format, signing and phrasebook (12 alert types, 13 details, 9 languages: en es zh ko tl vi ja pt ru).
- Self-test passing: sign → audio → decode → verify works, and tampered or random signatures are rejected.
- Console: compose, sign, play, spoof button, multilingual preview, log.
- Receiver: listen, verify, localized alert card, unverified styling, dedupe, expiry, help queue, offline service worker, debug paste.

**Not yet verified in a real browser.** First task: laptop speaker → phone mic test.

## 9. Next steps (in priority order)

1. **Push + deploy** (GitHub Pages) so phones get HTTPS. Push needs a human (the agent's push was blocked).
2. **Real-device test** with the range page (`docs/DEVICE_TEST.md`): laptop speaker → 2 phones, Wi-Fi off, 1/3/10 m, quiet + noisy. Export CSV for slides.
3. Twist 1 proof clip: CAP sample → chirp → phone shows Spanish. Then restore the CAP claim in TWISTS.md. Measure spoken-fallback airtime (which on-device voices exist?).
4. Retell: create the agent from `retell/agent_prompt.md`, tunnel `server/server.mjs`, set RETELL_PHONE / HELP_ENDPOINT. Test one real inbound call + one callback.
5. Native-speaker review of the top 5 codes + the new help UI strings. Set `reviewed: true`.
6. Revocation beyond expiry (cancel / ALL CLEAR flow), still open.
7. Twists 2 and 3.
8. Deck, demo video (by 7 PM), Devpost (by 9:30 PM).

## 10. Twist log

- **Twist 2 (Sat 4:30 AM): make it global.** Written response + paste-ready text in `docs/TWISTS.md` (Sat ~3:15 PM). Build proof pending (Dev 3: a language added via `phrasebook.json` only); fill in [LANGUAGE] and the link before submitting. Limit noted: RTL scripts are not handled.
- **Twist 1 (Fri 11:30 PM): identify a federal funding pathway.** Draft response in `docs/TWISTS.md`. Build change: CAP/IPAWS import, built Sat ~3:40 AM (proof checklist in TWISTS.md; clip still to record).

## 11. Decision log

- **Sat ~4:10 AM:** Every inbound call that ends without an agent-recorded need goes to human review (Codex gate). We don't automate "this caller needs nothing".
- **Sat ~4:05 AM:** Max alert validity is 12 h (console, CAP, receiver) to bound replay of recorded chirps. Revocation is not built.
- **Sat ~4:00 AM (user):** Full brief wins. Codex's TEST-only scope stays available behind `STRICT_DEMO` (`?strict=1`), default off.

- **Sat 3:45 AM:** SLOW = 60 s per type+zone cooldown (hard block, no override) + typed SEND for wide zones. Applies to signed sends and CAP batch; spoof button exempt (it's the attack demo).

- **Sat 3:40 AM:** CAP import maps codes only; CAP free text never goes on air. Unknown event → new generic type 13 OFFICIAL_ALERT + operator warning; non-Actual status → TEST; Cancel/expired refused. Zone match is word overlap (`matchZone`), else manual pick.
- **Sat 3:40 AM:** Spoken fallback uses speechSynthesis with phrasebook text (no AI translation), only after *signed* broadcasts, never after the spoof button.

- **Sat 2 AM:** Plain HTML and ES modules, no build step. Fastest to iterate, works on GitHub Pages, and is easy to cache offline.
- **Sat 2 AM:** Default protocol is AUDIBLE_FAST (6.8 s). FASTEST is available in the console if range allows.
- **Sat 2 AM:** Two demo trusted agencies: LA County OEM and Coliseum Event Ops (shows the dual use).
- **Sat 2 AM:** Base64 over the air (binary is corrupted by ggwave's UTF-8 handling).
- **Fri night:** Chose CHIRP for the Resilience Comms lens. Dropped the evacuation router (poor fit with the prompt).

## 12. Facts to verify before they go on slides

- Jan 2025 LA County false evacuation alert: date, and how many phones it reached
- Cell outages during the Eaton and Palisades fires
- LA28 visitor numbers and international share; LA's language count
- Current status of SBIR/STTR authorization, DHS SVIP open topics, and FEMA grant programs (see docs/TWISTS.md)

## 13. Commit log (oldest first; C = Claude Code, X = Codex)

| Commit | By | Summary |
|---|---|---|
| 42302bf | team | Scaffold: wire format, Ed25519 signing, phrasebook (9 languages), console, offline receiver PWA, selftest |
| 24cc7fa | C | Lane split between Claude Code and Codex in CONTEXT |
| 4065661 | C | CAP/IPAWS import (CAP → codes + zone, refuses expired/Cancel/malformed/oversized, 3 samples) and spoken fallback after signed chirps (Twist 1 build) |
| 764add7 | C | SLOW rung: 60 s repeat cooldown per alert+zone, typed SEND for wide zones (new zone 99 countywide) |
| 4551a4d | C | Record user decision: full brief wins, TEST-only scope behind STRICT_DEMO |
| 06b8840 | C | Reply-chirp codec (18 B → 24 chars, 1.45 s) and help-queue ranking/dedupe, with tests |
| 7315319 | C | AGENTS.md + HANDOFF.md: the Claude ⇄ Codex message board and file locks |
| 87f4aa5 | X | TEST-only guard (demo-policy, TEST banners, secret no longer stored), Twist 1 evidence script, proposal docs |
| ab7a66f | C | Help server: queue, signed-alert readout for the phone line, Retell webhook/functions, mock mode |
| 981850b | X | TWISTS.md: Twist 1 corrected to the verified NSF SBIR response; unproven claims removed |
| 88aba21 | C | HANDOFF: lock console/receiver for the STRICT_DEMO work |
| 0e5d07a | X | docs/DEVICE_TEST.md: physical/offline speaker → phone test protocol |
| 77b407f | X | HANDOFF: Retell trust gaps found in review |
| 409da39 | X | HANDOFF: server review gaps (msgId collision, PII retention, corrupt queue) |
| 4c1ec48 | C | STRICT_DEMO flag; full mode restores CAP broadcast, HOLD rung, help chirp + POST, GPS zone check, console help queue |
| ae461b7 | C | Server: per-issuer alert keys, help PII retention limits, refuse a corrupt queue |
| 0d33bd3 | X | scripts/server-safety.mjs: 7 independent server regression gates |
| a7df828 | C | Phone line says "signed demo alert", not "official"; console shows phone-line publish ack |
| 57f49e6 | C | HANDOFF/CONTEXT: release locks, status |
| cc83cfd | C | Server passes all 7 gates: call review, Spanish life words, triage parsing, call-scoped dedupe, supervisor token |
| 90e320e | C | Console asks for the supervisor token only once |
| a0b7dce | C | Outbound callback ladder: call → retry → SMS → door knock; silence never counts as reached |
| a77f066 | C | HANDOFF: server gate green, callback ladder landed |
| b9bf99d | C | Console help queue: Call back / Escalate buttons, ladder status column |
| 4c400ba | C | Retell agent prompt + get_active_alerts / report_need schemas matching the server |
| b99765d | C | Codex review fixes: 12 h validity cap, CAP batch stops on failure, partial repeats count, console PII pruning, /alerts auth |
| 5422d44 | C | HANDOFF: review fixes landed, release locks |
| 0a43ff2 | C | HANDOFF: claim P2.7 range test |
| d6e53a3 | X | Receiver: 12 h validity cap, help-upload lock + retry; SW caches static files only; sw-cache-safety test |
| cdfb9be | C | Range test: console test pattern, range/ logger page with CSV, browser mic loopback test |
| 483de12 | C | HANDOFF: range test landed, sw.js request |
| 75f5b89 | C | HANDOFF: review of d6e53a3 (no buzz without GPS) |
| 5206bbb | C | CONTEXT: status, next steps, decisions |
| cd65401 | X | Range page added to the offline cache (v10) |
| fe74fd5 | X | Buzz fix (quiet only when GPS says outside the zone); DEVICE_TEST records the digital mic check; v11 cache |
| b8d997b | C | CONTEXT: status snapshot at push |
| b18c0b2 | X | HANDOFF: browser mic evidence confirmed independently |
| (PR #2) | C | Merge agents-claude-codex → main; regenerated demo public keys, sw chirp-v12; demo audio script + tampered/expired WAVs |
| (feature/vindhya) | C | Console on a phone: full-screen review + Approve before every broadcast, airtime before Approve, speech interleaved with chirps; sw chirp-v13 |
