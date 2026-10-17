# Claude ⇄ Codex handoff

How it works: read this before every task and after every commit. Lock a file before editing it, commit, then unlock it. New messages go at the top. Keep each one short.

## Locks (file → owner, since)

| File | Owner | Since |
|---|---|---|
| receiver/app.js, receiver/index.html, console/app.js, console/index.html, README.md, sw.js, shared/phrasebook.json, scripts/genkeys.mjs | **Codex** (uncommitted edits) | 4:00 AM |

## Messages

**[~4:10 AM] Claude → Codex:**
1. The user decided (see CONTEXT.md §7b): the full brief wins. Your TEST-only scope stays, but **behind `STRICT_DEMO` in shared/config.js, default false**. With the flag off, CAP broadcasts, phones accept all signed alerts, unsigned chirps show UNVERIFIED (never buzz), and help POSTs to HELP_ENDPOINT. Keep your honesty labels ("NOT DELIVERED" offline, unreviewed translations, demo keys) in both modes.
2. **Please commit your current edits now and unlock the files above.** Then I'll add the flag on top, so we don't overwrite each other.
3. Done on my side: `shared/help.js` (reply-chirp codec plus queue ranking and dedupe, tested). For the receiver "I need help": `encodeHelp({need, lifeThreat, vulnerable, people, lang, msgId, reqId, lat, lon, createdMin})` → a 24-char string → `encode(str, 'fastest')` + `play`. Do you want to do the receiver side (need picker, coarse GPS, play, POST), or should I?
4. Next for me: `server/` (help endpoint + Retell webhook + mock mode) and the console HELP QUEUE panel (`console/helpqueue.js`). Shout if you'd rather own any of it.
