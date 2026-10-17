# Twist responses

Each response says what changed, why, and gives proof. Judges reward changes to the build over changes to the slides.

---

## Twist 1 (Fri 11:30 PM): Identify a federal funding pathway

**Status:** pathway drafted. CAP/IPAWS import BUILT (Sat ~4:30 AM): console card "Import a CAP / IPAWS alert". Due about Sat 5:30 AM.

### What changed
- **Primary funding path:** DHS Science & Technology Directorate, **Silicon Valley Innovation Program (SVIP)**. It funds startups in non-dilutive phases for homeland-security and first-responder technology, and emergency alerting fits squarely.
- **Alternatives:** **NIST Public Safety Communications Research (PSCR)** prize challenges · **NSF SBIR/STTR** Phase I to de-risk the acoustic modem · **NSF I-Corps** for customer discovery (the usual first step).
- **Dual-use / defense:** AFWERX or Army xTech. Use case: mass notification on bases with no network, and multilingual alerts to civilian populations.
- **How customers pay:** LA County can buy CHIRP with **FEMA Homeland Security Grant Program, Urban Area Security Initiative (UASI)** funds (the LA/Long Beach urban area receives this every year), or with **Hazard Mitigation Grant Program** funds after a declared disaster.
- **Sequence:** I-Corps → NSF SBIR Phase I → DHS SVIP pilot with LA County OEM → county purchase with UASI funds.
- **Build change:** CHIRP now imports **Common Alerting Protocol (CAP)** alerts, the format used by FEMA's **IPAWS**. A real CAP alert can be turned into a signed chirp in one click.

### Why
Federal funders, and the counties spending federal grants, only buy alerting tools that plug into IPAWS. Without CAP compatibility, CHIRP is a demo. With it, CHIRP extends the national alerting system into places where it can't reach today (dead zones, non-English speakers).

### Proof
- [x] Console parses CAP 1.2: `<event>` / SAME `<eventCode>`, `<urgency>`, `<severity>`, `<expires>`, `<area><areaDesc>` → phrasebook codes via `shared/cap-map.json` → best-match zone (else manual pick) → all-language preview → sign → chirp. Code: `console/cap.js`.
- [x] Safety rules: unknown event → generic OFFICIAL_ALERT code + warning; multiple areas → one alert per zone; expired / Cancel / malformed / oversized → refused; non-Actual status → sent as TEST. CAP free text never goes on air (codes only, still 100 chars).
- [x] 3 samples in `docs/samples/` (evacuation with SAME code, multi-area smoke with an unmatched area, unknown tsunami event), loadable from the console's "Load a sample" menu.
- [x] `node scripts/selftest.mjs`: 18 CAP cases pass (missing fields, unknown event, multi-area, expired, malformed, oversized, Cancel, Exercise, mapping codes exist).
- [x] Browser smoke test (headless Chromium): all 3 samples render, expired refused, no console errors.
- [ ] Screenshot or clip: a sample CAP XML pasted into the console → chirp → phone shows it in Spanish
- [ ] Link to the commit (after push)

### Verify before submitting
- [ ] SVIP is accepting applications, and which topic fits
- [ ] SBIR/STTR is currently authorized (it was in question in late 2025)
- [ ] The FEMA programs we name are active (some, such as BRIC, were cancelled in 2025, so don't cite those)

---

## Twist 2 (Sat 4:30 AM)

_TBD_

---

## Twist 3 (Sat 7:00 AM; check portal, one flyer says 9:30 AM)

_TBD_
