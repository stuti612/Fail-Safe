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

## Twist 2 (Sat 4:30 AM)

_TBD_

---

## Twist 3 (Sat 7:00 AM; check portal, one flyer says 9:30 AM)

_TBD_
