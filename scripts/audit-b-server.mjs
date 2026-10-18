// Audit track B: black-box + in-process adversarial tests of the CHIRP help server.
//   node scripts/audit-b-server.mjs
// Spawns server/server.mjs itself on 127.0.0.1:8901-8948 (one at a time, since the
// server always writes server/queue.json next to itself), backs up any existing
// server/queue.json and restores it at the end. No external network: RETELL_FROM_NUMBER
// is never set, so the mock ladder never dials; RETELL_API_KEY is only the fake 'audit-key'.
// Signed alerts: the spawned server only trusts committed keys, so HTTP tests cover the
// refusal path; acceptance is tested in-process with throwaway keys pushed into TRUSTED_KEYS.
// A check that exposes a real defect FAILS; the exit code is non-zero if any check fails.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, mkdtempSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createState, publishAlert, activeAlertsText, reportNeed, handleRetellWebhook, markHandled, pruneHelp, startCallback, callbackOutcome, verifyRetell, RETAIN_MS } from '../server/core.mjs';
import { helpKey } from '../shared/help.js';
import { packBody, toWire, bytesToB64 } from '../shared/payload.js';
import { TRUSTED_KEYS } from '../shared/keys.js';

const WT = fileURLToPath(new URL('..', import.meta.url));
const QFILE = join(WT, 'server', 'queue.json');
const QTMP = `${QFILE}.tmp`;
const nacl = globalThis.nacl ?? createRequire(import.meta.url)('../vendor/nacl-fast.min.js');
const TOKEN = 'audit-token-7f3a';
const ORIGIN = 'http://localhost:8000';
const RETRY_MS = 3000; // server.mjs: mock mode (no KEY && FROM)
const nowMin = () => Math.floor(Date.now() / 60000);

// ---------------------------------------------------------------- harness
const results = [];
const metrics = {};
const acaoSeen = new Set();
let section = '';
async function check(name, fn, sev = 'Medium') {
  try { await fn(); results.push({ section, name, ok: true }); console.log(`PASS ${section} ${name}`); }
  catch (err) { results.push({ section, name, ok: false, sev, msg: err.message }); console.log(`FAIL [${sev}] ${section} ${name}: ${err.message.split('\n')[0]}`); }
}
const sect = (s) => { section = s; console.log(`\n== ${s}`); };

// ---------------------------------------------------------------- queue file safety
let backupDir = null;
if (existsSync(QFILE)) { backupDir = mkdtempSync(join(tmpdir(), 'audit-b-')); copyFileSync(QFILE, join(backupDir, 'queue.json')); console.log(`backed up existing queue.json to ${backupDir}`); }
const clearQueue = () => { rmSync(QFILE, { force: true }); rmSync(QTMP, { force: true }); };
const readQueue = () => JSON.parse(readFileSync(QFILE, 'utf8'));

// ---------------------------------------------------------------- server control
const live = new Set();
let nextPort = 8901;
process.on('exit', () => { for (const c of live) try { c.kill('SIGKILL'); } catch {} });
async function startServer({ env = {}, queue, keepQueue = false, expectExit = false } = {}) {
  if (!keepQueue) clearQueue();
  if (queue !== undefined) writeFileSync(QFILE, typeof queue === 'string' ? queue : JSON.stringify(queue));
  const port = nextPort++;
  if (port > 8948) throw new Error('out of audit ports');
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: WT,
    env: { ...process.env, PORT: String(port), CHIRP_SUPERVISOR_TOKEN: TOKEN, CHIRP_APP_ORIGIN: ORIGIN, RETELL_API_KEY: '', RETELL_FROM_NUMBER: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  live.add(child);
  const srv = { port, child, base: `http://127.0.0.1:${port}`, out: '', code: undefined };
  child.stdout.on('data', (d) => (srv.out += d));
  child.stderr.on('data', (d) => (srv.out += d));
  srv.exited = new Promise((r) => child.on('exit', (code, sig) => { srv.code = code ?? sig; live.delete(child); r(srv.code); }));
  srv.stop = async (sig = 'SIGTERM') => { if (srv.code === undefined) { child.kill(sig); await srv.exited; } };
  if (expectExit) { await Promise.race([srv.exited, delay(3000)]); return srv; }
  for (let i = 0; i < 60; i++) {
    if (srv.code !== undefined) throw new Error(`server exited ${srv.code}: ${srv.out}`);
    try { await fetch(`${srv.base}/alerts`); return srv; } catch { await delay(50); }
  }
  throw new Error('server did not start');
}
const alive = async (srv) => { try { return (await fetch(`${srv.base}/alerts`)).status === 200; } catch { return false; } };

async function http(srv, method, path, { body, headers = {}, auth, raw } = {}) {
  const h = { ...headers };
  if (auth !== undefined) h.Authorization = auth;
  if ((body !== undefined || raw !== undefined) && !('Content-Type' in h)) h['Content-Type'] = 'application/json';
  const t0 = performance.now();
  const r = await fetch(srv.base + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await r.text();
  const ms = performance.now() - t0;
  const acao = r.headers.get('access-control-allow-origin');
  if (acao) acaoSeen.add(acao);
  let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, headers: r.headers, text, json, ms };
}
const sup = `Bearer ${TOKEN}`;
const queueOf = async (srv) => (await http(srv, 'GET', '/help', { auth: sup })).json;
const findNote = async (srv, marker) => (await queueOf(srv)).filter((h) => String(h.note).includes(marker));

// Raw TCP request: chunks are written separately with a pause, so the server sees them as separate 'data' events.
function rawHttp(port, chunks, { pause = 80, abortAfter = null, host = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(port, host);
    let resp = '';
    s.on('data', (d) => (resp += d));
    s.on('error', (e) => resolve({ error: e.code, resp }));
    s.on('close', () => resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(resp)?.[1]) || null, resp }));
    s.on('connect', async () => {
      for (const c of chunks) { s.write(c); await delay(pause); }
      if (abortAfter !== null) { await delay(abortAfter); s.destroy(); }
    });
  });
}
const postHead = (path, len, extra = '') => `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${len}\r\nConnection: close\r\n${extra}\r\n`;

const sign = (raw, key = 'audit-key', ts = Date.now()) => `v=${ts},d=${createHmac('sha256', key).update(raw + ts).digest('hex')}`;
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const stats = (arr) => ({ n: arr.length, p50: +pct(arr, 50).toFixed(1), p95: +pct(arr, 95).toFixed(1), max: +Math.max(...arr).toFixed(1) });

const PRIVATE = [['GET', '/help'], ['POST', '/help/handled'], ['POST', '/help/callback'], ['POST', '/alerts']];
let srv;

try {
  // ============================================================ 1. AuthN/Z, token unset
  sect('1-auth');
  srv = await startServer({ env: { CHIRP_SUPERVISOR_TOKEN: '', CHIRP_APP_ORIGIN: '' } });
  for (const [m, p] of PRIVATE) {
    await check(`token unset: ${m} ${p} -> 503 (even with "Bearer ")`, async () => {
      for (const auth of [undefined, 'Bearer ', 'Bearer undefined']) {
        const r = await http(srv, m, p, { body: m === 'POST' ? {} : undefined, auth });
        assert.equal(r.status, 503, `auth=${auth} -> ${r.status}`);
      }
    });
  }
  await check('token unset: public POST /help, GET /alerts, /retell/function still work', async () => {
    assert.equal((await http(srv, 'POST', '/help', { body: { note: 'tok-unset' } })).status, 200);
    assert.equal((await http(srv, 'GET', '/alerts')).status, 200);
    assert.equal((await http(srv, 'POST', '/retell/function', { body: { name: 'get_active_alerts', args: {} } })).status, 200);
  });
  await check('origin unset: empty Origin header gets no ACAO and preflight 403', async () => {
    const r = await rawHttp(srv.port, ['OPTIONS /help HTTP/1.1\r\nHost: x\r\nOrigin: \r\nConnection: close\r\n\r\n']);
    assert.equal(r.status, 403);
    assert.doesNotMatch(r.resp, /access-control-allow-origin/i);
  });
  await srv.stop();

  // ============================================================ main server S1 (token + origin, mock)
  srv = await startServer();
  await check('token set: every private route x auth variant', async () => {
    const variants = [
      [undefined, 401], ['', 401], [TOKEN, 401], [`bearer ${TOKEN}`, 401], [`BEARER ${TOKEN}`, 401], [`Bearer  ${TOKEN}`, 401],
      [`Bearer ${TOKEN}x`, 401], [`Bearer ${TOKEN.slice(0, -1)}`, 401], [`Bearer ${TOKEN.toUpperCase()}`, 401], ['Bearer', 401],
      [`Basic ${Buffer.from(`x:${TOKEN}`).toString('base64')}`, 401], [`Bearer ${TOKEN},Bearer ${TOKEN}`, 401],
      [sup, 'ok'], [`${sup} `, 'ok'] /* Node strips trailing OWS per RFC 9110 */, [`\t${sup}`, 'ok'],
    ];
    const bad = [];
    for (const [m, p] of PRIVATE) for (const [auth, want] of variants) {
      const r = await http(srv, m, p, { body: m === 'POST' ? {} : undefined, auth });
      const ok = want === 'ok' ? ![401, 403, 503].includes(r.status) : r.status === want;
      if (!ok) bad.push(`${m} ${p} auth=${JSON.stringify(auth)} -> ${r.status}`);
    }
    assert.deepEqual(bad, []);
  });
  await check('duplicate Authorization headers (raw) are rejected', async () => {
    const r = await rawHttp(srv.port, [`GET /help HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer wrong\r\nAuthorization: ${sup}\r\nConnection: close\r\n\r\n`]);
    assert.equal(r.status, 401);
  });
  await check('public routes need no token (POST /help, GET /alerts, /retell/*)', async () => {
    assert.equal((await http(srv, 'POST', '/help', { body: { note: 'pub-route' } })).status, 200);
    assert.equal((await http(srv, 'GET', '/alerts?lang=es')).status, 200);
    assert.equal((await http(srv, 'POST', '/retell/webhook', { body: { event: 'call_started' } })).status, 204);
  });
  await check('supervisor token compared in constant time (static inspection of server.mjs:44)', () => {
    const src = readFileSync(join(WT, 'server/server.mjs'), 'utf8');
    assert.doesNotMatch(src, /req\.headers\.authorization === `Bearer \$\{TOKEN\}`/, 'plain === comparison (not timingSafeEqual)');
  }, 'Low');

  // ============================================================ 2. CORS
  sect('2-cors');
  await check('preflight with exact origin -> 204, ACAO echoes origin, allows Authorization, Vary: Origin', async () => {
    const r = await http(srv, 'OPTIONS', '/help', { headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
    assert.match(r.headers.get('access-control-allow-headers'), /Authorization/);
    assert.match(r.headers.get('vary') || '', /Origin/);
  });
  for (const [label, origin] of [['non-matching', 'https://evil.test'], ['absent', undefined], ['null', 'null'], ['trailing slash', `${ORIGIN}/`], ['other port', 'http://localhost:8001'], ['127.0.0.1 alias', 'http://127.0.0.1:8000'], ['https scheme', 'https://localhost:8000'], ['suffix', `${ORIGIN}.evil.test`]]) {
    await check(`preflight ${label} origin -> 403 and no ACAO; GET with that origin -> no ACAO`, async () => {
      const headers = origin === undefined ? {} : { Origin: origin };
      const p = await http(srv, 'OPTIONS', '/help', { headers });
      assert.equal(p.status, 403);
      assert.equal(p.headers.get('access-control-allow-origin'), null);
      const g = await http(srv, 'GET', '/help', { headers, auth: sup });
      assert.equal(g.headers.get('access-control-allow-origin'), null);
    });
  }
  await check('no Access-Control-Allow-Credentials on any response (bearer, not cookies)', async () => {
    const r = await http(srv, 'GET', '/help', { headers: { Origin: ORIGIN }, auth: sup });
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  });
  await check('Vary: Origin and Cache-Control: no-store also on 401/404/415/400 responses', async () => {
    for (const r of [await http(srv, 'GET', '/help'), await http(srv, 'GET', '/nope'), await http(srv, 'POST', '/help', { raw: '{}', headers: { 'Content-Type': 'text/plain' } }), await http(srv, 'POST', '/help', { raw: '{bad', headers: { 'Content-Type': 'application/json' } })]) {
      assert.match(r.headers.get('vary') || '', /Origin/, `status ${r.status}`);
      assert.equal(r.headers.get('cache-control'), 'no-store', `status ${r.status}`);
    }
  });

  // ============================================================ 3. Input handling
  sect('3-input');
  await check('content-type: text/plain, none, form, application/jsonx -> 415', async () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonx', 'multipart/form-data', 'json', 'text/json']) {
      const r = await http(srv, 'POST', '/help', { raw: '{}', headers: { 'Content-Type': ct } });
      assert.equal(r.status, 415, `${ct} -> ${r.status}`);
    }
    const none = await rawHttp(srv.port, [postHead('/help', 2).replace('Content-Type: application/json\r\n', ''), '{}']);
    assert.equal(none.status, 415);
  });
  await check('content-type: charset param and upper case accepted', async () => {
    for (const ct of ['application/json; charset=utf-8', 'APPLICATION/JSON', 'application/json;charset=UTF-8']) {
      assert.equal((await http(srv, 'POST', '/help', { raw: JSON.stringify({ note: `ct-${ct}` }), headers: { 'Content-Type': ct } })).status, 200, ct);
    }
  });
  await check('content-type: application/json-patch+json is accepted (regex \\b quirk; harmless)', async () => {
    assert.equal((await http(srv, 'POST', '/help', { raw: '{"note":"ct-patch"}', headers: { 'Content-Type': 'application/json-patch+json' } })).status, 200);
  }, 'Info');
  const sized = (n) => { const base = JSON.stringify({ note: 'size-', pad: '' }); return JSON.stringify({ note: 'size-', pad: 'a'.repeat(n - base.length) }); };
  await check('body of 99,999 and 100,000 bytes accepted', async () => {
    for (const n of [99_999, 100_000]) { const b = sized(n); assert.equal(Buffer.byteLength(b), n); assert.equal((await http(srv, 'POST', '/help', { raw: b })).status, 200, `${n}`); }
  });
  await check('body of 100,001 bytes -> client receives 413 (not a reset)', async () => {
    const b = sized(100_001);
    assert.equal(Buffer.byteLength(b), 100_001);
    const r = await http(srv, 'POST', '/help', { raw: b });
    assert.equal(r.status, 413);
    assert.ok(await alive(srv), 'server died');
  });
  await check('body of 5 MB -> 413 and server survives', async () => {
    let status;
    try { status = (await http(srv, 'POST', '/help', { raw: sized(5_000_000) })).status; } catch (e) { status = `client error ${e.cause?.code || e.message}`; }
    assert.equal(status, 413);
    assert.ok(await alive(srv));
  });
  await check('size cap counts bytes: 180 KB of 3-byte UTF-8 must be refused', async () => {
    const b = JSON.stringify({ note: 'cjk-cap', pad: '中'.repeat(60_000) });
    const r = await http(srv, 'POST', '/help', { raw: b });
    assert.equal(r.status, 413, `${Buffer.byteLength(b)}-byte body -> ${r.status} (cap is raw.length in UTF-16 units, server.mjs:76)`);
  }, 'Low');
  await check('chunked transfer-encoding body accepted', async () => {
    const body = JSON.stringify({ note: 'chunked-ok' });
    const head = 'POST /help HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n';
    const r = await rawHttp(srv.port, [head, `${(5).toString(16)}\r\n${body.slice(0, 5)}\r\n`, `${(body.length - 5).toString(16)}\r\n${body.slice(5)}\r\n0\r\n\r\n`]);
    assert.equal(r.status, 200);
    assert.equal((await findNote(srv, 'chunked-ok')).length, 1);
  });
  await check('multibyte character split across TCP chunks is stored intact', async () => {
    const body = Buffer.from(JSON.stringify({ note: 'split-utf8 我的孩子需要帮助' }));
    const cut = body.indexOf(Buffer.from('孩')) + 1; // inside a 3-byte sequence
    const r = await rawHttp(srv.port, [postHead('/help', body.length), body.subarray(0, cut), body.subarray(cut)]);
    assert.equal(r.status, 200);
    const [h] = await findNote(srv, 'split-utf8');
    assert.equal(h.note, 'split-utf8 我的孩子需要帮助', `stored as ${JSON.stringify(h.note)} (raw += chunk decodes each chunk separately, server.mjs:76)`);
  }, 'Medium');
  await check('invalid UTF-8 bytes do not crash; stored with U+FFFD', async () => {
    const body = Buffer.concat([Buffer.from('{"note":"bad-utf8 '), Buffer.from([0xff, 0xfe, 0xc3]), Buffer.from('"}')]);
    const r = await rawHttp(srv.port, [postHead('/help', body.length), body]);
    assert.equal(r.status, 200);
    assert.match((await findNote(srv, 'bad-utf8'))[0].note, /�/);
  });
  await check('deeply nested JSON (49,000 levels) handled without crash', async () => {
    const deep = `{"note":"deep","x":${'['.repeat(49_000)}${']'.repeat(49_000)}}`;
    const r = await http(srv, 'POST', '/help', { raw: deep });
    assert.ok([200, 400].includes(r.status), `status ${r.status}`);
    assert.ok(await alive(srv));
  });
  await check('malformed JSON variants -> 400 "bad json"', async () => {
    for (const raw of ['{', '{"a":}', "{'a':1}", 'NaN', '{"a":1}garbage', '\u0000']) assert.equal((await http(srv, 'POST', '/help', { raw })).status, 400, JSON.stringify(raw));
  });
  await check('JSON null body -> 400 on every POST route, server survives', async () => {
    for (const p of ['/help', '/retell/function', '/help/handled', '/help/callback', '/alerts']) {
      const r = await http(srv, 'POST', p, { raw: 'null', auth: sup });
      assert.ok([400, 404, 204].includes(r.status), `${p} -> ${r.status}`);
    }
    assert.ok(await alive(srv));
  });
  await check('non-object JSON body ([], "x", 42, true) to POST /help is rejected, not queued', async () => {
    const before = (await queueOf(srv)).length;
    const codes = [];
    for (const raw of ['[]', '"x"', '42', 'true']) codes.push((await http(srv, 'POST', '/help', { raw })).status);
    const after = (await queueOf(srv)).length;
    assert.equal(after, before, `codes ${codes}; ${after - before} default "other" requests were queued from non-object bodies`);
  }, 'Low');
  await check('__proto__/constructor keys in POST /help and Retell args: no pollution, entry sane', async () => {
    const raw = '{"__proto__":{"polluted":"yes","lifeThreat":true,"status":"handled"},"constructor":{"prototype":{"polluted":"yes"}},"note":"proto-http"}';
    assert.equal((await http(srv, 'POST', '/help', { raw })).status, 200);
    assert.equal((await http(srv, 'POST', '/retell/function', { raw: '{"name":"report_need","args":{"__proto__":{"note":"proto-args"},"note":"proto-args2"}}' })).status, 200);
    const [h] = await findNote(srv, 'proto-http');
    assert.equal(h.status, 'open'); assert.equal(h.lifeThreat, false); assert.equal(h.polluted, undefined);
    // same bodies in-process: the server parses with JSON.parse, which creates an own "__proto__" key
    const st = createState();
    reportNeed(st, JSON.parse(raw), { source: 'app' });
    handleRetellWebhook(st, JSON.parse('{"event":"call_ended","call":{"__proto__":{"metadata":{"helpKey":"x"}},"call_id":"p1","transcript":"one two three"}}'));
    assert.equal({}.polluted, undefined); assert.equal(Object.prototype.polluted, undefined);
    assert.equal(st.help.length, 2);
  });
  await check('huge numbers: people 1e309 -> 255; createdMin/reqId 1e309 survive JSON round-trip', async () => {
    await http(srv, 'POST', '/help', { raw: '{"note":"huge-num","people":1e309,"reqId":1e309,"createdMin":1e309}' });
    const [h] = await findNote(srv, 'huge-num');
    assert.equal(h.people, 255);
    assert.ok(Number.isFinite(h.createdMin) && Number.isFinite(h.reqId), `stored createdMin=${h.createdMin} reqId=${h.reqId} (Infinity serialises to null: key changes, entry pruned after restart)`);
  }, 'Low');
  await check('method/route fuzz: HEAD/PUT/DELETE/PATCH, trailing slash, case, traversal never bypass auth', async () => {
    const bad = [];
    const cases = [['HEAD', '/help'], ['PUT', '/help'], ['DELETE', '/help'], ['PATCH', '/help/handled'], ['GET', '/help/'], ['GET', '/HELP'], ['GET', '/help?x=1'], ['GET', '/help#frag'], ['GET', '/x/../help'], ['GET', '/%2e%2e/help'], ['GET', '/help%00'], ['GET', '/help;a'], ['GET', '//help'], ['GET', '/help/handled'], ['GET', '/retell/function'], ['TRACE', '/help']];
    for (const [m, p] of cases) {
      let r; try { r = await http(srv, m, p); } catch (e) { r = { status: `err ${e.message}` }; }
      if (r.status === 200 && Array.isArray(r.json)) bad.push(`${m} ${p} leaked queue`);
      if (r.status === 200 && m !== 'HEAD' && p.startsWith('/help')) bad.push(`${m} ${p} -> 200`);
    }
    const raws = ['GET /../help HTTP/1.1', 'GET http://evil/help HTTP/1.1', 'GET * HTTP/1.1'];
    for (const line of raws) { const r = await rawHttp(srv.port, [`${line}\r\nHost: x\r\nConnection: close\r\n\r\n`]); if (r.status === 200) bad.push(`${line} -> 200 ${r.resp.slice(-80)}`); }
    assert.deepEqual(bad, []);
    assert.ok(await alive(srv));
  });
  await check('error responses do not reflect internal exception text', async () => {
    const r = await http(srv, 'POST', '/help', { raw: 'null' });
    assert.doesNotMatch(r.text, /Cannot read|TypeError|properties of/, `400 body: ${r.text}`);
  }, 'Info');

  // ============================================================ 4. Help queue semantics
  sect('4-help');
  const post = async (args) => http(srv, 'POST', '/help', { body: args });
  const one = async (marker, args = {}) => { const r = await post({ note: marker, ...args }); assert.equal(r.status, 200); return (await findNote(srv, marker))[0]; };
  await check('POST {} creates an open, unverified "other" request; response has added + non-promising reply', async () => {
    const r = await post({ note: 'empty-ish' });
    assert.equal(r.json.added, true);
    assert.match(r.json.reply, /Do not promise/);
    const h = (await findNote(srv, 'empty-ish'))[0];
    assert.deepEqual([h.need, h.people, h.lang, h.status, h.label, h.source], [4, 1, 'en', 'open', 'unverified resident report', 'app']);
  });
  await check('need parsing: names, case, numbers, garbage', async () => {
    const cases = [['medical', 1], ['MEDICAL', 1], ['trapped', 3], ['2', 2], [2.5, 4], [0, 4], [-1, 4], ['banana', 4], [9, 4], [null, 4], [['1'], 1]];
    for (const [i, [v, want]] of cases.entries()) assert.equal((await one(`need-${i}`, { need: v })).need, want, `need ${JSON.stringify(v)}`);
  });
  await check('boolean parsing: "false"/"no"/0/{} -> false; "true"/"yes"/1/true -> true', async () => {
    const cases = [['false', false], ['no', false], [0, false], [{}, false], ['', false], ['true', true], ['YES', true], [1, true], [true, true], ['1', true]];
    for (const [i, [v, want]] of cases.entries()) {
      const h = await one(`bool-${i}`, { lifeThreat: v, vulnerable: v });
      assert.equal(h.lifeThreat, want, `lifeThreat ${JSON.stringify(v)}`); assert.equal(h.vulnerable, want, `vulnerable ${JSON.stringify(v)}`);
    }
  });
  await check('people parsing: "2.5"->2, "-1"->1, 1e9->255, "abc"->1, 0->1, "Infinity"->255', async () => {
    const cases = [['2.5', 2], ['-1', 1], [1e9, 255], ['abc', 1], [0, 1], ['Infinity', 255], [3, 3], ['0.4', 1]];
    for (const [i, [v, want]] of cases.entries()) assert.equal((await one(`people-${i}`, { people: v })).people, want, `people ${JSON.stringify(v)}`);
  });
  await check('lang: "es" kept; "ES"/"eng"/"" -> en; stored value is always a 2-letter string', async () => {
    assert.equal((await one('lang-es', { lang: 'es' })).lang, 'es');
    for (const [i, v] of ['ES', 'eng', ''].entries()) assert.equal((await one(`lang-bad-${i}`, { lang: v })).lang, 'en');
    const arr = await one('lang-arr', { lang: ['es'] });
    assert.equal(typeof arr.lang, 'string', `lang ["es"] stored as ${JSON.stringify(arr.lang)} (regex test coerces, raw value stored: core.mjs:67)`);
  }, 'Low');
  await check('lat/lon validated: strings, out of range and objects are not stored raw', async () => {
    const bad = [];
    for (const [i, [lat, lon]] of [['34.1', '-118.2'], [999, -999], [{ a: 1 }, [1, 2]], ['<script>', 'x']].entries()) {
      const h = await one(`latlon-${i}`, { lat, lon });
      if (!(h.lat === null || (typeof h.lat === 'number' && Math.abs(h.lat) <= 90))) bad.push(`lat ${JSON.stringify(lat)} stored as ${JSON.stringify(h.lat)}`);
      if (!(h.lon === null || (typeof h.lon === 'number' && Math.abs(h.lon) <= 180))) bad.push(`lon ${JSON.stringify(lon)} stored as ${JSON.stringify(h.lon)}`);
    }
    assert.deepEqual(bad, []);
  }, 'Low');
  await check('lat/lon length bounded: a 90 KB lat string must not be persisted (note is capped at 500)', async () => {
    const h = await one('latlon-huge', { lat: 'L'.repeat(90_000) });
    const len = JSON.stringify(h.lat).length;
    assert.ok(len < 1000, `lat stored with ${len} chars; persisted to queue.json and rewritten on every save (unbounded per-request storage)`);
  }, 'Medium');
  await check('note capped at 500 chars; "location" used when note absent', async () => {
    const h = await one('cap-note', { note: `cap-note${'x'.repeat(2000)}` });
    assert.equal(h.note.length, 500);
    await post({ location: 'loc-only-marker Building 7' });
    assert.equal((await findNote(srv, 'loc-only-marker')).length, 1);
  });
  await check('XSS note stored raw by API, served as application/json; console renders with textContent only', async () => {
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script> xss-marker';
    const h = await one('xss-marker', { note: xss });
    assert.equal(h.note, xss);
    const g = await http(srv, 'GET', '/help', { auth: sup });
    assert.match(g.headers.get('content-type'), /^application\/json/);
    const hq = readFileSync(join(WT, 'console/helpqueue.js'), 'utf8');
    assert.doesNotMatch(hq, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    assert.match(hq, /textContent: text/);
  });
  await check('callback_number in a resident POST sets the number the ladder will dial', async () => {
    const h = await one('cbnum', { callback_number: '+15550000000' });
    assert.equal(h.from, '+15550000000'); // documented as Low finding: unauthenticated client chooses who gets called
  });
  await check('same reqId+createdMin from app POST twice -> deduped (added:false)', async () => {
    const cm = nowMin();
    const a = await post({ reqId: 4242, createdMin: cm, note: 'dup-same' });
    const b = await post({ reqId: 4242, createdMin: cm, note: 'dup-same' });
    assert.deepEqual([a.json.added, b.json.added], [true, false]);
  });
  await check('two DIFFERENT residents colliding on 16-bit reqId in the same minute are both kept', async () => {
    const cm = nowMin();
    await post({ reqId: 31337, createdMin: cm, need: 'medical', lifeThreat: true, note: 'collide-A trapped on 3rd floor' });
    const b = await post({ reqId: 31337, createdMin: cm, need: 'mobility', note: 'collide-B wheelchair user' });
    const kept = (await findNote(srv, 'collide-')).length;
    assert.equal(kept, 2, `second request answered 200 added:${b.json.added} and was dropped (helpKey = reqId:createdMin, help.js:59). P(collision) with 50 residents/min ~ 1.9%`);
  }, 'Medium');
  await check('ranking: life threat > vulnerable > oldest; handled entries last', async () => {
    const cm = nowMin();
    const s2 = await startServer(); // fresh queue for a clean ordering check
    const p = (a) => http(s2, 'POST', '/help', { body: a });
    await p({ note: 'r-new', createdMin: cm }); await p({ note: 'r-old', createdMin: cm - 30 });
    await p({ note: 'r-vuln', vulnerable: true, createdMin: cm }); await p({ note: 'r-life-new', lifeThreat: true, createdMin: cm });
    await p({ note: 'r-life-old', lifeThreat: true, createdMin: cm - 5 }); await p({ note: 'r-done', lifeThreat: true, createdMin: cm - 60 });
    let q = await queueOf(s2);
    const done = q.find((h) => h.note === 'r-done');
    assert.equal((await http(s2, 'POST', '/help/handled', { body: { key: helpKey(done), by: 'Ana' }, auth: sup })).status, 200);
    q = await queueOf(s2);
    assert.deepEqual(q.map((h) => h.note), ['r-life-old', 'r-life-new', 'r-vuln', 'r-old', 'r-new', 'r-done']);
    await s2.stop(); // S1 stays up; its next save() rewrites queue.json from its own state
  });
  await check('markHandled: missing/blank name and unknown key -> 400; name trimmed to 80', async () => {
    const h = await one('handled-1');
    const key = helpKey(h);
    for (const b of [{ key }, { key, by: '' }, { key, by: '   ' }, { key: 'nope', by: 'Ana' }, {}, { by: 'Ana' }]) assert.equal((await http(srv, 'POST', '/help/handled', { body: b, auth: sup })).status, 400, JSON.stringify(b));
    assert.equal((await http(srv, 'POST', '/help/handled', { body: { key, by: `Ana ${'x'.repeat(200)}` }, auth: sup })).status, 200);
    const after = (await findNote(srv, 'handled-1'))[0];
    assert.equal(after.status, 'handled'); assert.equal(after.handledBy.length, 80);
  });
  await check('double handled: second close must not silently overwrite who closed it / reset PII clock', async () => {
    const h = await one('handled-2');
    await http(srv, 'POST', '/help/handled', { body: { key: helpKey(h), by: 'Ana' }, auth: sup });
    const first = (await findNote(srv, 'handled-2'))[0];
    await delay(5);
    const r = await http(srv, 'POST', '/help/handled', { body: { key: helpKey(h), by: 'Mallory' }, auth: sup });
    const second = (await findNote(srv, 'handled-2'))[0];
    assert.ok(r.status === 409 || (second.handledBy === 'Ana' && second.handledAt === first.handledAt), `second close -> ${r.status}, handledBy now "${second.handledBy}", handledAt moved ${second.handledAt - first.handledAt} ms (core.mjs:114)`);
  }, 'Low');
  await check('by as non-string (number 0, object) accepted as a "name"', async () => {
    const h = await one('handled-3');
    const r = await http(srv, 'POST', '/help/handled', { body: { key: helpKey(h), by: { x: 1 } }, auth: sup });
    assert.equal(r.status, 400, `by={x:1} -> ${r.status}, handledBy="${(await findNote(srv, 'handled-3'))[0].handledBy}"`);
  }, 'Info');

  // ============================================================ 5. Retell functions + webhook (mock mode)
  sect('5-retell');
  const fn = (name, args, call) => http(srv, 'POST', '/retell/function', { body: { name, args, call } });
  const hook = (event, call) => http(srv, 'POST', '/retell/webhook', { body: { event, call } });
  await check('get_active_alerts with no alerts, every language incl. unsupported: 911 advice, never "safe"/"official"', async () => {
    for (const language of ['en', 'es', 'zh', 'ko', 'hy', 'xx', 'zz-ZZ', '', undefined, 42, null]) {
      const r = await fn('get_active_alerts', { language });
      assert.equal(r.status, 200);
      assert.match(r.text, /911/); assert.match(r.text, /Do not tell the caller they are safe/); assert.doesNotMatch(r.text, /official/i);
    }
  });
  await check('report_need field-type variants -> correct reply + entry; life threat reply says 911', async () => {
    const r1 = await fn('report_need', { need: 'trapped', life_threat: 'yes', people: '3', language: 'es', note: 'rn-life' }, { call_id: 'rn-call-1', from_number: '+15550000001' });
    assert.match(r1.text, /LIFE THREAT.*911/);
    const r2 = await fn('report_need', { need: 2, life_threat: false, vulnerable: 'true', people: 2.9, note: 'rn-mob' }, { call_id: 'rn-call-2' });
    assert.match(r2.text, /Do not promise/);
    const [a] = await findNote(srv, 'rn-life'); const [b] = await findNote(srv, 'rn-mob');
    assert.deepEqual([a.need, a.lifeThreat, a.people, a.lang, a.callId, a.from, a.source], [3, true, 3, 'es', 'rn-call-1', '+15550000001', 'phone (mock)']);
    assert.deepEqual([b.need, b.lifeThreat, b.vulnerable, b.people], [2, false, true, 2]);
    for (const args of [null, 'str', [], 7]) assert.equal((await fn('report_need', args)).status, 200, `args ${JSON.stringify(args)}`);
  });
  await check('unknown / missing function name -> 404', async () => {
    assert.equal((await fn('delete_everything', {})).status, 404);
    assert.equal((await http(srv, 'POST', '/retell/function', { body: {} })).status, 404);
  });
  await check('call_started / transcript_updated / unknown events are ignored (204, nothing queued)', async () => {
    const before = (await queueOf(srv)).length;
    for (const ev of ['call_started', 'transcript_updated', 'whatever', undefined]) assert.equal((await hook(ev, { call_id: 'ign-1', transcript: 'help me I am trapped in fire' })).status, 204);
    assert.equal((await queueOf(srv)).length, before);
  });
  const byCall = async (id) => (await queueOf(srv)).filter((h) => h.callId === id);
  await check('call_ended missing / empty / garbage / non-string transcript -> one review entry "no usable transcript"', async () => {
    for (const [i, t] of [undefined, '', '!!! ??? 123 ...', { a: 1 }, ['help', 'me', 'now']].entries()) {
      await hook('call_ended', { call_id: `t-${i}`, transcript: t });
      const e = await byCall(`t-${i}`);
      assert.equal(e.length, 1, `case ${i}`); assert.match(e[0].note, /no usable transcript/); assert.equal(e[0].reviewOnly, true); assert.equal(e[0].status, 'open');
    }
  });
  await check('huge transcript (90 KB) -> note capped (~520 chars)', async () => {
    await hook('call_ended', { call_id: 't-huge', transcript: 'please send help now '.repeat(4500) });
    assert.ok((await byCall('t-huge'))[0].note.length <= 520);
  });
  await check('Spanish life words (inconsciente, sangrando, atrapada, incendio) -> lifeThreat', async () => {
    for (const [i, t] of ['Mi madre está inconsciente ayuda', 'Mi hijo está sangrando mucho', 'Estoy atrapada en mi casa', 'Hay un incendio en el edificio'].entries()) {
      await hook('call_ended', { call_id: `es-${i}`, transcript: t });
      assert.equal((await byCall(`es-${i}`))[0].lifeThreat, true, t);
    }
  });
  await check('Spanish "no puedo respirar" / "no puede respirar" (cannot breathe) -> lifeThreat', async () => {
    const miss = [];
    for (const [i, t] of ['Ayuda no puedo respirar por favor', 'Mi esposo no puede respirar', 'Tiene dolor de pecho fuerte'].entries()) {
      await hook('call_ended', { call_id: `es2-${i}`, transcript: t });
      if (!(await byCall(`es2-${i}`))[0].lifeThreat) miss.push(t);
    }
    assert.deepEqual(miss, [], 'LIFE regex (core.mjs:55) has only "no respira"; ranking falls back to normal');
  }, 'Medium');
  await check('Chinese transcript keeps its content for the human reviewer (not "no usable transcript")', async () => {
    const t = '我的孩子没有呼吸请快点来我们在三楼'; // unspaced, as Chinese is normally written
    await hook('call_ended', { call_id: 'zh-1', transcript: t });
    const [e] = await byCall('zh-1');
    assert.match(e.note, /孩子/, `note = "${e.note}" (\\p{L}{2,} counts an unspaced CJK run as one word, core.mjs:96)`);
  }, 'Low');
  await check('call_analyzed after call_ended updates the same entry (no second entry)', async () => {
    await hook('call_ended', { call_id: 'ca-1', transcript: '' });
    await hook('call_analyzed', { call_id: 'ca-1', transcript: 'my neighbour is not breathing please come' });
    const e = await byCall('ca-1');
    assert.equal(e.length, 1); assert.equal(e[0].lifeThreat, true); assert.match(e[0].note, /not breathing/);
  });
  await check('duplicate deliveries (x3) of call_ended / call_analyzed -> one entry', async () => {
    for (let i = 0; i < 3; i++) { await hook('call_ended', { call_id: 'dup-1', transcript: 'I need water and food please' }); await hook('call_analyzed', { call_id: 'dup-1', transcript: 'I need water and food please' }); }
    assert.equal((await byCall('dup-1')).length, 1);
  });
  await check('report_need during call then call_ended: agent entry kept, note not overwritten, life raised', async () => {
    await fn('report_need', { need: 'medical', note: 'agent-recorded-note' }, { call_id: 'rc-1' });
    await hook('call_ended', { call_id: 'rc-1', transcript: 'caller said there is a fire in the kitchen' });
    const e = await byCall('rc-1');
    assert.equal(e.length, 1); assert.equal(e[0].note, 'agent-recorded-note'); assert.equal(e[0].lifeThreat, true);
  });
  await check('webhook duplicates WITHOUT call_id do not create extra entries', async () => {
    const before = (await queueOf(srv)).length;
    for (let i = 0; i < 3; i++) await hook('call_ended', { transcript: 'no id call please call me back' });
    const added = (await queueOf(srv)).length - before;
    assert.equal(added, 1, `${added} entries from 3 identical deliveries`);
  }, 'Low');
  await check('malformed webhook bodies (null, [], string, call:null, call:"x") -> 204, no crash', async () => {
    for (const raw of ['null', '[]', '"x"', '{"event":"call_ended","call":null}', '{"event":"call_ended","call":"x"}', '{"event":"call_ended","call":{"metadata":null}}']) assert.equal((await http(srv, 'POST', '/retell/webhook', { raw })).status, 204, raw);
    assert.ok(await alive(srv));
  });

  // ============================================================ 6. Callback ladder (mock, RETRY_MS 3 s)
  sect('6-ladder');
  const cbStart = (key) => http(srv, 'POST', '/help/callback', { body: { key }, auth: sup });
  const cbOf = async (marker) => (await findNote(srv, marker))[0]?.callback;
  async function watch(marker, untilStep, ms) {
    const t0 = Date.now(), seen = [];
    while (Date.now() - t0 < ms) { const s = (await cbOf(marker))?.step; if (seen.at(-1)?.step !== s) seen.push({ step: s, t: Date.now() - t0 }); if (s === untilStep) break; await delay(100); }
    return seen;
  }
  await check('mock ladder end-to-end: call 1 -> call 2 (~3 s) -> sms skipped -> door knock (~6 s)', async () => {
    const h = await one('lad-1', { callback_number: '+15550000002' });
    const r = await cbStart(helpKey(h));
    assert.deepEqual(r.json, { step: 'call 1', mock: true });
    const seen = await watch('lad-1', 'door knock', 9000);
    metrics.ladder = seen;
    assert.deepEqual(seen.map((s) => s.step), ['call 1', 'call 2', 'door knock']);
    const c2 = seen[1].t, dk = seen[2].t;
    assert.ok(c2 > 2700 && c2 < 3700, `call 2 at ${c2} ms`); assert.ok(dk > 5700 && dk < 6900, `door knock at ${dk} ms`);
    const cb = await cbOf('lad-1');
    assert.match(cb.log.join('\n'), /sms: no provider configured, skipped/);
    assert.equal((await findNote(srv, 'lad-1'))[0].status, 'open'); // never auto-closed
  });
  await check('callback on handled request -> 400; unknown/missing key -> 404', async () => {
    const h = await one('lad-2', { callback_number: '+15550000003' });
    await http(srv, 'POST', '/help/handled', { body: { key: helpKey(h), by: 'Ana' }, auth: sup });
    assert.equal((await cbStart(helpKey(h))).status, 400);
    assert.equal((await cbStart('no:such:key')).status, 404);
    assert.equal((await http(srv, 'POST', '/help/callback', { body: {}, auth: sup })).status, 404);
  });
  await check('callback for request without a phone number -> door knock immediately', async () => {
    const h = await one('lad-3');
    assert.equal((await cbStart(helpKey(h))).json.step, 'door knock');
  });
  await check('second callback on a running ladder is refused / does not start a parallel ladder', async () => {
    const h = await one('lad-4', { callback_number: '+15550000004' });
    await cbStart(helpKey(h));
    await delay(1500);
    const second = await cbStart(helpKey(h));
    const t0 = Date.now();
    const seen = await watch('lad-4', 'door knock', 9000);
    const dk = seen.find((s) => s.step === 'door knock')?.t;
    assert.ok(second.status === 409 || dk >= 2 * RETRY_MS - 300, `second POST -> ${second.status} ${second.text}; door knock ${dk} ms after restart (expected >= ${2 * RETRY_MS}): two timer chains advance the same ladder (server.mjs:88-93, core.mjs:137)`);
    void t0;
  }, 'Medium');
  await check('webhook outcome "answered" (spoke >= 3 words) stops the ladder, status stays open', async () => {
    const h = await one('lad-5', { callback_number: '+15550000005' });
    await cbStart(helpKey(h));
    await hook('call_ended', { call_id: 'cb-5', metadata: { helpKey: helpKey(h) }, disconnection_reason: 'user_hangup', transcript: 'yes hello I am here and okay' });
    await delay(RETRY_MS + 800);
    const e = (await findNote(srv, 'lad-5'))[0];
    assert.equal(e.callback.step, 'answered'); assert.equal(e.status, 'open');
  });
  await check('webhook outcomes silent / voicemail / machine are NOT reached (in-process)', () => {
    for (const reason of ['user_hangup', 'voicemail_reached', 'machine_detected', 'dial_busy', 'inactivity']) {
      const h = { status: 'open', from: '+1555', callback: null }; startCallback(h);
      const transcript = reason === 'user_hangup' ? '' : 'hi you have reached the voicemail of';
      assert.equal(callbackOutcome(h, { disconnection_reason: reason, transcript }), 'call 2', reason);
    }
  });
  await check('duplicate delivery of one callback call_ended advances the ladder only one step (HTTP)', async () => {
    const h = await one('lad-6', { callback_number: '+15550000006' });
    await cbStart(helpKey(h));
    const ev = { call_id: 'cb-6', metadata: { helpKey: helpKey(h) }, disconnection_reason: 'dial_no_answer' };
    await hook('call_ended', ev); await hook('call_ended', ev);
    await delay(200);
    const step = (await cbOf('lad-6')).step;
    assert.equal(step, 'call 2', `after 2 identical deliveries step = "${step}" (handleRetellWebhook has no call_id dedupe for callbacks, core.mjs:91-93)`);
  }, 'Medium');
  await check('duplicate delivery of one callback call_ended advances one step (in-process, no mock timers)', () => {
    const st = createState();
    reportNeed(st, { reqId: 9, createdMin: nowMin(), callback_number: '+1555' }, { source: 'app' });
    const h = st.help[0]; startCallback(h);
    const ev = { event: 'call_ended', call: { call_id: 'cb-x', metadata: { helpKey: helpKey(h) }, disconnection_reason: 'dial_no_answer' } };
    handleRetellWebhook(st, ev); handleRetellWebhook(st, ev);
    assert.equal(h.callback.step, 'call 2', `step = ${h.callback.step}`);
  }, 'Medium');
  await check('callback where only the agent spoke (Retell "Agent:/User:" transcript, user silent) is NOT "answered"', () => {
    const h = { status: 'open', from: '+1555', callback: null }; startCallback(h);
    const step = callbackOutcome(h, { disconnection_reason: 'user_hangup', transcript: 'Agent: Hello, this is the CHIRP help line calling you back about your request.\nUser: ' });
    assert.equal(step, 'call 2', `step = "${step}": word count includes the agent's own lines (core.mjs:147), so a silent pickup stops the ladder`);
  }, 'High');
  await check('mock mode: unsigned forged webhook can mark a ladder "answered" (no auth on /retell/*)', async () => {
    const h = await one('lad-7', { callback_number: '+15550000007' });
    await cbStart(helpKey(h));
    await hook('call_ended', { metadata: { helpKey: helpKey(h) }, disconnection_reason: 'user_hangup', transcript: 'forged by anyone who can reach the port' });
    assert.notEqual((await cbOf('lad-7')).step, 'answered', 'escalation stopped by an unauthenticated request');
  }, 'Medium');

  // ============================================================ 7. Concurrency
  sect('7-concurrency');
  await srv.stop();
  srv = await startServer();
  await check('200 parallel POST /help: all 200, each retained exactly once, queue.json valid and consistent', async () => {
    const cm = nowMin();
    const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => http(srv, 'POST', '/help', { body: { reqId: 10_000 + i, createdMin: cm, note: `conc-${i}` } })));
    metrics.parallel200 = stats(rs.map((r) => r.ms));
    assert.ok(rs.every((r) => r.status === 200 && r.json.added === true));
    const q = (await queueOf(srv)).filter((h) => h.note.startsWith('conc-'));
    assert.equal(q.length, 200); assert.equal(new Set(q.map(helpKey)).size, 200);
    const file = readQueue().help.filter((h) => h.note.startsWith('conc-'));
    assert.equal(file.length, 200);
    assert.equal(existsSync(QTMP), false, '.tmp left behind');
  });
  await check('50 parallel handled + 50 parallel polls: all succeed, exactly those 50 handled', async () => {
    const q = (await queueOf(srv)).filter((h) => h.note.startsWith('conc-')).slice(0, 50);
    const rs = await Promise.all([...q.map((h, i) => http(srv, 'POST', '/help/handled', { body: { key: helpKey(h), by: `vol-${i}` }, auth: sup })), ...q.map(() => http(srv, 'GET', '/help', { auth: sup }))]);
    metrics.mixedHandledPoll = stats(rs.map((r) => r.ms));
    assert.ok(rs.every((r) => r.status === 200));
    const after = (await queueOf(srv)).filter((h) => h.note.startsWith('conc-'));
    assert.equal(after.filter((h) => h.status === 'handled').length, 50);
    assert.equal(readQueue().help.filter((h) => h.status === 'handled').length, 50);
  });
  await check('50 parallel identical POSTs -> exactly one added:true, one entry', async () => {
    const cm = nowMin();
    const rs = await Promise.all(Array.from({ length: 50 }, () => http(srv, 'POST', '/help', { body: { reqId: 777, createdMin: cm, note: 'same-par' } })));
    assert.equal(rs.filter((r) => r.json.added).length, 1);
    assert.equal((await findNote(srv, 'same-par')).length, 1);
  });
  await check('20 parallel webhooks for the same call_id -> one entry', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => http(srv, 'POST', '/retell/webhook', { body: { event: i % 2 ? 'call_analyzed' : 'call_ended', call: { call_id: 'par-call', transcript: 'please send someone to check on us' } } })));
    assert.equal((await queueOf(srv)).filter((h) => h.callId === 'par-call').length, 1);
  });
  await check('sequential latency, small queue (100 POST /help)', async () => {
    const ms = [];
    for (let i = 0; i < 100; i++) ms.push((await http(srv, 'POST', '/help', { body: { note: `seq-${i}` } })).ms);
    metrics.seq100 = stats(ms);
  });
  await srv.stop();
  await check('latency with 20,000 queued requests (save() rewrites whole file per POST)', async () => {
    const cm = nowMin();
    const help = Array.from({ length: 20_000 }, (_, i) => ({ need: 4, lifeThreat: false, vulnerable: false, people: 1, lang: 'en', msgId: 0, reqId: i, lat: null, lon: null, createdMin: cm, source: 'app', callId: null, from: null, note: `seed-${i} synthetic`, label: 'unverified resident report', status: 'open' }));
    srv = await startServer({ queue: { alerts: [], help } });
    const ms = [];
    for (let i = 0; i < 50; i++) ms.push((await http(srv, 'POST', '/help', { body: { note: `big-${i}` } })).ms);
    metrics.seq50at20k = stats(ms);
    const g = []; for (let i = 0; i < 10; i++) g.push((await http(srv, 'GET', '/help', { auth: sup })).ms);
    metrics.get20k = stats(g);
    metrics.queueBytes20k = readFileSync(QFILE).length;
    await srv.stop();
  });

  // ============================================================ 8. Persistence / durability
  sect('8-persistence');
  await check('queue survives a restart (same keys, same fields)', async () => {
    srv = await startServer();
    for (const n of ['p-1', 'p-2', 'p-3']) await http(srv, 'POST', '/help', { body: { note: n, lifeThreat: n === 'p-2' } });
    const before = (await queueOf(srv)).map(helpKey);
    await srv.stop();
    srv = await startServer({ keepQueue: true });
    assert.deepEqual((await queueOf(srv)).map(helpKey), before);
    await srv.stop();
  });
  await check('SIGKILL during a burst of 300 POSTs leaves a valid queue.json', async () => {
    srv = await startServer();
    const burst = Array.from({ length: 300 }, (_, i) => http(srv, 'POST', '/help', { body: { note: `kill-${i}` } }).catch(() => null));
    for (let i = 0; i < 200 && !existsSync(QFILE); i++) await delay(5); // kill as soon as saving has started
    await srv.stop('SIGKILL');
    await Promise.all(burst);
    const q = readQueue();
    assert.ok(Array.isArray(q.help));
    metrics.killBurstSaved = q.help.length;
  });
  for (const [label, content] of [['corrupt JSON', '{"help":[{"note":"x"'], ['empty file', ''], ['binary junk', '\u0000\u0001garbage']]) {
    await check(`${label} queue.json -> refuses to start (exit 1) and file untouched`, async () => {
      const s = await startServer({ queue: content, expectExit: true });
      assert.equal(s.code, 1, `exit ${s.code}`);
      assert.equal(readFileSync(QFILE, 'utf8'), content);
    });
  }
  for (const [label, content] of [['[] (array)', '[]'], ['null', 'null'], ['"string"', '"x"']]) {
    await check(`queue.json ${label} -> starts and works (ignored shape)`, async () => {
      srv = await startServer({ queue: content });
      assert.equal((await http(srv, 'POST', '/help', { body: { note: 'shape' } })).status, 200);
      assert.equal((await http(srv, 'GET', '/help', { auth: sup })).status, 200);
      await srv.stop();
    });
  }
  for (const [label, content] of [['help: null', '{"alerts":[],"help":null}'], ['help: {}', '{"alerts":[],"help":{}}'], ['alerts: "x"', '{"alerts":"x","help":[]}']]) {
    await check(`queue.json with ${label} is refused at startup (not a server that starts and then fails every request)`, async () => {
      const s = await startServer({ queue: content, expectExit: true });
      if (s.code === undefined) {
        const codes = [(await http(s, 'POST', '/help', { body: { note: 'x' } })).status, (await http(s, 'GET', '/help', { auth: sup })).status, (await http(s, 'GET', '/alerts')).status];
        await s.stop();
        assert.fail(`server started; POST /help, GET /help, GET /alerts -> ${codes.join(', ')} (server.mjs:29 only checks JSON syntax)`);
      }
    }, 'Low');
  }
  await check('leftover queue.json.tmp is ignored and replaced on first save', async () => {
    clearQueue(); writeFileSync(QTMP, '{garbage');
    srv = await startServer({ keepQueue: true });
    await http(srv, 'POST', '/help', { body: { note: 'tmp-test' } });
    assert.equal(existsSync(QTMP), false);
    assert.equal(readQueue().help.length, 1);
    await srv.stop();
  });
  await check('PII pruning: >24 h entries dropped, handled >1 h stripped of note/from/lat/lon after a save', async () => {
    const cm = nowMin();
    const base = { need: 4, people: 1, lang: 'en', msgId: 0, source: 'app', callId: null, label: 'unverified resident report' };
    const help = [
      { ...base, reqId: 1, createdMin: cm - 25 * 60, note: 'old-pii', from: '+1555', lat: 34, lon: -118, status: 'open' },
      { ...base, reqId: 2, createdMin: cm - 120, note: 'handled-pii', from: '+1556', lat: 34, lon: -118, status: 'handled', handledBy: 'Ana', handledAt: Date.now() - 2 * 3600_000 },
      { ...base, reqId: 3, createdMin: cm - 10, note: 'fresh', from: '+1557', lat: 34, lon: -118, status: 'open' },
    ];
    srv = await startServer({ queue: { alerts: [], help } });
    metrics.staleVisibleBeforeSave = (await queueOf(srv)).some((h) => h.note === 'old-pii');
    await http(srv, 'POST', '/help', { body: { note: 'trigger-save' } });
    const q = await queueOf(srv);
    assert.equal(q.some((h) => h.note === 'old-pii'), false);
    const hd = q.find((h) => h.reqId === 2);
    assert.deepEqual([hd.note, hd.from, hd.lat, hd.lon], ['', null, null, null]);
    assert.equal(q.find((h) => h.reqId === 3).note, 'fresh');
    assert.doesNotMatch(readFileSync(QFILE, 'utf8'), /old-pii|handled-pii|\+1555|\+1556/);
    await srv.stop();
  });
  await check('far-past createdMin: request answered added:true must not be silently discarded', async () => {
    srv = await startServer();
    const r = await http(srv, 'POST', '/help', { body: { note: 'past-created', createdMin: nowMin() - 25 * 60, lifeThreat: true } });
    const kept = (await findNote(srv, 'past-created')).length;
    await srv.stop();
    assert.ok(kept === 1 || r.json?.added === false || r.status >= 400, `POST -> ${r.status} ${JSON.stringify(r.json)}, but entry not in queue (pruned by save(), server.mjs:35/core.mjs:122). Receiver outbox flushed after >24 h offline would show "delivered".`);
  }, 'High');
  await check('future createdMin cannot exempt a request from 24 h PII retention', () => {
    const st = createState();
    reportNeed(st, { note: 'future-created', createdMin: nowMin() + 10 * 365 * 24 * 60, callback_number: '+1555' }, { source: 'app' });
    pruneHelp(st, Date.now() + RETAIN_MS.all + 3600_000);
    assert.equal(st.help.length, 0, 'entry with client-chosen future createdMin survives pruning (kept "forever")');
  }, 'Medium');
  await check('client cannot jump the queue by back-dating createdMin (oldest-first ranking trusts client clock)', async () => {
    srv = await startServer();
    const cm = nowMin();
    await http(srv, 'POST', '/help', { body: { note: 'honest-early', vulnerable: true, createdMin: cm - 5 } });
    await http(srv, 'POST', '/help', { body: { note: 'backdated-late', vulnerable: true, createdMin: cm - 23 * 60 } });
    const q = (await queueOf(srv)).map((h) => h.note);
    await srv.stop();
    assert.ok(q.indexOf('honest-early') < q.indexOf('backdated-late'), `order: ${q.join(' > ')}`);
  }, 'Low');
  await check('restart mid-ladder: escalation resumes (or is visibly flagged), never silently stops', async () => {
    srv = await startServer();
    await http(srv, 'POST', '/help', { body: { note: 'restart-ladder', callback_number: '+15550000009' } });
    const h = (await findNote(srv, 'restart-ladder'))[0];
    await http(srv, 'POST', '/help/callback', { body: { key: helpKey(h) }, auth: sup });
    await delay(RETRY_MS + 600); // now at 'call 2' in memory
    const before = (await findNote(srv, 'restart-ladder'))[0].callback?.step;
    const persisted = readQueue().help.find((x) => x.note === 'restart-ladder').callback?.step ?? 'none';
    await srv.stop();
    srv = await startServer({ keepQueue: true });
    await delay(2 * RETRY_MS + 1000);
    const after = (await findNote(srv, 'restart-ladder'))[0].callback?.step ?? 'none';
    await srv.stop();
    metrics.restartLadder = { inMemoryBeforeKill: before, persistedBeforeKill: persisted, afterRestartPlus7s: after };
    assert.equal(after, 'door knock', `in memory "${before}", persisted "${persisted}", after restart + 7 s "${after}" (timers are not persisted; mock call steps never save(), server.mjs:53-55)`);
  }, 'High');
  await check('client aborting a POST body mid-upload does not crash the server', async () => {
    srv = await startServer();
    await rawHttp(srv.port, [postHead('/help', 1000), '{"note":"aborted'], { abortAfter: 50 });
    await delay(400);
    const up = await alive(srv);
    const code = srv.code;
    await srv.stop();
    assert.ok(up, `server process exited (${code}): unhandled 'aborted' rejection from for-await in async handler (server.mjs:71,76). ${srv.out.split('\n').find((l) => /Error/.test(l)) || ''}`);
  }, 'Critical');
  await check('aborted upload on a path that is not a route (GET with body) also crashes? (same root cause)', async () => {
    srv = await startServer();
    await rawHttp(srv.port, ['GET /alerts HTTP/1.1\r\nHost: x\r\nContent-Length: 500\r\n\r\n{'], { abortAfter: 50 });
    await delay(400);
    const up = await alive(srv);
    await srv.stop();
    assert.ok(up, 'server exited after an aborted GET-with-body (no auth, no content-type needed)');
  }, 'Critical');

  // ============================================================ 9. publishAlert (in-process, throwaway keys) + HTTP refusal
  sect('9-alerts');
  const kpA = nacl.sign.keyPair(), kpB = nacl.sign.keyPair(), kpX = nacl.sign.keyPair();
  TRUSTED_KEYS.push({ id: 'audit-a', name: 'AUDIT throwaway A', publicKey: bytesToB64(kpA.publicKey) }, { id: 'audit-b', name: 'AUDIT throwaway B', publicKey: bytesToB64(kpB.publicKey) });
  const wire = (kp, { type = 1, detail = 0, zone = 1, expiresMin = nowMin() + 60, msgId = 1 } = {}) => { const body = packBody({ type, detail, zone, expiresMin, msgId }); return toWire(body, nacl.sign.detached(body, kp.secretKey)); };
  await check('signed by trusted throwaway key -> accepted; readout says "Signed CHIRP demo alert"', () => {
    const st = createState();
    publishAlert(st, wire(kpA));
    assert.equal(st.alerts.length, 1);
    assert.match(activeAlertsText(st, 'en'), /^Signed CHIRP demo alert from AUDIT throwaway A/);
  });
  await check('unsigned / untrusted / tampered / malformed wires refused', () => {
    const st = createState();
    const good = wire(kpA);
    const bytes = Buffer.from(good, 'base64'); bytes[3] ^= 1; // flip zone bit after signing
    const bad = [wire(kpX), Buffer.from(bytes).toString('base64'), Buffer.concat([Buffer.from(good, 'base64').subarray(0, 11), Buffer.alloc(64)]).toString('base64'), '', 'abc', '!!!!', good.slice(0, -4), `${good}AAAA`, Buffer.from([2, ...Buffer.from(good, 'base64').subarray(1)]).toString('base64')];
    for (const w of bad) assert.throws(() => publishAlert(st, w), undefined, `accepted ${w.slice(0, 20)}`);
    assert.equal(st.alerts.length, 0);
    publishAlert(st, `  ${good}\n`); // surrounding whitespace tolerated
    assert.equal(st.alerts.length, 1);
  });
  await check('expired (expiresMin <= now) refused; now+1 accepted', () => {
    const st = createState();
    assert.throws(() => publishAlert(st, wire(kpA, { expiresMin: nowMin() })), /expired/);
    assert.throws(() => publishAlert(st, wire(kpA, { expiresMin: 1 })), /expired/);
    publishAlert(st, wire(kpA, { expiresMin: nowMin() + 1 }));
  });
  await check('re-publish dedupe is per issuer: same issuer+msgId replaces, other issuer same msgId coexists', () => {
    const st = createState();
    publishAlert(st, wire(kpA, { msgId: 5, type: 1 })); publishAlert(st, wire(kpA, { msgId: 5, type: 2 })); publishAlert(st, wire(kpB, { msgId: 5 }));
    assert.equal(st.alerts.length, 2);
    assert.equal(st.alerts.find((a) => a.senderId === 'audit-a').type, 2);
  });
  await check('server enforces the 12 h validity cap (console/receiver do)', () => {
    const st = createState();
    let accepted = false;
    try { publishAlert(st, wire(kpA, { expiresMin: nowMin() + 30 * 24 * 60 })); accepted = true; } catch {}
    assert.equal(accepted, false, '30-day alert accepted; phone line would read it for 30 days while receivers reject it (core.mjs:38)');
  }, 'Low');
  await check('readout never claims official authority, for every type x language', () => {
    const book = JSON.parse(readFileSync(join(WT, 'shared/phrasebook.json'), 'utf8'));
    const offenders = [];
    for (const type of Object.keys(book.types)) for (const lang of Object.keys(book.languages)) {
      const st = createState(); publishAlert(st, wire(kpA, { type: Number(type), detail: 0 }));
      const t = activeAlertsText(st, lang);
      if (/official|oficial|官方|공식|opisyal|chính thức|公式|официальн|պաշտոնական/i.test(t)) offenders.push(`type ${type}/${lang}`);
    }
    assert.deepEqual(offenders, [], 'phrasebook type 13 OFFICIAL_ALERT is read verbatim ("Official alert for this area") after "Signed CHIRP demo alert"; server-safety.mjs tests detail 13, not type 13');
  }, 'Medium');
  await check('language fallback: unsupported lang -> English text', () => {
    const st = createState(); publishAlert(st, wire(kpA, { type: 1 }));
    assert.equal(activeAlertsText(st, 'xx'), activeAlertsText(st, 'en'));
    assert.equal(activeAlertsText(st, undefined), activeAlertsText(st, 'en'));
    assert.match(activeAlertsText(st, 'es'), /EVAC/);
  });
  await check('language "__proto__"/"constructor"/"toString" fall back to English (no "[object Object]"/source code)', () => {
    const st = createState(); publishAlert(st, wire(kpA, { type: 1 }));
    const bad = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].filter((l) => /object Object|native code|function/.test(activeAlertsText(st, l)));
    assert.deepEqual(bad, [], `e.g. constructor -> ${JSON.stringify(activeAlertsText(st, 'constructor').slice(0, 140))} (say(): texts[lang] ?? texts.en, core.mjs:16)`);
  }, 'Low');
  await check('unknown type/detail/zone codes degrade gracefully', () => {
    const st = createState(); publishAlert(st, wire(kpA, { type: 250, detail: 250, zone: 65000 }));
    assert.match(activeAlertsText(st), /zone 65000/);
  });
  await check('HTTP POST /alerts: no token 401; random/missing/non-string wire -> 400 refused (committed keys only)', async () => {
    srv = await startServer();
    assert.equal((await http(srv, 'POST', '/alerts', { body: { wire: wire(kpA) } })).status, 401);
    const r = await http(srv, 'POST', '/alerts', { body: { wire: wire(kpA) }, auth: sup });
    assert.equal(r.status, 400); assert.match(r.text, /unsigned or untrusted/);
    for (const body of [{}, { wire: { a: 1 } }, { wire: 12345 }, { wire: 'x'.repeat(5000) }]) assert.equal((await http(srv, 'POST', '/alerts', { body, auth: sup })).status, 400, JSON.stringify(body).slice(0, 40));
    assert.ok(!existsSync(QFILE) || (readQueue().alerts ?? []).length === 0);
    await srv.stop();
  });
  await check('HTTP readout of a (seeded) type-13 alert over /alerts and get_active_alerts: no "official", no prototype junk', async () => {
    // queue.json alerts are loaded without re-verification (file is trusted); used here only to get an alert into the spawned server.
    srv = await startServer({ queue: { alerts: [{ version: 1, type: 13, detail: 0, zone: 1, expiresMin: nowMin() + 60, msgId: 9, senderId: 'seed', sender: 'AUDIT seeded' }], help: [] } });
    const texts = [(await http(srv, 'GET', '/alerts?lang=es')).text, (await http(srv, 'GET', '/alerts?lang=constructor')).text, (await http(srv, 'POST', '/retell/function', { body: { name: 'get_active_alerts', args: { language: '__proto__' } } })).text];
    await srv.stop();
    const bad = texts.filter((t) => /official|oficial|object Object|native code/i.test(t));
    assert.equal(bad.length, 0, bad.map((t) => JSON.stringify(t.split('\n')[0].slice(0, 150))).join(' | '));
  }, 'Medium');

  // ============================================================ 5b. Retell signature verification (RETELL_API_KEY=audit-key, no FROM)
  sect('5b-signature');
  srv = await startServer({ env: { RETELL_API_KEY: 'audit-key' } });
  const sHook = (raw, sig) => http(srv, 'POST', '/retell/webhook', { raw, headers: { 'Content-Type': 'application/json', ...(sig === undefined ? {} : { 'X-Retell-Signature': sig }) } });
  const ev = (id, t = 'please send someone here now') => JSON.stringify({ event: 'call_ended', call: { call_id: id, transcript: t } });
  await check('valid signature accepted (204); uppercase hex accepted', async () => {
    assert.equal((await sHook(ev('sig-1'), sign(ev('sig-1')))).status, 204);
    const ts = Date.now();
    assert.equal((await sHook(ev('sig-1u'), sign(ev('sig-1u'), 'audit-key', ts).replace(/d=(.*)/, (_, h) => `d=${h.toUpperCase()}`))).status, 204);
  });
  await check('missing / malformed / wrong-key / tampered / stale / far-future signatures -> 401, nothing queued', async () => {
    const raw = ev('sig-bad');
    const ts = Date.now();
    const cases = {
      missing: undefined, empty: '', junk: 'abc', noD: `v=${ts}`, emptyD: `v=${ts},d=`, oddHex: `v=${ts},d=abc`, spaced: ` ${sign(raw)} `.replace(',', ', '),
      wrongKey: sign(raw, 'not-the-key'), tampered: sign(raw.replace('please', 'pleasf')), stale: sign(raw, 'audit-key', ts - 5 * 60_000 - 5000),
      future: sign(raw, 'audit-key', ts + 5 * 60_000 + 5000), secondsTs: sign(raw, 'audit-key', Math.floor(ts / 1000)), negative: sign(raw, 'audit-key', -1),
    };
    const bad = [];
    for (const [k, sig] of Object.entries(cases)) { const r = await sHook(k === 'tampered' ? raw : raw, sig); if (r.status !== 401) bad.push(`${k} -> ${r.status}`); }
    assert.deepEqual(bad, []);
    assert.equal((await queueOf(srv)).filter((h) => h.callId === 'sig-bad').length, 0);
  });
  await check('signature also enforced on /retell/function and unknown /retell/* paths', async () => {
    assert.equal((await http(srv, 'POST', '/retell/function', { body: { name: 'report_need', args: { note: 'unsigned-fn' } } })).status, 401);
    assert.equal((await http(srv, 'POST', '/retell/anything', { body: {} })).status, 401);
    assert.equal((await findNote(srv, 'unsigned-fn')).length, 0);
  });
  await check('timestamp 4 min in the future is accepted (symmetric 5 min window) [observation]', async () => {
    assert.equal((await sHook(ev('sig-fut4'), sign(ev('sig-fut4'), 'audit-key', Date.now() + 4 * 60_000))).status, 204);
  }, 'Info');
  await check('replayed identical signed report_need within 5 min does not create a duplicate request', async () => {
    const raw = JSON.stringify({ name: 'report_need', args: { need: 'medical', note: 'replay-fn' }, call: { call_id: 'rp-1' } });
    const sig = sign(raw);
    const a = await http(srv, 'POST', '/retell/function', { raw, headers: { 'Content-Type': 'application/json', 'X-Retell-Signature': sig } });
    const b = await http(srv, 'POST', '/retell/function', { raw, headers: { 'Content-Type': 'application/json', 'X-Retell-Signature': sig } });
    const n = (await findNote(srv, 'replay-fn')).length;
    assert.equal(n, 1, `replay accepted (${a.status}, ${b.status}) and created ${n} entries (no nonce/replay cache; random reqId per call, core.mjs:69)`);
  }, 'Low');
  await check('replayed signed call_ended within 5 min is idempotent (dedupe by call_id)', async () => {
    const raw = ev('rp-2'), sig = sign(raw);
    await sHook(raw, sig); await sHook(raw, sig);
    assert.equal((await queueOf(srv)).filter((h) => h.callId === 'rp-2').length, 1);
  });
  await check('validly signed multilingual body split across TCP chunks is accepted', async () => {
    const raw = ev('sig-split', '我的孩子没有呼吸 please help us now');
    const sig = sign(raw);
    const buf = Buffer.from(raw);
    const cut = buf.indexOf(Buffer.from('孩')) + 1;
    const r = await rawHttp(srv.port, [postHead('/retell/webhook', buf.length, `X-Retell-Signature: ${sig}\r\n`), buf.subarray(0, cut), buf.subarray(cut)]);
    assert.equal(r.status, 204, `got ${r.status}: HMAC computed over chunk-wise decoded string (U+FFFD), server.mjs:76/80`);
  }, 'Medium');
  await check('verifyRetell unit: exact window edges', () => {
    const now = 1_700_000_000_000;
    assert.equal(verifyRetell('{}', sign('{}', 'k', now - 300_000), 'k', now), true);
    assert.equal(verifyRetell('{}', sign('{}', 'k', now - 300_001), 'k', now), false);
    assert.equal(verifyRetell('{}', null, 'k', now), false);
  });
  await srv.stop();

  // ============================================================ 10. Bind address
  sect('10-bind');
  srv = await startServer();
  await check('listens on 127.0.0.1 only: LAN IPv4 and ::1 refuse connections', async () => {
    const lan = Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i.address);
    metrics.lanAddresses = lan;
    const probe = (host) => new Promise((r) => { const s = net.connect(srv.port, host); s.on('connect', () => { s.destroy(); r('open'); }); s.on('error', (e) => r(e.code)); });
    const out = { '127.0.0.1': await probe('127.0.0.1'), '::1': await probe('::1') };
    for (const ip of lan) out[ip] = await probe(ip);
    metrics.bind = out;
    assert.equal(out['127.0.0.1'], 'open');
    for (const [ip, v] of Object.entries(out)) if (ip !== '127.0.0.1') assert.notEqual(v, 'open', `${ip} reachable`);
    assert.ok(lan.length > 0, 'no LAN address to test');
  });
  await check('shared/config.js HELP_ENDPOINT is local (else the 127.0.0.1 bind is bypassed by a public tunnel)', () => {
    const cfg = readFileSync(join(WT, 'shared/config.js'), 'utf8');
    const ep = /HELP_ENDPOINT = '([^']*)'/.exec(cfg)?.[1] || '';
    metrics.helpEndpointHost = ep ? new URL(ep).host : '(empty)';
    assert.ok(!ep || /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(ep), `committed HELP_ENDPOINT host = ${new URL(ep).host} (public tunnel; not contacted)`);
  }, 'Info');
  await srv.stop();
  await check('every ACAO header seen during the run was the configured origin (never "*")', () => {
    assert.deepEqual([...acaoSeen], [ORIGIN]);
  });
} finally {
  for (const c of live) try { c.kill('SIGKILL'); } catch {}
  await delay(100);
  clearQueue();
  if (backupDir) { renameSync(join(backupDir, 'queue.json'), QFILE); console.log('restored original queue.json'); }
}

// ---------------------------------------------------------------- summary
const failed = results.filter((r) => !r.ok);
console.log('\n== metrics');
console.log(JSON.stringify(metrics, null, 1));
console.log('\n== summary');
const bySev = {};
for (const f of failed) bySev[f.sev] = (bySev[f.sev] || 0) + 1;
console.log(`${results.length - failed.length}/${results.length} checks passed; failures by severity: ${JSON.stringify(bySev)}`);
for (const f of failed) console.log(`  FAIL [${f.sev}] ${f.section} ${f.name}`);
if (failed.length) process.exitCode = 1;
