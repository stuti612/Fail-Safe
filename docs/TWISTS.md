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

**Why CHIRP travels:** the chirp carries only numeric codes (alert type, instruction, zone, expiry, message id) plus a signature. Nothing on air is in any language, so the same 100-character chirp works in every country, and every phone renders it from its own phrasebook. It needs no cell towers, data plan, SIM, account or app store, only a speaker and a phone that loaded the page once. That fits places where networks are patchy, expensive or overloaded: World Cup and pilgrimage crowds, multilingual transit hubs, and earthquake or tsunami drills (for example in Japan).

**What it takes to deploy somewhere new (config, not code):**
- **A new language** = one more entry in `shared/phrasebook.json`: the language's name and about 53 short strings (13 alert types, 13 instructions, 27 interface strings). The receiver's language picker and the console's all-language preview both read the list from the phrasebook, so no code changes. A missing phrase falls back to English rather than showing nothing.
- **A new region** = its zones in `shared/zones.json` (name, lat/lon, radius, wide flag).
- **A new authority** = its public key in `shared/keys.js`. Each region trusts only its own signers.
- **Official alert feeds:** the console imports CAP 1.2, the OASIS standard behind IPAWS that many national alerting systems also use. A region maps its own event names in `shared/cap-map.json`.

**Build proof (Dev 3, pending):** add a language (planned: Armenian, a large LA community) by editing `shared/phrasebook.json` only, then show it in the receiver's picker and on a received alert. Record: the commit (it must touch only `phrasebook.json`, plus the `sw.js` version bump), a screenshot or clip, and `node scripts/selftest.mjs` still passing. Mark it `reviewed: false` until a native speaker checks it.

**Honest limits:**
- **Right-to-left scripts** (Arabic, Hebrew, Farsi, Urdu) are not handled yet: the receiver sets no `dir="rtl"`, so the layout would be wrong even though the text renders.
- Fonts come from the phone. Older phones may lack a script's font.
- Spoken fallback works only for languages the device has a built-in voice for, and it is sequential (the chirp is not).
- All non-English text is machine-drafted until a native speaker signs it off. Each language shows "unreviewed" until then.
- No zone list, key or authority exists outside our LA demo data. A real deployment needs a local agency or venue to own the keys.

**Paste-ready response:**
"CHIRP is global by design: the chirp carries numeric codes and a signature, never words, so one broadcast works in every country and every phone shows it in its own language. It needs no towers, SIM or data plan, only a speaker. Going global is configuration, not code. A new language is one phrasebook entry of about 53 short strings, a new region is a zone list, and a new authority is a public key. Alerts can come from CAP 1.2, the open standard behind IPAWS that other national alerting systems also use. For this twist we added [LANGUAGE] by editing only the phrasebook file, with no code changes, and it appeared in the receiver and on received alerts [link to commit and clip]. Limits we are honest about: right-to-left scripts need layout work, translations stay marked unreviewed until a native speaker checks them, and a real deployment needs a local authority to hold the signing keys."

Fill in [LANGUAGE] and the link once Dev 3's proof lands. Don't submit the "we added" sentence before then.

---

## Twist 3 (Sat 7:00 AM; check portal, one flyer says 9:30 AM)

_TBD_
