Read CONTEXT.md before doing anything in this repo. It holds the event rules, decisions, status and next steps.

After any meaningful change (feature done, decision made, fact measured, twist answered), update CONTEXT.md: status, next steps, and the relevant log. Keep it short.

Rules:
- Never commit anything in keys/.
- Phrasebook codes are append-only; never renumber.
- Bump VERSION in sw.js whenever a cached file changes.
- Run `node scripts/selftest.mjs` after touching shared/payload.js, shared/trust.js or shared/audio.js.
