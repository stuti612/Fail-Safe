# Twist responses

Each response says what changed, why, and gives proof. Judges reward changes to the build over changes to the slides.

---

## Twist 1 (Fri 11:30 PM): Identify a federal funding pathway

**Submission source of truth:** [`TWIST1_VERIFIED.md`](TWIST1_VERIFIED.md) and [`twist1-evidence.json`](twist1-evidence.json). This section supersedes the earlier speculative DHS/FEMA pathways and CAP-to-phone claim.

**Possible federal R&D pathway:** [NSF SBIR Phase I](https://www.nsf.gov/funding/opportunities/small-business-innovation-research-small-business-technology/nsf26-510/solicitation), up to $305,000 for 6–18 months for an eligible U.S. small business with a genuinely novel technical question. CHIRP's proposed research is reliable authenticated acoustic reception through noisy venue speakers by prepared phones. A [Project Pitch](https://seedfund.nsf.gov/project-pitch/) and invitation precede a full proposal. We have no invitation, award, confirmed eligibility, venue partner, or evidence yet that our engineering is novel enough.

**Build change already verified:** the repo now has a signed 100-character TEST packet for a hypothetical LA venue gate scenario. `node scripts/test-demo-policy.mjs` checks that forged, expired, wrong-site and emergency packets are rejected. `node scripts/funding-evidence.mjs` exports a digital ggwave waveform loopback at 6.83 s (FAST) and 3.75 s (FASTEST), with signature checks. These timings are **not** speaker-to-phone measurements. The CAP 1.2 parser can preview sample XML; CAP broadcast is disabled in the currently committed safety build. No real IPAWS feed or agency authority exists.

**Next proof gate:** reload a prepared receiver online so service worker v4 is active, then test laptop speaker to two phones with the receiver open and microphone permission granted; repeat with radios off after confirming cache readiness. Record successes, failures, latency, device models, distance, noise and offline status. Do not infer reach from speaker range or digital loopback.

**Paste-ready response:** “Our possible future federal funding pathway is NSF SBIR Phase I. An eligible U.S. small business could seek up to $305,000 over 6–18 months to research reliable, authenticated acoustic advisories through noisy venue speakers, if CHIRP establishes genuine technical novelty and customer demand. An NSF Project Pitch and official invitation are required before a full proposal; we have neither. For this twist we added a reproducible evidence export and a signed TEST-only receiver guard. The export confirms a 100-character packet and digital ggwave round trip; speaker-to-phone and offline-phone results remain pending.”

---

## Twist 2 (Sat 4:30 AM)

_TBD_

---

## Twist 3 (Sat 7:00 AM; check portal, one flyer says 9:30 AM)

_TBD_
