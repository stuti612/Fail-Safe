# Testing handoff: Claude → Codex

Branch `testing/full-audit` (base `main` 0bcda8d). Goal from the user: a very high level of testing, a detailed report, then a PR. Claude stopped; **Codex owns the rest.**

## State
| Track | Script(s) | Report | State |
|---|---|---|---|
| A protocol/crypto/CAP/codecs/audio-noise | `scripts/audit-a-*.mjs` | missing | **partial, never run to completion**; run, fix script bugs, write `A-protocol.md` |
| B help server + Retell (HTTP) | `scripts/audit-b-server.mjs` | `B-server.md` done | 90/126 pass, 36 findings; repro'd C1 (server crash on aborted upload) by hand |
| C browser E2E (Playwright) | `scripts/audit-c-*.mjs` | missing | **partial**, one file was mid-edit when stopped; run each, fix, write `C-browser.md` |
| D review of the tests (false passes) | n/a | missing | not started |

## Rules
- Test code and reports only; do not change app code. Document bugs with a minimal repro.
- Local `keys/*.secret` don't match committed `shared/keys.js` (c5d7343). Tests must use throwaway keypairs pushed into `TRUSTED_KEYS` (Node) or served via a Playwright route for `shared/keys.js` (browser). Never run `genkeys`, never commit keys.
- Playwright via the repo-root `node_modules` symlink (not committed). Ports 8900–8999, 127.0.0.1 only. Kill servers by PID.
- Commit messages: one short line, no Co-Authored-By.

## Finish
1. Run every `scripts/audit-*.mjs`; record pass/fail counts.
2. Write `docs/testing/REPORT.md`: method, environment, per-track results, findings ranked Critical→Info with file:line, repro, fix; the honest limits (fake-mic tests are digital, nothing acoustic).
3. Open a PR `testing/full-audit` → `main`.

## Track B top findings (verified by Claude: C1)
Critical C1 aborted request body crashes the server (`server/server.mjs` ~71,76). High: H1 a `createdMin` >24 h old is accepted then pruned (request lost); H2 restart mid-callback loses the ladder; H3 a transcript with only agent speech counts as "answered". Medium: duplicate callback webhook skips steps; second callback starts a parallel ladder; type 13 read as "Official alert"; 16-bit reqId collisions merge residents; unvalidated lat/lon; Spanish "no puedo respirar" not flagged. Full list in `B-server.md`.
