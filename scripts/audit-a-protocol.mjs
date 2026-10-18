// CHIRP testing audit, track A: protocol, crypto, receiver logic, help codec, CAP,
// SLOW rung, phrasebook, range pattern, audio channel, existing gates.
//
//   node scripts/audit-a-protocol.mjs              (full run, ~1-2 min)
//   AUDIT_SEED=123 node scripts/audit-a-protocol.mjs
//   AUDIT_FAST=1   node scripts/audit-a-protocol.mjs   (skip audio + gates)
//   AUDIT_FULL_WRAP=1 ...                           (real 65 537-message msgId wrap, ~8 min)
//
// PASS = behaviour is correct. FAIL = a real defect (or a gate that does not run).
// INFO = documented behaviour worth knowing, not counted as a failure.
// Never reads keys/*.secret: trusted signatures come from throwaway seeded keypairs
// pushed into the in-memory TRUSTED_KEYS array.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const nacl = (globalThis.nacl = require('../vendor/nacl-fast.min.js'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEED = Number(process.env.AUDIT_SEED || 20261017);
const FAST = !!process.env.AUDIT_FAST;

const { mulberry32, runAudio } = await import('./audit-a-audio.mjs');
const P = await import('../shared/payload.js');
const { packBody, unpackBody, toWire, fromWire, BODY_LEN, SIG_LEN, bytesToB64 } = P;
const { TRUSTED_KEYS } = await import('../shared/keys.js');
const { sign, verify } = await import('../shared/trust.js');
const { receiveChirp, outsideZone } = await import('../shared/receive.js');
const H = await import('../shared/help.js');
const { parseCap, matchZone, MAX_CAP_CHARS, MAX_VALID_MIN, DEFAULT_VALID_MIN } = await import('../console/cap.js');
const { waitSeconds, isWide, slowKey, COOLDOWN_MS } = await import('../console/slow.js');
const { makePattern, parsePattern, PATTERN_ZONE } = await import('../range/pattern.js');
const { acceptsDemo } = await import('../shared/demo-policy.js');
const srv = await import('../server/core.mjs');

const json = (p) => JSON.parse(readFileSync(`${ROOT}${p}`, 'utf8'));
const book = json('shared/phrasebook.json');
const zones = json('shared/zones.json');
const capMap = json('shared/cap-map.json');

// ---------------------------------------------------------------- harness
const results = [];
let current = '';
const section = (t) => { current = t; console.log(`\n== ${t}`); };
const record = (status, name, detail) => {
  results.push({ section: current, status, name, detail: String(detail ?? '') });
  console.log(`${status.padEnd(4)}  ${name}${detail !== '' && detail != null ? `  [${detail}]` : ''}`);
};
const check = (name, ok, detail = '') => record(ok ? 'PASS' : 'FAIL', name, detail);
const info = (name, detail = '') => record('INFO', name, detail);
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const ms = (fn) => { const t = performance.now(); let r, err; try { r = fn(); } catch (e) { err = e; } return { ms: performance.now() - t, r, err }; };
const rnd = mulberry32(SEED);
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const b64 = (u8) => Buffer.from(u8).toString('base64');
const eqBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const seedBytes = (n) => Uint8Array.from({ length: 32 }, () => ri(0, 255)).map((v, i) => (i === 0 ? n : v));

// Throwaway, seeded keys. audit-a is put FIRST so verify() is fast for our own alerts.
const kpA = nacl.sign.keyPair.fromSeed(seedBytes(1));
const kpB = nacl.sign.keyPair.fromSeed(seedBytes(2));
const kpC = nacl.sign.keyPair.fromSeed(seedBytes(3)); // never trusted
TRUSTED_KEYS.unshift({ id: 'audit-a', name: 'Audit key A', publicKey: b64(kpA.publicKey) });
TRUSTED_KEYS.push({ id: 'audit-b', name: 'Audit key B', publicKey: b64(kpB.publicKey) });
const sA = b64(kpA.secretKey), sB = b64(kpB.secretKey);
const NOW = 29_000_000; // fixed "now" in unix minutes (2025-02-19), so results are reproducible
const mk = (f, secret = sA) => { const body = packBody({ type: 1, detail: 2, zone: 2, expiresMin: NOW + 60, msgId: 4242, ...f }); return { body, wire: toWire(body, sign(body, secret)) }; };

console.log(`CHIRP audit track A · node ${process.version} · seed ${SEED} · ${new Date().toISOString()}`);

// ================================================================ 1. wire format
section('1. Wire format (shared/payload.js)');
{
  const corners = [];
  for (const type of [0, 255]) for (const detail of [0, 255]) for (const zone of [0, 65535]) for (const expiresMin of [0, 2 ** 32 - 1]) for (const msgId of [0, 65535]) corners.push({ type, detail, zone, expiresMin, msgId });
  const bnd = { type: [0, 1, 12, 13, 254, 255], detail: [0, 1, 13, 254, 255], zone: [0, 1, 99, 65534, 65535], expiresMin: [0, 1, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 2, 2 ** 32 - 1], msgId: [0, 1, 65534, 65535] };
  const max = { type: 255, detail: 255, zone: 65535, expiresMin: 2 ** 32 - 1, msgId: 65535 };
  const cases = [...corners];
  for (let i = 0; i < 20000; i++) {
    const f = {};
    for (const k of Object.keys(max)) f[k] = rnd() < 0.3 ? pick(bnd[k]) : Math.floor(rnd() * (max[k] + 1));
    cases.push(f);
  }
  let bad = 0, firstBad = '';
  for (const f of cases) {
    const body = packBody(f);
    const sig = Uint8Array.from({ length: 64 }, () => ri(0, 255));
    const wire = toWire(body, sig);
    const back = fromWire(wire);
    const u = unpackBody(back.body);
    const ok = body.length === BODY_LEN && wire.length === 100 && eqBytes(back.body, body) && eqBytes(back.sig, sig)
      && JSON.stringify(u) === JSON.stringify({ version: 1, ...f });
    if (!ok) { bad++; firstBad ||= JSON.stringify(f); }
  }
  check(`pack -> toWire -> fromWire -> unpack round-trips ${cases.length} cases (32 corner combos + randomized boundaries)`, bad === 0, bad ? `first bad ${firstBad}` : 'all 100-char wires');
  check('unpackBody works on a sub-view with non-zero byteOffset', (() => { const buf = new Uint8Array(20); buf.set(packBody({ type: 7, detail: 8, zone: 513, expiresMin: 123456, msgId: 9 }), 5); return unpackBody(buf.subarray(5, 16)).zone === 513; })());

  const wrap = [['type', 256], ['type', -1], ['zone', 65536], ['msgId', 65536], ['msgId', -1], ['expiresMin', -1], ['expiresMin', 2 ** 32], ['expiresMin', NaN], ['expiresMin', 1.9], ['expiresMin', undefined], ['type', '5']];
  const got = wrap.map(([k, v]) => { const u = unpackBody(packBody({ type: 1, detail: 1, zone: 1, expiresMin: 1, msgId: 1, [k]: v })); return `${k}=${String(v)}->${u[k]}`; });
  info('packBody never validates: out-of-range fields wrap silently (expiresMin -1 becomes 4294967295 = year 10136)', got.join(', '));

  const { wire } = mk({});
  const rej = {
    empty: '', '99 chars': wire.slice(0, 99), '101 chars': `${wire}A`, '96 chars (72 B)': wire.slice(0, 96),
    '104 chars (78 B)': wire + 'AAAA', 'non-base64 !': wire.slice(0, 50) + '!' + wire.slice(51), 'trailing =': `${wire}=`, 'trailing ==': `${wire}==`, 'trailing ====': `${wire}====`,
    'NBSP inside': wire.slice(0, 50) + ' ' + wire.slice(50), 'fullwidth A': wire.slice(0, 50) + 'Ａ' + wire.slice(51), 'NUL inside': wire.slice(0, 50) + '\0' + wire.slice(50),
  };
  for (const v of [0, 2, 9, 255]) { const all = Buffer.from(wire, 'base64'); all[0] = v; rej[`version ${v}`] = all.toString('base64'); }
  // URL-safe: find a wire with + or / and swap to - and _.
  let us = wire, n = 0;
  while (!/[+/]/.test(us) && n < 1000) us = mk({ msgId: ++n }).wire;
  rej['URL-safe (-_)'] = us.replace(/\+/g, '-').replace(/\//g, '_');
  const accepted = Object.entries(rej).filter(([, t]) => !throws(() => fromWire(t))).map(([k]) => k);
  check('fromWire rejects wrong length / version / non-base64 / URL-safe / bad padding / non-ASCII', accepted.length === 0, accepted.length ? `ACCEPTED: ${accepted.join(', ')}` : `${Object.keys(rej).length} variants rejected`);

  const variants = {
    'leading/trailing spaces': `  ${wire}  `, 'trailing CRLF': `${wire}\r\n`, 'space inside': wire.slice(0, 50) + ' ' + wire.slice(50),
    'MIME line breaks every 76': wire.slice(0, 76) + '\n' + wire.slice(76), 'tab inside': wire.slice(0, 10) + '\t' + wire.slice(10), 'form feed inside': wire.slice(0, 10) + '\f' + wire.slice(10),
    'trailing NBSP (trim)': `${wire} `,
  };
  const acc = Object.entries(variants).filter(([, t]) => { try { return eqBytes(fromWire(t).body, fromWire(wire).body); } catch { return false; } }).map(([k]) => k);
  info('fromWire accepts non-canonical encodings of the same 75 bytes (String.trim + forgiving-base64 atob strips ASCII whitespace)', acc.join(', '));
  const r1 = receiveChirp(variants['space inside'], NOW, new Set([wire, `audit-a:4242`]));
  check('a whitespace variant of an already-seen SIGNED wire is still deduped (key = signer:msgId)', r1.status === 'dup', r1.status);

  // Fuzz: random strings never crash receiveChirp and never verify.
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/= \n-_!é\u0000';
  let crash = 0, verified = 0, parsedOk = 0;
  for (let i = 0; i < 20000; i++) {
    const len = rnd() < 0.05 ? 100 : ri(0, 140);
    const s = Array.from({ length: len }, () => (rnd() < 0.97 ? alpha[ri(0, 63)] : alpha[ri(64, alpha.length - 1)])).join('');
    try { const r = receiveChirp(s, NOW, new Set()); if (r.entry?.sender) verified++; if (r.status === 'ok') parsedOk++; } catch { crash++; }
  }
  check('fuzz: 20 000 random strings -> receiveChirp never throws and nothing verifies', crash === 0 && verified === 0, `crash ${crash}, verified ${verified}, parsed-as-unverified ${parsedOk}`);
  const odd = [null, undefined, 123, {}, [], Symbol.iterator].map((v) => { try { return receiveChirp(v, NOW).status; } catch (e) { return `THREW ${e.constructor.name}`; } });
  check('receiveChirp(null/undefined/number/object/array/symbol) returns malformed, never throws', odd.every((s) => s === 'malformed'), odd.join(','));
}

// ================================================================ 2. signatures
section('2. Signatures (shared/trust.js, tweetnacl Ed25519)');
{
  const { body, wire } = mk({ msgId: 777 });
  const sig = fromWire(wire).sig;
  check('throwaway trusted key A verifies and is attributed to audit-a', verify(body, sig)?.id === 'audit-a');
  const all = Buffer.from(wire, 'base64');
  let bodyFlipsOk = 0, sigFlipsOk = 0, rxLeak = 0;
  const rxStatus = {};
  for (let bit = 0; bit < 75 * 8; bit++) {
    const f = Uint8Array.from(all); f[bit >> 3] ^= 1 << (bit & 7);
    const v = verify(f.slice(0, 11), f.slice(11));
    if (v === null) (bit < 88 ? bodyFlipsOk++ : sigFlipsOk++);
    const r = receiveChirp(b64(f), NOW, new Set());
    rxStatus[r.status] = (rxStatus[r.status] || 0) + 1;
    if (r.entry?.sender) rxLeak++;
  }
  check('every single-bit flip of the 11-byte body (88 bits) fails verify', bodyFlipsOk === 88, `${bodyFlipsOk}/88`);
  check('every single-bit flip of the 64-byte signature (512 bits) fails verify', sigFlipsOk === 512, `${sigFlipsOk}/512`);
  check('no bit-flipped wire is ever shown as verified by receiveChirp', rxLeak === 0, JSON.stringify(rxStatus));

  check('signature from an untrusted key is rejected', verify(body, nacl.sign.detached(body, kpC.secretKey)) === null);
  const body2 = packBody({ type: 11, detail: 0, zone: 2, expiresMin: NOW + 60, msgId: 777 });
  check('key confusion: A\'s signature over body1 presented with body2 is rejected', verify(body2, sig) === null);
  const sigB = sign(body, sB);
  check('same body signed by B is attributed to B, not A', verify(body, sigB)?.id === 'audit-b');
  check('A\'s signature with B\'s public key only (A removed from trust) is rejected', (() => { const a = TRUSTED_KEYS.shift(); const r = verify(body, sig); TRUSTED_KEYS.unshift(a); return r === null; })());
  const t63 = throws(() => verify(body, sig.slice(0, 63))), t65 = throws(() => verify(body, Uint8Array.from([...sig, 0])));
  const r63 = receiveChirp(b64(Uint8Array.from([...body, ...sig.slice(0, 63)])), NOW).status;
  info('verify() THROWS (not null) on 63/65-byte signatures; unreachable from receiveChirp because fromWire pins 75 bytes', `63B throws=${t63}, 65B throws=${t65}, receiveChirp(74-byte wire)=${r63}`);
  check('truncated / extended wires are malformed, never verified', r63 === 'malformed' && receiveChirp(b64(Uint8Array.from([...body, ...sig, 1])), NOW).status === 'malformed');
  const v2 = Uint8Array.from(body); v2[0] = 2;
  const sigV2 = sign(v2, sA);
  check('signature over a version-2 body does not verify a version-1 body', verify(body, sigV2) === null);
  check('a correctly signed version-2 wire is dropped as malformed', receiveChirp(toWire(v2, sigV2), NOW).status === 'malformed');
  check('all-zero and all-0xFF signatures rejected', verify(body, new Uint8Array(64)) === null && verify(body, new Uint8Array(64).fill(255)) === null);

  // Malleability: S' = S + L (group order) little-endian.
  const L = [0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10];
  const mal = Uint8Array.from(sig); let c = 0;
  for (let i = 0; i < 32; i++) { const s = mal[32 + i] + L[i] + c; mal[32 + i] = s & 255; c = s >> 8; }
  const malOk = verify(body, mal)?.id === 'audit-a';
  info('tweetnacl accepts a malleated signature (S+L): a second valid wire for the same alert exists', `accepted=${malOk}`);
  const seen = new Set([wire, 'audit-a:777']);
  check('malleated signature is still deduped (dedupe key is signer:msgId, not the wire)', receiveChirp(toWire(body, mal), NOW, seen).status === 'dup');
  // Small-order public key (identity point) + (R=identity, S=0) "universal" signature.
  const idKey = new Uint8Array(32); idKey[0] = 1;
  const idSig = new Uint8Array(64); idSig[0] = 1;
  TRUSTED_KEYS.push({ id: 'audit-identity', name: 'identity point', publicKey: b64(idKey) });
  const uni = verify(body2, idSig)?.id;
  TRUSTED_KEYS.pop();
  info('verify() does not reject small-order public keys: if such a key ever entered keys.js, one signature would verify EVERY body', `identity-point key verifies arbitrary body: ${uni === 'audit-identity'}`);
  const per = ms(() => { for (let i = 0; i < 50; i++) verify(body2, sig); });
  info(`verify cost scales linearly with TRUSTED_KEYS (${TRUSTED_KEYS.length} keys in this run): a rejected chirp costs ${(per.ms / 50).toFixed(2)} ms = ${(per.ms / 50 / TRUSTED_KEYS.length).toFixed(2)} ms per key (Node, this machine)`);
}

// ================================================================ 3. receiveChirp
section('3. Receiver decision (shared/receive.js)');
{
  const real = mk({ msgId: 100 });
  const seen = new Set();
  const feed = (w, now = NOW) => { const r = receiveChirp(w, now, seen); if (r.status === 'ok' || r.status === 'expired') { seen.add(w); if (r.key) seen.add(r.key); } return r; };
  let r = feed(real.wire);
  check('signed alert -> ok, sender audit-a', r.status === 'ok' && r.entry.sender?.id === 'audit-a' && r.key === 'audit-a:100');
  check('exact repeat -> dup', feed(real.wire).status === 'dup');
  check('same signer + msgId, different body (replay/mutation) -> dup', feed(mk({ msgId: 100, type: 11 }).wire).status === 'dup');
  r = feed(mk({ msgId: 100 }, sB).wire);
  check('same msgId from a different trusted signer -> ok (no cross-signer suppression)', r.status === 'ok' && r.entry.sender.id === 'audit-b');

  // Unsigned spoof sharing the real msgId: both orders.
  const s1 = new Set();
  const f1 = (w) => { const x = receiveChirp(w, NOW, s1); if (x.status === 'ok' || x.status === 'expired') { s1.add(w); s1.add(x.key); } return x; };
  const realBody = packBody({ type: 1, detail: 2, zone: 2, expiresMin: NOW + 60, msgId: 200 });
  const spoof = toWire(packBody({ type: 11, detail: 0, zone: 2, expiresMin: NOW + 60, msgId: 200 }), new Uint8Array(64).fill(9));
  const a1 = f1(spoof), a2 = f1(toWire(realBody, sign(realBody, sA)));
  check('spoof FIRST then real (same msgId): spoof unverified, real still verified', a1.status === 'ok' && a1.entry.sender === null && a2.status === 'ok' && a2.entry.sender?.id === 'audit-a');
  const s2 = new Set();
  const f2 = (w) => { const x = receiveChirp(w, NOW, s2); if (x.status === 'ok' || x.status === 'expired') { s2.add(w); s2.add(x.key); } return x; };
  const b1 = f2(toWire(realBody, sign(realBody, sA))), b2 = f2(spoof);
  check('real FIRST then spoof (same msgId): real verified, spoof shown unverified (not dup, not merged)', b1.entry?.sender?.id === 'audit-a' && b2.status === 'ok' && b2.entry.sender === null);
  const spoofCopy = toWire(realBody, new Uint8Array(64).fill(3));
  const s3 = new Set([toWire(realBody, sign(realBody, sA)), 'audit-a:200']);
  check('unsigned copy of a real body (bad sig) is not deduped against the real one and never verified', receiveChirp(spoofCopy, NOW, s3).entry?.sender === null);
  // A spoof flood cannot evict a real alert: 1000 distinct spoofs with the real msgId, then the real one.
  const s4 = new Set();
  for (let i = 0; i < 300; i++) { const w = toWire(realBody, Uint8Array.from({ length: 64 }, () => ri(0, 255))); const x = receiveChirp(w, NOW, s4); s4.add(w); s4.add(x.key); }
  check('300 spoofs with the same msgId do not suppress the real alert', receiveChirp(toWire(realBody, sign(realBody, sA)), NOW, s4).entry?.sender?.id === 'audit-a');

  // Expiry boundary.
  const at = (e) => receiveChirp(mk({ expiresMin: e, msgId: 300 }).wire, NOW).status;
  check('expiry boundary: expiresMin = now-1 -> expired; = now -> ok; = now+1 -> ok', at(NOW - 1) === 'expired' && at(NOW) === 'ok' && at(NOW + 1) === 'ok', `${at(NOW - 1)}/${at(NOW)}/${at(NOW + 1)}`);
  info('expiry is INCLUSIVE at the receiver (alert is live through the whole expiresMin minute) while the console refuses to send when expiresMin <= now (console/app.js:152, cap.js:71). Consistent with demo-policy (>=). Effective validity = up to +59.999 s.');
  check('expiresMin 0 -> expired (not wrapped to future)', at(0) === 'expired');
  const ex = receiveChirp(mk({ expiresMin: NOW - 5, msgId: 301 }).wire, NOW);
  check('expired verified alert keeps entry + sender so the UI can show "Expired" (never alarms)', ex.status === 'expired' && ex.entry.sender?.id === 'audit-a');

  // Expired replay poisons the dedupe key for that signer+msgId.
  const s5 = new Set();
  const old = receiveChirp(mk({ msgId: 400, expiresMin: NOW - 600 }).wire, NOW, s5); s5.add(old.entry.wire); s5.add(old.key);
  const fresh = receiveChirp(mk({ msgId: 400, expiresMin: NOW + 60, type: 3 }).wire, NOW, s5);
  info('an EXPIRED replay adds signer:msgId to seen (receiver/app.js:142), so a later LIVE alert that reuses that msgId (counter reset, second console with the same key, wrap) is dropped as dup', `fresh alert status: ${fresh.status}`);

  // Patterns.
  const patSigned = mk({ zone: 0xffff, type: 1, msgId: 500 }).wire;
  check('zone 0xFFFF is dropped as a pattern even when correctly signed and type EVACUATE', receiveChirp(patSigned, NOW).status === 'pattern');
  check('pattern with a random signature -> pattern (never ok)', receiveChirp(toWire(packBody({ type: 12, detail: 3, zone: 0xffff, expiresMin: NOW + 5, msgId: 1 }), new Uint8Array(64)), NOW).status === 'pattern');
  // Unknown codes.
  const unk = receiveChirp(mk({ type: 200, detail: 250, zone: 4000, msgId: 501 }).wire, NOW);
  check('unknown type/detail/zone codes still verify (shown as "Unknown alert", by design)', unk.status === 'ok' && unk.entry.sender?.id === 'audit-a');
  check('type 0 (unassigned) verifies too: phrasebook has no type 0 so it renders "Unknown alert (0)"', receiveChirp(mk({ type: 0, msgId: 502 }).wire, NOW).status === 'ok' && !book.types[0]);

  // msgId wraparound.
  {
    const sw = new Set();
    let okCount = 0, firstBad = null;
    const start = 65535 - 511;
    for (let i = 0; i < 1024; i++) {
      const id = (start + i) % 65536;
      const w = mk({ msgId: id, detail: i % 14 }).wire;
      const x = receiveChirp(w, NOW, sw);
      if (x.status === 'ok') { okCount++; sw.add(w); sw.add(x.key); } else firstBad ??= `${id}:${x.status}`;
    }
    check('1024 consecutive signed msgIds across the 65535 -> 0 wrap are all accepted once', okCount === 1024, firstBad || '1024/1024');
    const full = new Set(Array.from({ length: 65536 }, (_, i) => `audit-a:${i}`));
    const after = Array.from({ length: 16 }, (_, i) => receiveChirp(mk({ msgId: (i * 4099) % 65536, type: 3 }).wire, NOW, full).status);
    info('after 65 536 alerts from ONE signer in one receiver session, every further alert from that signer is a dup (seen is an unbounded, never-expiring Set)', `16 probes: ${[...new Set(after)].join(',')}`);
    // Two consoles sharing one agency key: random start + sequential ids (console/app.js:69).
    const pOverlap = (k) => Math.min(1, (2 * k - 1) / 65536);
    info('two consoles sharing a key (random start, +1 per alert): P(their msgId ranges overlap) for k alerts each', `k=10: ${(100 * pOverlap(10)).toFixed(3)}%, k=100: ${(100 * pOverlap(100)).toFixed(2)}%, k=1000: ${(100 * pOverlap(1000)).toFixed(1)}%; an overlap silently drops the second console\'s alert on phones that heard the first`);
    if (process.env.AUDIT_FULL_WRAP) {
      const sx = new Set(); let accepted = 0, dupAt = null;
      const t = performance.now();
      for (let i = 0; i <= 65536; i++) {
        const w = mk({ msgId: i % 65536, detail: i >= 65536 ? 5 : 2 }).wire;
        const x = receiveChirp(w, NOW, sx);
        if (x.status === 'ok') { accepted++; sx.add(w); sx.add(x.key); } else dupAt ??= i;
      }
      info(`FULL WRAP: 65 537 real signed alerts, accepted ${accepted}, first rejected index ${dupAt} (${((performance.now() - t) / 1000).toFixed(0)} s)`);
    }
  }

  // 12 h validity cap: where is it enforced?
  const far = mk({ expiresMin: 2 ** 32 - 1, msgId: 600 });
  const rf = receiveChirp(far.wire, NOW);
  info('receiveChirp itself does NOT enforce the 12 h cap: expiresMin 2^32-1 (year 10136) -> ' + rf.status + '; the cap lives only in receiver/app.js:41 (restore) and :141 (onChirp)');
  const appSrc = readFileSync(`${ROOT}receiver/app.js`, 'utf8');
  check('receiver/app.js still contains the 12 h cap in both onChirp and restore', /entry\.alert\.expiresMin > nowMinutes\(\) \+ MAX_VALID_MIN/.test(appSrc) && /expiresMin <= nowMinutes\(\) \+ MAX_VALID_MIN/.test(appSrc) && /MAX_VALID_MIN = 12 \* 60/.test(appSrc));
  // Server consumer: publishAlert has no cap.
  const st = srv.createState();
  const farLive = mk({ expiresMin: 2 ** 32 - 1, msgId: 601 });
  let srvAccepted = false;
  try { srv.publishAlert(st, farLive.wire); srvAccepted = /Signed CHIRP/.test(srv.activeAlertsText(st)); } catch { /* refused */ }
  check('server/core.mjs publishAlert refuses validity beyond 12 h (same rule as receivers)', !srvAccepted, srvAccepted ? 'ACCEPTED: phone line would read an alert valid until year 10136' : 'refused');
  // Clock skew vs the receiver's cap (rule replicated from receiver/app.js:141; app.js needs a DOM).
  const rxAccepts = (alertExp, rxNow) => !(alertExp > rxNow + MAX_VALID_MIN);
  const consoleNow = NOW, maxAlert = consoleNow + MAX_VALID_MIN;
  const skews = [0, -1, -2, -5].map((d) => `rx ${d} min: ${rxAccepts(maxAlert, consoleNow + d) ? 'shown' : 'SILENTLY DROPPED'}`);
  check('a max-validity (12 h) alert is still shown when the receiver clock is 1 minute behind the console', rxAccepts(maxAlert, consoleNow - 1), skews.join(', '));
}

// ================================================================ 4. help reply chirp
section('4. Help reply chirp (shared/help.js)');
{
  const langs = Object.keys(book.languages);
  let bad = 0, firstBad = '';
  for (let i = 0; i < 20000; i++) {
    const hasGps = rnd() < 0.8;
    const req = {
      need: ri(1, 4), lifeThreat: rnd() < 0.5, vulnerable: rnd() < 0.5, people: rnd() < 0.1 ? pick([1, 255]) : ri(1, 255), lang: pick(langs),
      msgId: rnd() < 0.1 ? pick([0, 65535]) : ri(0, 65535), reqId: rnd() < 0.1 ? pick([0, 65535]) : ri(0, 65535),
      lat: hasGps ? (rnd() < 0.05 ? pick([90, -90, 0]) : (rnd() * 180 - 90)) : null,
      lon: hasGps ? (rnd() < 0.05 ? pick([180, -180, 0]) : (rnd() * 360 - 180)) : null,
      createdMin: rnd() < 0.05 ? pick([0, 2 ** 32 - 1]) : ri(0, 2 ** 32 - 1),
    };
    const w = H.encodeHelp(req);
    const d = H.decodeHelp(w);
    const exp = { ...req, lat: req.lat == null ? null : Math.round(req.lat * 100) / 100, lon: req.lon == null ? null : Math.round(req.lon * 100) / 100 };
    if (w.length !== 24 || JSON.stringify(d) !== JSON.stringify(exp)) { bad++; firstBad ||= `${JSON.stringify(req)} -> ${JSON.stringify(d)}`; }
  }
  check('20 000 randomized valid help requests round-trip (24 chars, lat/lon to 0.01)', bad === 0, firstBad || '20000/20000');

  // Exhaustive invalid byte values.
  const base = Buffer.from(H.encodeHelp({ need: 1, people: 2, lang: 'es', reqId: 5, lat: 34.1, lon: -118.2, createdMin: 29000000 }), 'base64');
  const validAt = { 0: (v) => v === 0x48, 1: (v) => v >= 1 && v <= 4, 2: (v) => v <= 3, 3: (v) => v >= 1, 4: (v) => v >= 97 && v <= 122, 5: (v) => v >= 97 && v <= 122 };
  let mism = 0, tested = 0; const mismList = [];
  for (let pos = 0; pos < 18; pos++) for (let v = 0; v < 256; v++) {
    const b = Buffer.from(base); b[pos] = v; tested++;
    const want = validAt[pos] ? validAt[pos](v) : true;
    const got = H.decodeHelp(b.toString('base64')) !== null;
    if (want !== got) { mism++; if (mismList.length < 5) mismList.push(`byte${pos}=${v}`); }
  }
  check(`help decoder accepts exactly the valid value set at every byte (${tested} single-byte variants)`, mism === 0, mism ? mismList.join(',') : 'exact');
  const lens = []; for (let n = 0; n <= 40; n++) if (n !== 18) { const b = Buffer.alloc(n, 0x61); if (n) b[0] = 0x48; if (n > 1) b[1] = 1; if (n > 3) b[3] = 1; if (H.decodeHelp(b.toString('base64'))) lens.push(n); }
  check('help decoder rejects every length except 18 bytes', lens.length === 0, lens.join(',') || 'ok');
  const { wire: alertWire } = mk({ msgId: 9 });
  check('alert wire is never a help code and help code is never an alert', H.decodeHelp(alertWire) === null && receiveChirp(H.encodeHelp({ need: 1, reqId: 1, createdMin: 1 }), NOW).status === 'malformed');
  const hw = H.encodeHelp({ need: 2, reqId: 9, createdMin: 77 });
  info('decodeHelp also accepts whitespace/forgiving-base64 variants (same as fromWire)', `space inside -> ${H.decodeHelp(hw.slice(0, 8) + ' ' + hw.slice(8)) ? 'accepted' : 'rejected'}`);

  const rt = (o) => H.decodeHelp(H.encodeHelp({ need: 1, reqId: 1, createdMin: 1, ...o }));
  const ext = [[90, 180], [-90, -180], [0, 0], [89.995, 179.995], [-89.995, -179.995]].map(([lat, lon]) => { const d = rt({ lat, lon }); return `${lat},${lon}->${d.lat},${d.lon}`; });
  check('lat/lon extremes ±90/±180 round-trip (never collide with the 0x7FFF sentinel)', rt({ lat: 90, lon: 180 }).lat === 90 && rt({ lat: -90, lon: -180 }).lon === -180, ext.join(' | '));
  info('rounding is Math.round (half toward +inf): 34.005 -> ' + rt({ lat: 34.005 }).lat + ', -34.005 -> ' + rt({ lat: -34.005 }).lat + ' (asymmetric, <=1.1 km, harmless)');
  const oob = [[327.67, 'lat'], [327.68, 'lat'], [400, 'lat'], [-400, 'lat'], [91, 'lat'], [500, 'lon'], [181, 'lon']].map(([v, k]) => `${k} ${v} -> ${rt({ [k]: v })[k]}`);
  const rawOut = Buffer.from(base); rawOut.writeInt16BE(30000, 10); rawOut.writeInt16BE(-30000, 12);
  const decOut = H.decodeHelp(rawOut.toString('base64'));
  check('help codec validates lat to ±90 and lon to ±180 (encoder and decoder)', false, `encoder: ${oob.join(', ')}; decoder accepts lat=${decOut?.lat}, lon=${decOut?.lon}`);
  const nan = rt({ lat: NaN, lon: NaN });
  check('lat/lon NaN encodes as "unknown", not as a real position', nan.lat === null && nan.lon === null, `NaN -> ${nan.lat},${nan.lon} (Null Island)`);
  info('lat given with lon null decodes as a half position', JSON.stringify((({ lat, lon }) => ({ lat, lon }))(rt({ lat: 34.1, lon: null }))));
  const ppl = [0, 1, 255, 300, -5, 2.7, NaN, '7'].map((p) => `${String(p)}->${rt({ people: p }).people}`);
  check('people is clamped to 1..255 (0->1, 300->255, NaN->1)', rt({ people: 0 }).people === 1 && rt({ people: 300 }).people === 255 && rt({ people: NaN }).people === 1 && rt({ people: 255 }).people === 255, ppl.join(', '));
  const langCases = ['en', 'es', 'hy', 'é', 'EN', '中文', 'z', '', 'eng', 'é'];
  const lost = langCases.filter((l) => rt({ lang: l }) === null);
  const weird = langCases.map((l) => { const d = rt({ lang: l }); return `${JSON.stringify(l)}->${d ? d.lang : 'NULL'}`; });
  check('every lang string either round-trips or is normalised; the encoder never emits a code its own decoder rejects', lost.length === 0, weird.join(', '));
  check('all phrasebook languages round-trip in help codes', langs.every((l) => rt({ lang: l })?.lang === l), langs.join(','));
  info('need outside 1..4 becomes 4 (other); reqId/msgId are masked to 16 bits; createdMin undefined -> 0', `need 9 -> ${rt({ need: 9 }).need}, reqId 70000 -> ${rt({ reqId: 70000 }).reqId}, createdMin undefined -> ${H.decodeHelp(H.encodeHelp({ need: 1, reqId: 1 })).createdMin}`);

  // rankHelp properties.
  const items = Array.from({ length: 300 }, (_, i) => ({ id: i, lifeThreat: rnd() < 0.3, vulnerable: rnd() < 0.3, createdMin: ri(0, 20) }));
  const ranked = H.rankHelp(items);
  const keyOf = (x) => [x.lifeThreat ? 0 : 1, x.vulnerable ? 0 : 1, x.createdMin];
  let orderOk = true, stableOk = true;
  for (let i = 1; i < ranked.length; i++) {
    const a = keyOf(ranked[i - 1]), b = keyOf(ranked[i]);
    const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    if (cmp > 0) orderOk = false;
    if (cmp === 0 && ranked[i - 1].id > ranked[i].id) stableOk = false;
  }
  check('rankHelp: 300 random requests ordered life threat > vulnerable > oldest, ties keep arrival order, input not mutated', orderOk && stableOk && items[0].id === 0 && ranked.length === 300);
  const mixed = H.rankHelp([{ id: 'real-old', createdMin: 100 }, { id: 'nan', createdMin: NaN }, { id: 'missing' }, { id: 'str-false', lifeThreat: 'false', createdMin: 50 }]);
  info('rankHelp edge cases: missing/NaN createdMin sorts as 0 (jumps ahead of real older requests); lifeThreat "false" (string) counts as TRUE', mixed.map((x) => x.id).join(' > '));

  // enqueueHelp.
  const q = [];
  const r0 = { need: 1, reqId: 10, createdMin: 500, lat: 34.1, lon: -118.1 };
  check('enqueueHelp: first request added', H.enqueueHelp(q, { ...r0 }) === true);
  check('enqueueHelp: same request heard twice -> not added', H.enqueueHelp(q, { ...r0 }) === false && q.length === 1);
  check('enqueueHelp: same request POSTed by the app (same reqId+createdMin, extra fields) merges', H.enqueueHelp(q, { ...r0, source: 'app', note: 'x' }) === false);
  check('enqueueHelp: phone report with callId never merges with a sound/app request', H.enqueueHelp(q, { ...r0, callId: 'c1' }) === true && H.enqueueHelp(q, { ...r0, callId: 'c1' }) === false && q.length === 2);
  check('enqueueHelp(null) is a no-op', H.enqueueHelp(q, null) === false);
  const other = { need: 3, reqId: 10, createdMin: 500, lifeThreat: true, people: 4, lat: 33.9, lon: -118.4 };
  const addedOther = H.enqueueHelp(q, other);
  const bday = (k) => (1 - Math.exp(-(k * (k - 1)) / 2 / 65536)) * 100;
  check('enqueueHelp: a DIFFERENT resident (other need, location, life threat) whose random reqId collides in the same minute is kept', addedOther, `dropped=${!addedOther}; P(any collision among k requests in one minute): k=20 ${bday(20).toFixed(2)}%, k=50 ${bday(50).toFixed(2)}%, k=200 ${bday(200).toFixed(1)}%`);
}

// ================================================================ 5. CAP parser
section('5. CAP parser (console/cap.js)');
const NOWC = Math.floor(Date.UTC(2026, 9, 17, 20, 0, 0) / 60000);
const iso = (min) => new Date(min * 60000).toISOString().replace('.000', '');
const opts = { map: capMap, zones, nowMin: NOWC };
const cap = ({ event = 'Evacuation Immediate', expires = iso(NOWC + 120), areas = ['Altadena: Lake Ave corridor'], status = 'Actual', msgType = 'Alert', extra = '', infoExtra = '', infos = null, prefix = '' } = {}) => {
  const t = (n, v) => `<${prefix}${n}>${v}</${prefix}${n}>`;
  const infoXml = infos ?? [`${event === null ? '' : t('event', event)}${expires === null ? '' : t('expires', expires)}${infoExtra}${areas.map((a) => t('area', t('areaDesc', a))).join('')}`];
  return `<?xml version="1.0"?><${prefix}alert xmlns${prefix ? `:${prefix.slice(0, -1)}` : ''}="urn:oasis:names:tc:emergency:cap:1.2">${status === null ? '' : t('status', status)}${msgType === null ? '' : t('msgType', msgType)}${extra}${infoXml.map((i) => t('info', i)).join('')}</${prefix}alert>`;
};
const P1 = (o) => parseCap(cap(o), opts);
{
  const allCodes = [...Object.values(capMap.same), ...capMap.events, capMap.generic, capMap.test];
  const missing = allCodes.filter((c) => !book.types[c.type] || !book.details[c.detail]).map((c) => JSON.stringify(c));
  check('every cap-map.json code exists in phrasebook.json', missing.length === 0, missing.join(' ') || `${allCodes.length} codes`);
  for (const f of ['1-evacuation-altadena', '2-smoke-multi-area', '3-unknown-event-tsunami']) {
    const r = ms(() => parseCap(readFileSync(`${ROOT}docs/samples/${f}.xml`, 'utf8'), { ...opts, nowMin: NOWC - 60 * 24 * 30 }));
    check(`sample ${f} parses`, !r.err && r.r.alerts.length > 0, r.err ? r.err.message : `zones ${r.r.alerts.map((a) => a.zone)} in ${r.ms.toFixed(1)} ms`);
  }

  // XXE / entities.
  const xxe = `<?xml version="1.0"?><!DOCTYPE alert [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY alt "Altadena">]>` + cap({ areas: ['&xxe;', '&alt;'] }).replace('<?xml version="1.0"?>', '');
  const rx = ms(() => parseCap(xxe, opts));
  check('XXE: SYSTEM and internal entities are never expanded (areaDesc stays literal, no zone match)', !rx.err && rx.r.alerts.every((a) => a.zone === null) && rx.r.alerts.map((a) => a.areaDesc).join() === '&xxe;,&alt;', rx.err?.message || `${rx.ms.toFixed(1)} ms, areaDescs ${rx.r.alerts.map((a) => a.areaDesc)}`);
  let lol = '<!DOCTYPE alert [<!ENTITY lol0 "lol">'; for (let i = 1; i <= 10; i++) lol += `<!ENTITY lol${i} "${`&lol${i - 1};`.repeat(10)}">`; lol += ']>';
  const bl = ms(() => parseCap(lol + cap({ areas: ['&lol10;'], event: '&lol10;' }), opts));
  check('billion laughs: no expansion, fast, output stays tiny', !bl.err && bl.ms < 100 && JSON.stringify(bl.r).length < 2000, bl.err?.message || `${bl.ms.toFixed(2)} ms, result ${JSON.stringify(bl.r).length} chars`);

  // ReDoS / size timing. Every input is <= MAX_CAP_CHARS.
  const fill = (unit, room = MAX_CAP_CHARS - 400) => unit.repeat(Math.floor(room / unit.length));
  const adv = {
    'exactly MAX_CAP_CHARS (valid doc + padding)': (() => { const d = cap({ extra: '<note>' }); return d.replace('<note>', `<note>${'x'.repeat(MAX_CAP_CHARS - d.length - 7)}</note>`); })(),
    '"<alert" x N, no ">"': fill('<alert'),
    '"<info " x N, no ">"': cap({ infoExtra: '' }).replace('<info>', `<info>${fill('<info ', MAX_CAP_CHARS - 600)}`),
    '"<" + 64K word chars (prefix backtracking)': `<${'a'.repeat(MAX_CAP_CHARS - 1)}`,
    '"<a" x N (many prefix starts)': fill('<aaaaaaaaaaaaaaaa'),
    'unclosed "<event>" x N inside <info>': cap({ infoExtra: fill('<event>', MAX_CAP_CHARS - 600) }),
    'unclosed "<cap:event>" x N inside <info>': cap({ infoExtra: fill('<cap:event>', MAX_CAP_CHARS - 600) }),
    'unclosed "<![CDATA[" x N inside <event>': cap({ event: fill('<![CDATA[', MAX_CAP_CHARS - 600) }),
    '"&amp;" x N in areaDesc': cap({ areas: [fill('&amp;', MAX_CAP_CHARS - 600)] }),
    '1500 <area> elements': cap({ areas: Array.from({ length: 1500 }, (_, i) => (i % 2 ? 'Malibu' : `N${i}`)) }),
    'nested <area> 3000 deep': cap({ infoExtra: '<area>'.repeat(3000) + '<areaDesc>Malibu</areaDesc>' + '</area>'.repeat(3000), areas: [] }),
    '3000 <eventCode> blocks': cap({ event: 'x', infoExtra: '<eventCode><valueName>SAME</valueName><value>ZZZ</value></eventCode>'.repeat(800) }),
    'huge areaDesc of words': cap({ areas: [fill('altadena malibu ', MAX_CAP_CHARS - 600)] }),
    '"<expires" x N, no ">"': cap({ infoExtra: fill('<expires', MAX_CAP_CHARS - 600) }),
  };
  const timings = [];
  for (const [name, x] of Object.entries(adv)) {
    if (x.length > MAX_CAP_CHARS) { timings.push([name, x.length, NaN, 'input over limit (test bug)']); continue; }
    const r = ms(() => parseCap(x, opts));
    timings.push([name, x.length, r.ms, r.err ? `throws: ${r.err.message.slice(0, 60)}` : `${r.r.alerts.length} alert(s)`]);
  }
  console.log('  CAP timing table (ms):');
  for (const [n, len, t, out] of timings) console.log(`    ${t.toFixed(1).padStart(8)} ms  ${String(len).padStart(6)} chars  ${n}  -> ${out}`);
  const slow = timings.filter(([, , t]) => !(t < 1000));
  check('no adversarial CAP input <= MAX_CAP_CHARS takes >= 1000 ms (UI-freeze threshold)', slow.length === 0, slow.map(([n, , t]) => `${n}: ${t.toFixed(0)} ms`).join('; ') || `max ${Math.max(...timings.map((x) => x[2])).toFixed(1)} ms`);
  const sluggish = timings.filter(([, , t]) => t >= 100 && t < 1000);
  info('adversarial CAP inputs between 100 and 1000 ms', sluggish.map(([n, , t]) => `${n}: ${t.toFixed(0)} ms`).join('; ') || 'none');
  check('MAX_CAP_CHARS + 1 is refused before any regex runs', throws(() => parseCap('x'.repeat(MAX_CAP_CHARS + 1), opts), /too large/));

  // Namespaces, CDATA, entities.
  const ns = ms(() => P1({ prefix: 'cap:' }));
  check('namespaced <cap:alert>/<cap:info>/<cap:areaDesc> parses', !ns.err && ns.r.alerts[0].type === 1 && ns.r.alerts[0].zone === 1, ns.err?.message);
  const mixedNs = ms(() => parseCap(cap().replace('<info>', '<cap:info>'), opts));
  info('mismatched prefixes (<cap:info> ... </info>) are accepted (regex ignores the prefix)', mixedNs.err ? `throws ${mixedNs.err.message}` : 'accepted');
  check('CDATA in areaDesc and event is unwrapped', P1({ event: '<![CDATA[Evacuation Immediate]]>', areas: ['<![CDATA[Malibu]]>'] }).alerts[0].zone === 5);
  check('&amp; &lt; &gt; &quot; &apos; in areaDesc are decoded', P1({ areas: ['Malibu &amp; &quot;PCH&quot;'] }).alerts[0].areaDesc === 'Malibu & "PCH"');
  const numEnt = P1({ areas: ['&#65;ltadena'] }).alerts[0];
  info('numeric character references (&#65;) are NOT decoded, so "&#65;ltadena" does not match Altadena', `zone ${numEnt.zone}`);
  const comm = ms(() => parseCap(cap().replace('<status>', '<!-- <msgType>Cancel</msgType> --><status>'), opts));
  info('XML comments are not skipped: a commented-out <msgType>Cancel</msgType> placed first makes the parser refuse a real Alert', comm.err ? `refused: ${comm.err.message}` : 'parsed');
  const commExp = P1({ infoExtra: '', expires: iso(NOWC + 30) });
  const commExp2 = parseCap(cap({ expires: iso(NOWC + 30) }).replace('<expires>', `<!-- <expires>${iso(NOWC + 9999)}</expires> --><expires>`), opts);
  info('a commented-out <expires> placed before the real one wins', `real +30 min -> expiresMin offset ${commExp.alerts[0].expiresMin - NOWC}; with comment -> ${commExp2.alerts[0].expiresMin - NOWC}`);
  const inj = ms(() => parseCap(cap({ event: 'Boil Water Notice', infoExtra: '<description><![CDATA[</info><info><event>Evacuation Immediate</event>]]></description>' }), opts));
  info('CDATA containing "</info><info>" is treated as markup (parser differential vs a real XML parser)', inj.err ? `refused: ${inj.err.message}` : `parsed, type ${inj.r.alerts[0].type}`);

  // Multiple <info> languages.
  const inf = (lang, ev) => `<language>${lang}</language><event>${ev}</event><expires>${iso(NOWC + 60)}</expires><area><areaDesc>Malibu</areaDesc></area>`;
  check('multiple <info>: es-US first, en-US second -> en chosen', P1({ infos: [inf('es-US', 'Aviso de humo'), inf('en-US', 'Evacuation Order')] }).alerts[0].type === 1);
  check('multiple <info>: only es-US -> uses it (unknown event -> generic + warning)', (() => { const r = P1({ infos: [inf('es-US', 'Orden de evacuación')] }); return r.alerts[0].type === 13 && r.warnings.some((w) => /Unknown event/.test(w)); })());
  check('<info> with no <language> is treated as English', P1({ infos: [inf('fr-CA', 'Ordre'), `<event>Evacuation Order</event><expires>${iso(NOWC + 60)}</expires><area><areaDesc>Malibu</areaDesc></area>`] }).alerts[0].type === 1);

  // Missing / garbage fields.
  const g = (o) => { try { return P1(o); } catch (e) { return { err: e.message }; } };
  check('missing <event> -> generic + warning', g({ event: null }).alerts?.[0].type === 13);
  check('empty <event></event> -> generic + warning', g({ event: '' }).alerts?.[0].type === 13);
  check('no <info> -> refused', /no <info>/.test(g({ infos: [] }).err || ''));
  check('no <alert> -> refused', throws(() => parseCap('<info></info>', opts), /no <alert>/));
  check('unbalanced <area> -> refused', throws(() => parseCap(cap().replace('</area>', ''), opts), /Malformed/));
  check('non-string / whitespace input -> refused with a readable message', throws(() => parseCap(null, opts), /Paste/) && throws(() => parseCap('   ', opts), /Paste/));

  // Expires formats & boundaries.
  const exp = (s) => { try { const r = P1({ expires: s }); return r.alerts[0].expiresMin - NOWC; } catch (e) { return `refused(${e.message.split(' ')[0]})`; } };
  const fmt = {
    'Z': exp('2026-10-17T21:00:00Z'), '+00:00': exp('2026-10-17T21:00:00+00:00'), '-07:00': exp('2026-10-17T14:00:00-07:00'),
    '+0000 (no colon)': exp('2026-10-17T21:00:00+0000'), 'no offset (local)': exp('2026-10-17T21:00:00'), 'date only': exp('2026-10-18'),
    'RFC 2822': exp('Sat, 17 Oct 2026 21:00:00 GMT'), 'fractional seconds': exp('2026-10-17T21:00:00.999Z'), 'lowercase t/z': exp('2026-10-17t21:00:00z'),
    'month 13': exp('2026-13-17T21:00:00Z'), 'Feb 30': exp('2026-02-30T21:00:00Z'), 'year 0': exp('0000-01-01T00:00:00Z'),
  };
  info('<expires> format handling (minutes after now; 60 = correct for the 21:00Z cases)', Object.entries(fmt).map(([k, v]) => `${k}: ${v}`).join(' | '));
  check('Z, +00:00 and -07:00 forms of the same instant agree', fmt.Z === 60 && fmt['+00:00'] === 60 && fmt['-07:00'] === 60);
  const tzRun = (tz) => spawnSync(process.execPath, ['-e', 'console.log(Date.parse("2026-10-17T21:00:00")/60000)'], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).stdout.trim();
  const la = Number(tzRun('America/Los_Angeles')), utc = Number(tzRun('UTC'));
  check('an offset-less <expires> means the same instant on every console (CAP 1.2 requires an offset; should be refused or warned)', la === utc, `TZ=America/Los_Angeles vs UTC differ by ${(la - utc) / 60} h for "2026-10-17T21:00:00"; no warning is emitted`);
  check('expires exactly now -> refused', /refused/.test(String(exp(iso(NOWC)))));
  const halfMin = exp(new Date(NOWC * 60000 + 30000).toISOString());
  info('expires 30 s in the future is refused as "already expired" (floor to the minute)', String(halfMin));
  check('expires now+1 min -> accepted as +1', exp(iso(NOWC + 1)) === 1);
  check('expires exactly now+12 h -> not capped, no warning', (() => { const r = P1({ expires: iso(NOWC + MAX_VALID_MIN) }); return r.alerts[0].expiresMin === NOWC + 720 && !r.warnings.some((w) => /capped/.test(w)); })());
  check('expires now+12 h+1 min and year 9999 -> capped to exactly 12 h with warning', (() => { const a = P1({ expires: iso(NOWC + 721) }), b = P1({ expires: '9999-12-31T23:59:59Z' }); return a.alerts[0].expiresMin === NOWC + 720 && b.alerts[0].expiresMin === NOWC + 720 && b.warnings.some((w) => /capped/.test(w)); })());
  check('no <expires> -> default 60 min with warning', P1({ expires: null }).alerts[0].expiresMin === NOWC + DEFAULT_VALID_MIN);

  // SAME code precedence & event mapping.
  const same = (codes, event = 'Something') => P1({ event, infoExtra: codes.map(([n, v]) => `<eventCode><valueName>${n}</valueName><value>${v}</value></eventCode>`).join('') }).alerts[0].type;
  check('SAME EVI beats event text "Boil Water"', same([['SAME', 'EVI']], 'Boil Water') === 1);
  check('unknown SAME code falls back to event text', same([['SAME', 'XYZ']], 'Shelter in Place Warning') === 3);
  check('first MAPPED SAME code wins (XYZ, SPW, EVI -> SPW)', same([['SAME', 'XYZ'], ['SAME', 'SPW'], ['SAME', 'EVI']]) === 3);
  check('valueName case-insensitive, value case-insensitive (same/evi)', same([['same', 'evi']]) === 1);
  check('non-SAME eventCode (NWS) ignored', same([['NWS', 'EVI']], 'Something') === 13);
  const ev = (e) => P1({ event: e }).alerts[0].type;
  const evRows = ['Evacuation Order Lifted', 'Evacuation Warning Cancelled', 'Shelter in Place Lifted', 'Protest activity downtown', 'Latest Wildfire Information', 'Contest results', 'Smoke Detector Giveaway'].map((e) => `"${e}" -> ${book.types[ev(e)].key}`);
  check('event text that negates or merely contains a keyword is not mapped to the opposite meaning (e.g. "Evacuation Order Lifted" must not become EVACUATE; "Protest"/"Latest" must not become TEST)', ev('Evacuation Order Lifted') !== 1 && ev('Protest activity downtown') !== 12 && ev('Latest Wildfire Information') !== 12, evRows.join('; '));

  // status / msgType.
  for (const s of ['Exercise', 'System', 'Test', 'Draft', 'exercise']) check(`status ${s} -> TEST code + warning`, (() => { const r = P1({ status: s }); return r.alerts[0].type === 12 && r.warnings.some((w) => /not Actual/.test(w)); })());
  check('status "actual" (lowercase) -> real code', P1({ status: 'actual' }).alerts[0].type === 1);
  info('missing <status> is treated as Actual (CAP requires status)', `type ${P1({ status: null }).alerts[0].type}`);
  for (const m of ['Cancel', 'cancel', ' Cancel ']) check(`msgType "${m}" -> refused`, throws(() => P1({ msgType: m }), /Cancel/));
  check('namespaced <cap:msgType>Cancel -> refused', throws(() => P1({ prefix: 'cap:', msgType: 'Cancel' }), /Cancel/));
  check('msgType Update -> converted (operator re-issues)', P1({ msgType: 'Update' }).alerts[0].type === 1);
  const ack = ['Ack', 'Error'].map((m) => { try { const r = P1({ msgType: m }); return `${m}: ${r.alerts.length} alert(s), ${r.warnings.length} warning(s)`; } catch (e) { return `${m}: refused`; } });
  check('msgType Ack / Error (not alerts) are refused or at least warned', ack.every((s) => /refused|[1-9] warning/.test(s)) && !ack.some((s) => /0 warning/.test(s)), ack.join('; '));

  // Areas.
  const zs = (areas) => P1({ areas }).alerts.map((a) => a.zone);
  check('duplicate areas -> one alert per zone', JSON.stringify(zs(['Malibu', 'Malibu: Pacific Coast Hwy', 'Malibu'])) === '[5]');
  info('duplicate UNMATCHED areas each produce a separate null-zone alert (operator could pick the same zone twice)', JSON.stringify(zs(['Nowhere', 'Nowhere'])));
  const mz = (s) => matchZone(s, zones);
  const zoneRows = {
    'Gate': mz('Gate'), 'Gate C': mz('Gate C'), 'LA': mz('LA'), 'Los Angeles': mz('Los Angeles'), 'Los Angeles County': mz('Los Angeles County'), 'Union Station': mz('Union Station'), 'Ronald Tutor Hall USC': mz('Ronald Tutor Hall USC'),
  };
  check('matchZone: short/partial names do not match (Gate, Gate C, LA, Los Angeles) and full names do', zoneRows.Gate === null && zoneRows['Gate C'] === null && zoneRows.LA === null && zoneRows['Los Angeles'] === null && zoneRows['Los Angeles County'] === 99 && zoneRows['Union Station'] === 21 && zoneRows['Ronald Tutor Hall USC'] === 30, JSON.stringify(zoneRows));
  const countyFP = ['Altadena, Los Angeles County', 'Malibu; Los Angeles County, CA', 'Pacific Palisades (Los Angeles County)'].map((s) => `"${s}" -> ${mz(s)}`);
  check('a local area written CAP-style as "<place>, Los Angeles County" is NOT turned into the countywide zone 99', ['Altadena, Los Angeles County', 'Malibu; Los Angeles County, CA'].every((s) => mz(s) !== 99), countyFP.join('; '));
  const amb = ['Altadena', 'Pacific Palisades', 'Exposition Park', 'Downtown LA'].map((s) => `"${s}" -> ${mz(s)} (${zones[mz(s)]?.name}, r=${zones[mz(s)]?.radiusKm} km)`);
  check('an area-only description shared by several zones does not silently resolve to one narrow sub-zone (note: zone names that repeat a word, e.g. "Altadena: Altadena Dr", outscore their siblings)', mz('Exposition Park') !== 10 && mz('Altadena') !== 1, amb.join('; '));
  const fp = ['Not including Malibu', 'Station Fire near Union Ave', 'University Park, Denver CO', 'Inglewood, NJ'].map((s) => `"${s}" -> ${mz(s)}`);
  info('word-overlap false positives (negation, unrelated places sharing words) - operator preview is the only guard', fp.join('; '));
  check('matchZone on empty / punctuation-only / non-Latin text returns null', mz('') === null && mz('!!!') === null && mz('アルタデナ') === null);
}

// ================================================================ 6. SLOW rung
section('6. SLOW rung (console/slow.js)');
{
  const a = { type: 1, zone: 1 };
  const T = 1_700_000_000_000;
  const w = (dt) => waitSeconds(a, { [slowKey(a)]: T }, T + dt);
  check('cooldown boundaries: +0 -> 60 s, +58 999 ms -> 2, +59 000 -> 1, +59 999 -> 1, +60 000 -> 0', w(0) === 60 && w(58999) === 2 && w(59000) === 1 && w(59999) === 1 && w(60000) === 0, [0, 58999, 59000, 59999, 60000].map((d) => `${d}:${w(d)}`).join(' '));
  check('never negative after cooldown', w(10 ** 9) === 0);
  check('COOLDOWN_MS is 60 000', COOLDOWN_MS === 60000);
  const back = w(-3_600_000);
  check('clock moved back 1 h after a send does not lock the operator out for more than the 60 s cooldown', back <= 60, `wait ${back} s (~${Math.round(back / 60)} min)`);
  const fut = waitSeconds(a, { [slowKey(a)]: T + 86_400_000 * 365 }, T);
  info('a corrupted/future sentAt in localStorage blocks that type+zone for its whole distance', `${fut} s`);
  const nanW = waitSeconds(a, { [slowKey(a)]: 'garbage' }, T);
  info('non-numeric sentAt yields NaN, which console/app.js treats as "go" (falsy)', String(nanW));
  check('cooldown is per type+zone: other zone / other type not slowed; same type+zone with other detail IS slowed', waitSeconds({ type: 1, zone: 2 }, { '1:1': T }, T) === 0 && waitSeconds({ type: 11, zone: 1 }, { '1:1': T }, T) === 0 && waitSeconds({ type: 1, zone: 1, detail: 9 }, { '1:1': T }, T) === 60);
  const wide = Object.entries(zones).filter(([, z]) => z.wide).map(([k]) => Number(k));
  check('wide zones are exactly 11 (all gates) and 99 (countywide)', JSON.stringify(wide) === '[11,99]', JSON.stringify(wide));
  check('isWide: unknown zone, null zone, string id', !isWide({ zone: 12345 }, zones) && !isWide({ zone: null }, zones) && isWide({ zone: '99' }, zones));
  info('CAP "Malibu; Los Angeles County, CA" -> zone 99 is wide, so the typed-SEND confirm (console/app.js review) is the last guard against the countywide mis-target', `isWide=${isWide({ zone: matchZone('Malibu; Los Angeles County, CA', zones) }, zones)}`);
}

// ================================================================ 7. phrasebook & zones
section('7. Phrasebook and zones integrity');
{
  const langs = Object.keys(book.languages);
  const gaps = {};
  for (const l of langs) {
    const miss = [];
    for (const [k, v] of Object.entries(book.types)) if (typeof v.text?.[l] !== 'string' || !v.text[l].trim()) miss.push(`type ${k}`);
    for (const [k, v] of Object.entries(book.details)) if (k !== '0' && (typeof v.text?.[l] !== 'string' || !v.text[l].trim())) miss.push(`detail ${k}`);
    for (const [k, v] of Object.entries(book.ui)) if (typeof v?.[l] !== 'string' || !v[l].trim()) miss.push(`ui.${k}`);
    if (miss.length) gaps[l] = miss;
  }
  check(`every language (${langs.length}) has every type, detail (except 0 NONE) and ui string, none empty`, Object.keys(gaps).length === 0, Object.entries(gaps).map(([l, m]) => `${l}: ${m.join(',')}`).join(' | ') || 'complete');
  const extraLang = [];
  for (const grp of [book.types, book.details]) for (const v of Object.values(grp)) for (const l of Object.keys(v.text)) if (!book.languages[l]) extraLang.push(l);
  for (const v of Object.values(book.ui)) for (const l of Object.keys(v)) if (!book.languages[l]) extraLang.push(l);
  check('no translations for undeclared languages', extraLang.length === 0, [...new Set(extraLang)].join(','));
  check('detail 0 (NONE) is empty in every language (renders nothing)', langs.every((l) => book.details[0].text[l] === ''));
  const contiguous = (o, from) => Object.keys(o).map(Number).every((n, i) => n === from + i);
  check('type codes 1..13 and detail codes 0..13 are contiguous', contiguous(book.types, 1) && contiguous(book.details, 0), `types ${Object.keys(book.types)}, details ${Object.keys(book.details)}`);
  check('codes fit in one byte; keys unique', [...Object.keys(book.types), ...Object.keys(book.details)].every((k) => Number(k) <= 255) && new Set(Object.values(book.types).map((t) => t.key)).size === Object.keys(book.types).length);
  check('every type has severity and icon', Object.values(book.types).every((t) => t.severity && t.icon));
  info('reviewed flags', langs.map((l) => `${l}:${book.languages[l].reviewed}`).join(' '));
  info(`CLAUDE.md says "9 languages"; phrasebook has ${langs.length} (hy added for Twist 2)`);

  // Append-only across git history.
  let histProblems = [], commits = [];
  try {
    commits = execFileSync('git', ['log', '--format=%h', '--reverse', '--', 'shared/phrasebook.json'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const snaps = commits.map((c) => [c, JSON.parse(execFileSync('git', ['show', `${c}:shared/phrasebook.json`], { cwd: ROOT, encoding: 'utf8' }))]);
    snaps.push(['WORKTREE', book]);
    const firstSeen = {};
    for (const [c, b] of snaps) for (const grp of ['types', 'details']) {
      for (const [code, v] of Object.entries(b[grp])) {
        const id = `${grp}:${code}`;
        if (!firstSeen[id]) firstSeen[id] = { c, key: v.key, en: v.text.en };
        else if (firstSeen[id].key !== v.key) histProblems.push(`${id} key ${firstSeen[id].key} (${firstSeen[id].c}) -> ${v.key} (${c})`);
        else if (firstSeen[id].en !== v.text.en) histProblems.push(`${id} en text changed ${firstSeen[id].c} -> ${c}: "${firstSeen[id].en}" -> "${v.text.en}"`);
      }
      for (const id of Object.keys(firstSeen).filter((x) => x.startsWith(grp))) if (!b[grp][id.split(':')[1]]) histProblems.push(`${id} REMOVED in ${c}`);
    }
  } catch (e) { histProblems.push(`git error: ${e.message}`); }
  const renum = histProblems.filter((p) => /key|REMOVED|git error/.test(p));
  check(`phrasebook codes are append-only across ${commits.length} commits + worktree (no code renumbered, re-keyed or removed)`, renum.length === 0, renum.join('; ') || 'ok');
  const enChanges = histProblems.filter((p) => /en text changed/.test(p));
  info('English text edits to existing codes (meaning kept? review by hand)', enChanges.join('; ') || 'none');
  // zones.json history.
  let zoneProblems = [];
  try {
    const zc = execFileSync('git', ['log', '--format=%h', '--reverse', '--', 'shared/zones.json'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const first = {};
    for (const [c, z] of [...zc.map((c) => [c, JSON.parse(execFileSync('git', ['show', `${c}:shared/zones.json`], { cwd: ROOT, encoding: 'utf8' }))]), ['WORKTREE', zones]]) {
      for (const [id, v] of Object.entries(z)) { if (!first[id]) first[id] = v.name; else if (first[id] !== v.name) zoneProblems.push(`zone ${id}: "${first[id]}" -> "${v.name}" (${c})`); }
      for (const id of Object.keys(first)) if (!z[id]) zoneProblems.push(`zone ${id} removed in ${c}`);
    }
  } catch (e) { zoneProblems.push(`git error: ${e.message}`); }
  check('zone ids never renamed or removed across git history', zoneProblems.length === 0, zoneProblems.join('; ') || 'ok');
  const badZones = Object.entries(zones).filter(([id, z]) => !(Number.isFinite(z.lat) && Math.abs(z.lat) <= 90 && Number.isFinite(z.lon) && Math.abs(z.lon) <= 180 && z.radiusKm > 0 && z.name && z.area && Number(id) < 0xffff));
  check('every zone has name, area, lat/lon in range, radiusKm > 0, id < 0xFFFF', badZones.length === 0, badZones.map(([k]) => k).join(',') || `${Object.keys(zones).length} zones`);
  info('outsideZone treats lat 0 as "no position" (!zone?.lat): an equator zone would never be range-checked', `outsideZone({lat:0,lon:10}, far) = ${outsideZone({ lat: 0, lon: 10, radiusKm: 1 }, { lat: 45, lon: 10 })}`);

  // ui keys used by code exist.
  const used = new Set();
  for (const f of ['receiver/app.js', 'console/app.js', 'console/helpqueue.js', 'range/app.js']) {
    let src = ''; try { src = readFileSync(`${ROOT}${f}`, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/\bui\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/need(Medical|Mobility|Trapped|Other)/g)) used.add(`need${m[1]}`);
  }
  const missingUi = [...used].filter((k) => !book.ui[k]);
  check(`every ui('...') key used in receiver/console/range exists (${used.size} keys)`, missingUi.length === 0, missingUi.join(',') || [...used].sort().join(','));
  const unusedUi = Object.keys(book.ui).filter((k) => !used.has(k));
  info('phrasebook ui keys not referenced by ui(\'...\') in app code (dead or used dynamically)', unusedUi.join(',') || 'none');
  // Receiver badge: ui('unverified').split(/[:：]/)[0] (receiver/app.js:162).
  const noColon = langs.filter((l) => !/[:：]/.test(book.ui.unverified[l]));
  check('every language\'s ui.unverified has a ":" or "：" so the receiver badge (app.js:162 split) shows only the short label', noColon.length === 0, noColon.map((l) => `${l}: "${book.ui.unverified[l].slice(0, 40)}..."`).join(' | ') || 'ok');
  // Help need labels map 1:1 to NEEDS.
  check('help NEEDS 1..4 each have a ui label', Object.keys(H.NEEDS).every((n) => book.ui[{ 1: 'needMedical', 2: 'needMobility', 3: 'needTrapped', 4: 'needOther' }[n]]));
}

// ================================================================ 8. range pattern
section('8. Range-test pattern (range/pattern.js)');
{
  const cases = [[0, 0], [255, 65535], [7, 3], [256, 65536], [-1, -1], [1000, 70000]];
  const rows = cases.map(([run, seq]) => { const p = parsePattern(makePattern(run, seq)); return `(${run},${seq})->(${p.run},${p.seq})`; });
  check('run/seq round-trip within 0..255 / 0..65535', rows.slice(0, 3).every((r, i) => r.endsWith(`(${cases[i][0]},${cases[i][1]})`)), rows.join(' '));
  info('out-of-range run/seq wrap silently (run & 0xff, seq via setUint16)', rows.slice(3).join(' '));
  let notPattern = 0, verifiedCount = 0;
  for (let i = 0; i < 2000; i++) { const p = makePattern(ri(0, 300), ri(0, 70000)); const r = receiveChirp(p, P.nowMinutes(), new Set()); if (r.status !== 'pattern') notPattern++; if (r.entry?.sender) verifiedCount++; }
  check('2000 random patterns: receiveChirp always returns "pattern", never an alert', notPattern === 0 && verifiedCount === 0, `${notPattern} non-pattern`);
  check('every pattern is exactly 100 chars (same airtime as an alert)', makePattern(1, 1).length === 100);
  const { wire } = mk({ msgId: 11 });
  check('a real signed alert is never parsed as a pattern', parsePattern(wire) === null);
  const z = toWire(packBody({ type: 1, detail: 0, zone: PATTERN_ZONE, expiresMin: NOW + 5, msgId: 1 }), new Uint8Array(64));
  info('zone 0xFFFF with a non-TEST type: receiver drops it as "pattern" but range page does not count it (parsePattern null)', `receiveChirp=${receiveChirp(z, NOW).status}, parsePattern=${JSON.stringify(parsePattern(z))}`);
  check('parsePattern(null/garbage) returns null without throwing', parsePattern(null) === null && parsePattern('') === null && parsePattern('x'.repeat(100)) === null);
}

// ================================================================ 9. audio
section('9. Audio channel (real vendor/ggwave.js in Node)');
if (FAST) info('skipped (AUDIT_FAST=1)');
else {
  const { wire } = mk({ msgId: 4242, type: 1, detail: 12, zone: 1 });
  await runAudio({ check, info, wire, receiveChirp, nowMin: NOW, seed: SEED, N: Number(process.env.AUDIT_AUDIO_N || 5), log: console.log });
  // Corrupted text: random edits of a valid wire never verify.
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let leaked = 0, same = 0;
  for (let i = 0; i < 1500; i++) {
    const a = wire.split('');
    const edits = ri(1, 3);
    for (let e = 0; e < edits; e++) {
      const op = ri(0, 2), p = ri(0, a.length - 1);
      if (op === 0) a[p] = alpha[ri(0, 63)]; else if (op === 1) a.splice(p, 1); else a.splice(p, 0, alpha[ri(0, 63)]);
    }
    const t = a.join('');
    if (t === wire) { same++; continue; }
    if (receiveChirp(t, NOW, new Set()).entry?.sender) leaked++;
  }
  check('1500 randomly corrupted decodes (1-3 char substitutions/insertions/deletions) never verify', leaked === 0, `${leaked} verified, ${same} edits were no-ops`);
}

// ================================================================ 10. existing gates
section('10. Existing gates');
if (FAST) info('skipped (AUDIT_FAST=1)');
else {
  const run = (args) => {
    const t = performance.now();
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
    const out = `${r.stdout}\n${r.stderr}`;
    return { code: r.status, ms: performance.now() - t, pass: (out.match(/^PASS/gm) || []).length, fail: (out.match(/^FAIL/gm) || []).length, out };
  };
  for (const g of ['selftest', 'test-demo-policy', 'server-safety', 'sw-cache-safety']) {
    const r = run([`scripts/${g}.mjs`]);
    const cause = /ENOENT[^\n]*keys\/([\w-]+\.secret)/.exec(r.out);
    check(`gate scripts/${g}.mjs passes in this checkout`, r.code === 0, `exit ${r.code}, ${r.pass} PASS / ${r.fail} FAIL, ${(r.ms / 1000).toFixed(1)} s${cause ? `; root cause: ENOENT keys/${cause[1]} (keys/ is gitignored, so a clean checkout cannot run this gate)` : ''}`);
  }
  for (const g of ['selftest', 'test-demo-policy']) {
    const r = run(['scripts/audit-a-gate-shim.mjs', g]);
    const fails = r.out.split('\n').filter((l) => /^FAIL/.test(l)).join(' | ');
    check(`gate ${g} logic passes with throwaway keys (audit-a-gate-shim)`, r.code === 0, `exit ${r.code}, ${r.pass} PASS / ${r.fail} FAIL${fails ? `: ${fails}` : ''}`);
  }
  info('the lead reports that local keys/*.secret in the main worktree do not match the public keys in shared/keys.js; track A did not read secrets, so this is NOT independently verified here');
}

// ---------------------------------------------------------------- summary
const count = (s) => results.filter((r) => r.status === s).length;
console.log('\n================ SUMMARY ================');
const bySec = {};
for (const r of results) { bySec[r.section] ??= { PASS: 0, FAIL: 0, INFO: 0 }; bySec[r.section][r.status]++; }
for (const [s, c] of Object.entries(bySec)) console.log(`${s.padEnd(48)} PASS ${String(c.PASS).padStart(3)}  FAIL ${String(c.FAIL).padStart(2)}  INFO ${String(c.INFO).padStart(2)}`);
console.log(`TOTAL: ${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('INFO')} INFO (seed ${SEED})`);
if (count('FAIL')) { console.log('\nFAILED CHECKS:'); for (const r of results.filter((x) => x.status === 'FAIL')) console.log(`  - [${r.section}] ${r.name}${r.detail ? `  [${r.detail}]` : ''}`); }
process.exit(count('FAIL') ? 1 : 0);
