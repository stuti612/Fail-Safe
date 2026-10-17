# Twist responses

Each response says what changed, why, and gives proof. Judges reward changes to the build over changes to the slides.

---

## Twist 1 (Fri 11:30 PM): Identify a federal funding pathway

**Submission source of truth:** [`TWIST1_VERIFIED.md`](TWIST1_VERIFIED.md) and [`twist1-evidence.json`](twist1-evidence.json). This section supersedes the earlier speculative DHS/FEMA pathways and CAP-to-phone claim.

**Possible federal R&D pathway:** [NSF SBIR Phase I](https://www.nsf.gov/funding/opportunities/small-business-innovation-research-small-business-technology/nsf26-510/solicitation), up to $305,000 for 6–18 months for an eligible U.S. small business with a genuinely novel technical question. CHIRP's proposed research is reliable authenticated acoustic reception through noisy venue speakers by prepared phones. A [Project Pitch](https://seedfund.nsf.gov/project-pitch/) and invitation precede a full proposal. We have no invitation, award, confirmed eligibility, venue partner, or evidence yet that our engineering is novel enough.

**Build changes (current `agents-claude-codex` build, SW cache v11):**
- **CAP 1.2 import in the console (default full mode).** An operator pastes CAP XML (the IPAWS message format) or loads one of 3 samples. The console reads `<event>`/SAME code, `<urgency>`, `<severity>`, `<expires>`, `<area><areaDesc>` → maps to fixed phrasebook codes (`shared/cap-map.json`) and a zone → shows the all-language preview → signs → chirps one alert per zone. Only codes go on air (100 chars), never CAP free text. It refuses expired, Cancel, malformed and oversized CAP. Unknown events use a generic "official alert" code with a warning; non-Actual status maps to TEST; validity is capped at 12 h. A batch with an unmatched area is blocked until the operator picks a zone, and it stops at the first failed area.
- **Strict TEST mode (`?strict=1`)** keeps the narrow venue-gate scenario: CAP is preview-only and phones accept one signed TEST code.
- **Evidence (software only):** `node scripts/selftest.mjs` (84 checks, including 20 CAP cases); headless Chromium signed and broadcast all 3 areas of the multi-area CAP sample (zone pick enforced, no errors); `node scripts/mic-loopback.mjs` fed real ggwave audio to the browser as the microphone, and the receiver displayed the signed alert. `node scripts/funding-evidence.mjs`: digital waveform timing 6.83 s (FAST) / 3.75 s (FASTEST).
- **Not proven:** speaker → phone delivery, range, offline phone startup, or any connection to a live IPAWS feed. CAP is pasted by an operator; CHIRP has no agency authority.

**Next proof gate:** follow `docs/DEVICE_TEST.md`. Reload each phone online so SW v11 is active, run the range page at 1 m / 3 m / noisy, then CAP sample 1 → chirp → a Spanish-language phone, with radios off after cache readiness. Record successes, failures, latency, devices, distance and noise. Do not infer reach from speaker range or digital loopback.

**Paste-ready response:** use the one in [`TWIST1_VERIFIED.md`](TWIST1_VERIFIED.md) (single source; it must name the CAP 1.2 import as this twist's build change).

---

## Twist 2 (Sat 4:30 AM): Make it global

**Status:** build change done and checked in a browser (Sat ~2:30 PM). The real-phone clip is still to record. Owner: Dev 3.

### What changed
- **Armenian (`hy`) added with no code change**: one new entry per phrase in `shared/phrasebook.json` (53 phrases) plus a language-list entry. The receiver builds its language menu from the phrasebook, so Armenian appears and renders automatically. It falls back to English for any phrase not yet translated.
- **What "global" costs for CHIRP:** a new **language** is one phrasebook column, a new **city or region** is entries in `zones.json`, and the **over-the-air format doesn't change**. Only codes go on air, so an old phone and a new phone hear the same chirp and each shows it in its own language. No towers, data plans, accounts or app-store approvals are needed to receive.
- **Translation review sheets** (`docs/translation-review/<lang>.md`): a native speaker checks a language in minutes, and only then is it marked `reviewed: true`.

### Why
LA has one of the largest Armenian communities outside Armenia (Glendale, Burbank), and today's English-first alerts miss many older Armenian speakers. The same property is what makes CHIRP portable: World Cup and pilgrimage crowds, earthquake drills in Japan, and regions with patchy coverage get alerts in their own languages from whatever loudspeaker is there.

### Proof
- [x] Headless Chromium at phone size (390×844): Armenian appears in the language menu, the UI and a signed EVACUATE alert render in Armenian, with no page errors. Screenshot: `docs/evidence/twist2-armenian-receiver.png`
- [x] All tests pass with Armenian added: selftest 84/84, test-demo-policy, server-safety 8/8
- [ ] Clip: a real phone set to Հայերեն receives a chirp
- [ ] Commit link

### Honest limits
- The Armenian text is **machine-drafted Eastern Armenian, not yet reviewed** (`reviewed: false`, labelled in the app). Many LA Armenians read Western Armenian, which would be one more phrasebook entry.
- The spoken fallback depends on the operator's device having an Armenian voice installed.
- The Retell phone line reads alerts from the same phrasebook, but whether Retell's voice supports Armenian is not checked.

---

## Twist 3 (Sat 7:00 AM; check portal, one flyer says 9:30 AM)

_TBD_
