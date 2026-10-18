# Audit track B: help server, Retell integration, help queue

Scope: `server/server.mjs`, `server/core.mjs`, `shared/help.js`, and the parts of `console/helpqueue.js` and `receiver/app.js` that use the server. I tested the running server over HTTP from outside (black box) and also called the core functions directly in Node. I changed no application code.

## Method and environment

- **Harness:** `scripts/audit-b-server.mjs`. It uses plain Node ESM, `node:assert`, global `fetch`, `node:net` for raw HTTP, and `child_process`. No new dependencies.
- **Servers:** the harness starts `server/server.mjs` on `127.0.0.1:8901-8948`, one server at a time, because the server always writes `server/queue.json` next to itself. It backs up any existing `server/queue.json` first (there was none) and deletes everything it created at the end. After every run, `server/` contains only `core.mjs` and `server.mjs`, and no server processes are left running.
- **Secrets and network:** no secrets and no external network. `CHIRP_SUPERVISOR_TOKEN=audit-token-7f3a` (synthetic). `RETELL_API_KEY` is empty, or the fake `audit-key` for the signature tests. `RETELL_FROM_NUMBER` is never set, so the callback ladder always runs in mock mode and never calls `api.retellai.com`. The public tunnel in `shared/config.js` was read, never contacted.
- **Signed alerts:** the spawned server only trusts the committed keys in `shared/keys.js`. Over HTTP I tested only the refusal path. I tested acceptance in-process, by pushing throwaway tweetnacl keypairs into the exported `TRUSTED_KEYS` array. To get an alert into a spawned server for the readout tests, I seeded one into `queue.json`, which the server loads without verifying it.
- **Machine:** Apple M2, 8 cores, Node v26.7.0, macOS (Darwin 25.0.0). Other agents were running on the same machine (load average 24-54), so the latency numbers are noisy upper bounds. I report two runs below.
- **Baseline:** the existing gate `node scripts/server-safety.mjs` passes 8/8 on this worktree.

```bash
cd Fail-Safe-testing
node scripts/audit-b-server.mjs          # ~45 s; exit 1 while any check FAILs
node scripts/server-safety.mjs           # existing gate, 8/8
```

**Evidence labels:**
- **[verified]**: reproduced by a check in the harness.
- **[static]**: found by reading the code.
- **[inference]**: depends on outside behavior I did not observe, such as Retell's transcript format or cloudflared.

## Results

The latest run passed 90 of 126 checks. The 36 failures by severity: Critical 2, High 3, Medium 12, Low 16, Info 3. The results were stable across 4 runs. Only the latency numbers changed.

| Section | Pass/total | Notes |
|---|---|---|
| 1 AuthN/Z | 9/10 | Covers every private route against 15 `Authorization` variants, plus 503 when no token is set. The one FAIL is the non-constant-time token compare (Low). |
| 2 CORS | 11/11 | `Access-Control-Allow-Origin` (ACAO) was never `*` during the whole run. Rejected origins: `null`, a trailing slash, another port, `127.0.0.1` used as an alias, `https`, an origin with an extra suffix, an empty Origin. |
| 3 Input handling | 13/18 | |
| 4 Help queue semantics | 10/16 | |
| 5 Retell functions and webhook | 11/14 | |
| 5b Retell signature (`audit-key`) | 6/8 | |
| 6 Callback ladder | 5/10 | |
| 7 Concurrency | 6/6 | |
| 8 Persistence | 10/19 | Includes the two Critical crash checks. |
| 9 publishAlert and readout | 7/11 | |
| 10 Bind address | 2/3 | |

### Latency

All times are in ms, measured by the harness's `fetch` client over loopback.

| Measurement | Run A (lower load) p50 / p95 / max | Run B (load ~54) p50 / p95 / max |
|---|---|---|
| 200 parallel `POST /help` (in-flight time per request) | 71 / 168 / 171 | 676 / 1017 / 1063 |
| 50 `handled` + 50 `GET /help` in parallel | 28 / 34 / 34 | 151 / 364 / 381 |
| Sequential `POST /help`, small queue (n=100) | 0.7 / 1.3 / 1.8 | 11 / 17 / 145 |
| Sequential `POST /help`, 20,000 queued (n=50) | 12.9 / 16.3 / 21.1 | 54 / 98 / 198 |
| `GET /help`, 20,000 queued (n=10) | 21.8 / 24.3 / 24.3 | 79 / 147 / 147 |

- With 20,000 entries, `queue.json` is 5.27 MB, and every POST rewrites the whole file synchronously (`server.mjs:35`).
- Mock ladder timing [verified]: call 2 at 3.0 s and door knock at 6.0 s, as designed.

### What passed (verified)

- **Auth:** `Authorization` must be exactly `Bearer <token>`. These are all rejected with 401: lowercase or uppercase `bearer`, a double space, the token as a prefix or with extra characters, the token in another case, Basic auth, duplicate headers, and two comma-joined tokens. Node removes leading and trailing whitespace from header values (RFC 9110), so a trailing space is accepted. That is harmless. With no token set, all four private routes return 503, even for `Bearer ` and `Bearer undefined`.
- **Routing:** paths and methods never get around auth. Tested: HEAD, PUT, DELETE, PATCH, TRACE, trailing slashes, uppercase paths, `/x/../help`, `%2e%2e`, `%00`, `;a`, `//help`, absolute-form URLs, and `*`.
- **Content types:** these get 415: `text/plain`, a form body, `application/jsonx`, `json`, `text/json`, and no Content-Type. A `charset` parameter and uppercase `APPLICATION/JSON` are accepted.
- **Body size and format:** bodies of 99,999 and 100,000 bytes are accepted. A body of 100,001 bytes gets a clean 413, and so does 5 MB. Chunked bodies work. Invalid UTF-8 becomes U+FFFD with no crash. JSON nested 49,000 levels deep is handled. Malformed JSON gets 400. `null` bodies get 400 or 204, with no crash.
- **Prototype keys:** `__proto__` and `constructor` keys in the body and in Retell args do not change `Object.prototype` and do not affect the stored entry.
- **Parsing:** `need`, booleans (`"false"` is false) and `people` (`"2.5"`→2, `-1`→1, `1e9`→255) all parse as intended. The note is capped at 500 characters.
- **XSS:** `<script>` in the note is stored raw and served as `application/json`. `console/helpqueue.js` renders every cell with `textContent` and contains no `innerHTML`.
- **Ranking:** life threat first, then vulnerable, then oldest. Handled entries come last.
- **Webhook events:** `call_started`, `transcript_updated` and unknown events are ignored. Missing, empty, garbage or non-string transcripts produce one review entry that says "no usable transcript". A 90 KB transcript is capped at about 520 characters. Spanish life words (`inconsciente`, `sangrando`, `atrapada`, `incendio`) are flagged. `call_analyzed` after `call_ended` updates the same entry. Three duplicate deliveries of the same `call_id` produce one entry. When the agent's `report_need` entry already exists, its note is kept.
- **Ladder:** the full ladder works (call 1 → call 2 → SMS skipped and logged → door knock). Starting a callback on a handled request gets 400, and an unknown key gets 404. A request with no phone number goes straight to door knock. An answered callback leaves the request open. Voicemail, busy, machine, inactivity and silence all count as not reached.
- **Concurrency:** 200 parallel POSTs were all kept exactly once, and `queue.json` stayed valid with 200 entries and no `.tmp` file left over. 50 parallel identical POSTs gave exactly one `added:true`. 20 parallel webhooks for the same `call_id` gave one entry.
- **Persistence:** the queue survives a restart. SIGKILL during a burst of POSTs still leaves valid JSON, because the server writes a temp file and renames it. A corrupt, empty or binary `queue.json` stops startup with exit code 1 and leaves the file untouched. A leftover `.tmp` file is ignored and replaced. Entries older than 24 h are dropped, and handled entries lose their personal data after 1 h, once a save runs.
- **Alerts:** these are all refused: unsigned or untrusted signatures, a tampered body, a zeroed signature, a truncated or padded wire, the wrong version, non-base64 text, and expired alerts. Re-publishing an alert replaces the earlier copy only for the same issuer and msgId. Unknown codes fall back to `zone N`. Over HTTP, `POST /alerts` without a token gets 401, and any wire not signed by a committed key gets 400.
- **Signatures:** valid signatures are accepted, and uppercase hex is fine. These all get 401: a missing or malformed header, the wrong key, a tampered body, a timestamp more than 5 minutes old or ahead, a timestamp in seconds, and a negative timestamp. The check also covers `/retell/function` and unknown `/retell/*` paths. Replayed `call_ended` webhooks are harmless because entries are deduplicated by `call_id`.
- **Bind address:** the server is reachable on `127.0.0.1`. `::1` and the LAN IP `172.28.48.19` both refuse connections.

## Findings

Findings are ranked by severity. Line numbers refer to the files as committed at `0bcda8d`.

### Critical

**C1. Any client that aborts a request body mid-upload crashes the whole server.** [verified]
- **Where:** `server/server.mjs:71` and `:76`. The request handler is an `async` function that reads the body with `for await (const chunk of req)`. When a client disconnects mid-body, the stream throws `Error: aborted` (`ECONNRESET`). Nothing catches it, so Node's default unhandled-rejection behavior ends the process with exit code 1.
- **Repro:** open a TCP connection and send `POST /help` with `Content-Length: 1000`, then 15 bytes of body, then close the socket. The server process exits. A GET with a body and no Content-Type does the same, so no token is needed and the 415 check is skipped.
- **Impact:** a single unauthenticated packet stops the help queue, all active callback ladders (see H2) and the Retell endpoints. Nothing restarts the server. A phone on a bad connection that drops mid-upload while sending "I need help" can trigger this by accident, and that is the normal situation in a disaster. [inference] The committed `HELP_ENDPOINT` is a public trycloudflare tunnel, so this is reachable from the internet whenever the tunnel is up. Whether cloudflared passes an aborted upload through as an aborted request was not tested.
- **Fix:** wrap the body read in try/catch (`try { for await … } catch { return; }`), or add `req.on('error', …)` and catch the handler's promise (`createServer((req, res) => handle(req, res).catch(() => res.destroy()))`). Add a regression check with a raw socket abort.

### High

**H1. A help request with an old `createdMin` is answered "added: true" and then silently deleted.** [verified]
- **Where:** `core.mjs:71` stores the `createdMin` the client sends. `save()` at `server.mjs:35` calls `pruneHelp()` (`core.mjs:122`), which drops anything more than 24 h old within the same request.
- **Repro:** `POST /help {"note":"x","createdMin":<now-1500>,"lifeThreat":true}` returns `200 {"added":true,"reply":"LIFE THREAT…"}`. `GET /help` does not contain it.
- **Impact:** the receiver keeps unsent requests in localStorage and retries them when it is back online (`receiver/app.js:352-360`). A phone that was offline for more than 24 h, or that has a wrong clock, gets a 200, shows "delivered", and nobody ever sees the request.
- **Fix:** use the server's time for retention (for example, a `receivedAt` field), and reject or clamp a `createdMin` outside about ±24 h. Never answer `added:true` for an entry that is pruned.

**H2. A server restart during a callback ladder stops the escalation silently, and the ladder state is lost.** [verified]
- **Where:** the ladder runs only on in-memory `setTimeout`s (`server.mjs:55`, `:67`, `:109`). In mock mode, the call 1 and call 2 steps never call `save()` (`server.mjs:53-55`), and the callback route does not save either (`:88-93`).
- **Repro:** start a callback and wait 3.6 s. In memory the step is `call 2`, but `queue.json` has no `callback` at all. Restart the server and wait 7 s: `callback` is still missing, and no door knock is ever flagged. The console keeps the `call 1` step from its own POST response, because a poll result with no `callback` keeps the old value (`helpqueue.js:51`). It also hides the Call back button once `q.callback` is set (`:81`).
- **Impact:** "No answer is never treated as OK" fails after any restart, and C1 makes restarts likely. With a real Retell number, the step is saved only after Retell accepts the call (`server.mjs:63`), and nothing resumes the ladder after a restart. [static]
- **Fix:** save after every step change. On startup, resume or flag every open `callback` whose step is not `answered` or `door knock`, for example by setting it to door knock with a log line.

**H3. A callback where only the agent spoke counts as "answered" and stops the ladder.** [verified in-process; the transcript format is an inference]
- **Where:** `core.mjs:147` counts words in the whole transcript. Retell's `call.transcript` usually has `Agent: …\nUser: …` lines [inference from Retell's documented format], so the agent's own greeting gives at least 3 words.
- **Repro:** `callbackOutcome(h, {disconnection_reason:'user_hangup', transcript:'Agent: Hello, this is the CHIRP help line calling you back about your request.\nUser: '})` returns `'answered'`.
- **Impact:** if someone picks up and says nothing, or a voicemail system answers without Retell detecting it, the ladder stops at `answered` instead of escalating to a door knock. The inbound webhook has the same issue (`core.mjs:96`): with a greeting present, "no usable transcript" almost never triggers. Those calls still reach review, so that part is lower risk.
- **Fix:** count only the `User:` lines, or use `transcript_object` filtered to `role === 'user'`.

### Medium

**M1. Duplicate deliveries of a callback's `call_ended` skip ladder steps.** [verified]
- **Where:** for webhooks with `metadata.helpKey`, nothing deduplicates by `call_id` (`core.mjs:91-93`).
- **Repro:** two identical `dial_no_answer` deliveries take the ladder from `call 1` to door knock within milliseconds over HTTP. In-process, with no mock timers, they take it from `call 1` to `sms`. Retell retries webhooks [inference].
- **Fix:** record handled callback `call_id`s on `h.callback`, and ignore an outcome for a step that has already moved on.

**M2. A second `POST /help/callback` on a running ladder starts a second, parallel ladder.** [verified]
- **Where:** `startCallback` (`core.mjs:137`) overwrites `h.callback`, and `runCallback` schedules a second chain of timers (`server.mjs:91-92`).
- **Repro:** start a callback, then start it again 1.5 s later. Door knock arrives 3.0 s after the second start, not 6 s, because both timer chains advance the same ladder. In real mode this would also place two outbound calls [static].
- **Fix:** return 409 while `h.callback.step` is `call 1`, `call 2` or `sms`.

**M3. In mock mode, an unsigned forged webhook can mark a ladder "answered".** [verified]
- **Where:** without `RETELL_API_KEY`, `/retell/*` is unauthenticated (by design, `server.mjs:80`), and the callback `helpKey` is guessable (`reqId:createdMin:`).
- **Impact:** together with the public tunnel in `shared/config.js:8` [inference: the deployment may run without a key], anyone can stop an escalation or inject queue entries.
- **Fix:** refuse to start without `RETELL_API_KEY` when the server is reachable through a tunnel, or require a separate mock secret. At minimum, make the console show "MOCK: unauthenticated" prominently.

**M4. The phone readout says "Official alert" for type 13.** [verified, in-process and over HTTP]
- **Where:** `activeAlertsText` (`core.mjs:50`) reads the phrasebook text verbatim. Type 13 `OFFICIAL_ALERT` (`shared/phrasebook.json:66`) reads "Official alert for this area: follow official instructions" in all 10 languages. Over HTTP with `lang=es`, the readout is "Signed CHIRP demo alert from … Alerta oficial para esta zona: siga las instrucciones oficiales".
- **Impact:** breaks honesty rule 8. The existing `server-safety.mjs` test uses *detail* 13, not *type* 13, so it misses this.
- **Fix:** give type 13 a neutral phone text such as "Alert relayed from a CAP message", or map type 13 to it in `activeAlertsText`.

**M5. Two different residents whose random 16-bit `reqId` collides in the same minute are merged, and the second is dropped.** [verified]
- **Where:** `helpKey = reqId:createdMin:callId` (`shared/help.js:59`), and `enqueueHelp` keeps only the first.
- **Repro:** one request with `medical` and `lifeThreat`, then one with `mobility`, both with the same `reqId` and `createdMin`. The second returns `200 added:false` and is lost. The receiver treats any `res.ok` as delivered.
- **Odds:** with 50 residents in one minute, the chance of at least one collision is about 1.9%. With 200 it is about 26% (birthday bound n²/2·65536).
- **Fix:** for app POSTs, dedupe only when the content also matches, or have the receiver send a 64-bit id in the POST. The sound code can keep its 16 bits.

**M6. `lat` and `lon` are stored raw with no type or length limit.** [verified]
- **Where:** `core.mjs:70`. A 90 KB `lat` string is stored and saved, while the note is capped at 500. Strings, objects, arrays and out-of-range numbers are also stored as-is (that part is Low).
- **Impact:** an unauthenticated client can grow `queue.json` by about 100 KB per request, and the whole file is rewritten on every POST. The measured cost was 13-54 ms per POST at 5 MB (Run A / Run B). [inference] About 1,000 such requests produce a file of roughly 100 MB that is rewritten on every request.
- **Fix:** store `Number.isFinite(+lat) && Math.abs(lat) <= 90 ? Math.round(lat*100)/100 : null` (and the equivalent for `lon`). Consider capping the queue length or rate-limiting POST /help.

**M7. A validly signed Retell webhook can be rejected when a multibyte character is split across TCP chunks. Unsigned bodies are corrupted the same way.** [verified]
- **Where:** `raw += chunk` decodes each Buffer chunk separately (`server.mjs:76`). A UTF-8 character split across two chunks becomes U+FFFD. The HMAC is then computed over the damaged string (`:80`).
- **Repro:** send a signed Chinese `call_ended` in two writes, split inside `孩`. It gets 401. An unsigned POST /help split the same way stores `我的���子`.
- **Impact:** multilingual Retell events can be lost at random, depending on how the body is split. Retell's own retries would hit the same problem.
- **Fix:** collect Buffers, then `Buffer.concat(chunks).toString('utf8')`, and check the size cap on byte length.

**M8. Spanish "can't breathe" is not flagged as a life threat.** [verified]
- **Where:** `LIFE` (`core.mjs:55`) has `no respira` but not `no puedo respirar` or `no puede respirar`, and has no Spanish equivalent of "chest pain" (`dolor de pecho`).
- **Impact:** these calls still go to review, but they are not ranked first.
- **Fix:** add `respirar`, `dolor de pecho`, `no reacciona` and similar words. Have a native speaker review the list.

**M9. A future `createdMin` keeps a request out of the 24 h data purge forever.** [verified in-process]
- **Where:** `pruneHelp` uses the `createdMin` the client sent (`core.mjs:122`).
- **Impact:** an entry with a far-future `createdMin` and a callback number is never pruned, which breaks the 24 h retention promise. The same root cause as H1 also lets a client move up the queue by back-dating `createdMin` (Low, verified).
- **Fix:** same as H1.

### Low

- **L1. Token compared with `===`, not in constant time** (`server.mjs:44`) [static]. Over loopback or a tunnel, the timing difference is nanoseconds against milliseconds of jitter, so this is not practically exploitable. Fix: `timingSafeEqual` on equal-length buffers.
- **L2. Size cap counts characters, not bytes** (`server.mjs:76`). A 180 KB body of 3-byte characters is accepted.
- **L3. Non-object JSON bodies (`[]`, `"x"`, `42`, `true`) each create a default "other" request.** `null` gets 400 instead, which is inconsistent.
- **L4. `Infinity` values (`1e309`) are stored as `null`.** `createdMin` and `reqId` become `null` in the saved file. The key changes after a restart, and the entry is pruned at the next save (`(null||0)` is treated as 1970).
- **L5. `lang:["es"]` is stored as an array** (`core.mjs:67`): the check converts it to a string, but the original value is stored.
- **L6. Closing a request twice overwrites `handledBy` and `handledAt`** (`core.mjs:114`). The audit trail of who closed it is lost, and the 1 h personal-data clock restarts.
- **L7. Webhook duplicates without a `call_id` each create a new entry.** Retell always sends a `call_id`, so this is low impact.
- **L8. A replayed signed `report_need` inside the 5-minute window creates a duplicate entry.** There is no replay cache, and `reqId` is random (`core.mjs:69`). A replayed `call_ended` is harmless (deduplicated by `call_id`).
- **L9. Wrong-shape `queue.json` is accepted at startup.** `{"help":null}` or `{"help":{}}` lets the server start, then every POST and GET `/help` fails with 400. `{"alerts":"x"}` breaks `/alerts`. `server.mjs:29` checks only the JSON syntax. Also, if the 10-minute timer hits `pruneHelp` with `help:null`, it throws outside any try/catch [static].
- **L10. The server does not enforce the 12 h validity cap** (`core.mjs:38`). A 30-day signed alert is accepted, and the phone line reads it while receivers reject it.
- **L11. `lang=__proto__`, `constructor` or `toString` makes the readout say `[object Object]` or `function Object() { [native code] }`** (`core.mjs:16`, `texts[lang] ?? texts.en`). The value reaches the server through `GET /alerts?lang=` or `get_active_alerts`. Fix: `Object.hasOwn(texts, lang)`.
- **L12. An unspaced Chinese transcript counts as "no usable transcript"** (`core.mjs:96`, where `\p{L}{2,}` treats a run of Chinese characters as one word). The words are discarded, and the call goes to review as a callback case. Real Retell transcripts carry `Agent:`/`User:` labels, which usually push the count to 3 or more, so impact is low [inference].
- **L13. A resident can choose the number the ladder dials** through `callback_number` in a POST /help (`core.mjs:72`). This is a harassment or toll vector once a supervisor clicks Call back. [verified that the field is stored]

### Info

- The 400 response leaks internal error text (`Cannot read properties of null (reading 'need')`, `server.mjs:115`).
- `by: {x:1}` is accepted as a name (`"[object Object]"`).
- `application/json-patch+json` passes the 415 check (`\b` in the regex). Harmless.
- A timestamp 4 minutes in the future is accepted, because the signature window is ±5 minutes. Expected.
- `shared/config.js:8` `HELP_ENDPOINT` is a public `trycloudflare.com` tunnel, so binding to `127.0.0.1` protects nothing while the tunnel runs. Every "localhost-only" assumption in the server comments needs to take this into account. The tunnel itself was not contacted.
- Entries older than 24 h stay visible in `GET /help` until the next save or the 10-minute timer: `staleVisibleBeforeSave = true` [verified].
- `queue.json` alerts are loaded without re-verifying their signatures, so the file is trusted. A key removed from `TRUSTED_KEYS` does not remove alerts it already published. Revocation is not built (known).
- The receiver's outbox stops at the first non-OK response (`receiver/app.js:358`). One request that the server rejects with 4xx blocks every later request in that phone's outbox.
- The preflight sends no `Access-Control-Allow-Methods`. POST is a CORS-safelisted method, so browsers don't need it.

## Suggested fix order

1. **C1** (one try/catch).
2. **H1 and M9** (use server time for retention).
3. **H2** (save every step and resume ladders on boot).
4. **H3, then M1 and M2** (callback correctness).
5. **M4** (type 13 wording).
6. **M7** (`Buffer.concat`).
7. **M5 and M6.**
8. The rest.

Each of these already has a check in `scripts/audit-b-server.mjs` that will turn green when it is fixed.
