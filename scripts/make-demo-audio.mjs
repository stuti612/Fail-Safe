// Writes the two recorded chirps for the live demo to docs/demo-audio/:
//   tampered.wav  a signed Gate C alert with one byte changed after signing -> UNVERIFIED
//   expired.wav   a correctly signed Gate C alert that expired an hour ago  -> Expired
// Each file is decoded back and checked before it is written.
//
//   node scripts/make-demo-audio.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.nacl = require('../vendor/nacl-fast.min.js');
const ggwaveFactory = require('../vendor/ggwave.js');

const { packBody, unpackBody, toWire, fromWire, nowMinutes } = await import('../shared/payload.js');
const { sign, verify } = await import('../shared/trust.js');

const root = new URL('..', import.meta.url).pathname;
const secret = readFileSync(`${root}keys/coliseum-ops.secret`, 'utf8').trim();
const RATE = 48000;

// GATE_CHANGE, NEXT_OPEN_GATE, Coliseum Gate C (the demo scenario).
const gate = { type: 5, detail: 11, zone: 10 };

function tamperedWire() {
  const body = packBody({ ...gate, expiresMin: nowMinutes() + 12 * 60, msgId: 60001 });
  const sig = sign(body, secret);
  body[1] = 1; // attacker turns GATE_CHANGE into EVACUATE after signing
  return toWire(body, sig);
}

function expiredWire() {
  const body = packBody({ ...gate, expiresMin: nowMinutes() - 60, msgId: 60002 });
  return toWire(body, sign(body, secret));
}

const gg = await ggwaveFactory();
gg.disableLog();
const params = gg.getDefaultParameters();
params.sampleRateInp = params.sampleRateOut = RATE;
const tx = gg.init(params);

function encode(wire) {
  const raw = gg.encode(tx, wire, gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 25);
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

function decode(audio) {
  const rx = gg.init(params);
  const bytes = new Int8Array(audio.buffer);
  let heard = null;
  for (let i = 0; i < bytes.length; i += 4096) {
    const r = gg.decode(rx, bytes.slice(i, i + 4096));
    if (r && r.length) heard = new TextDecoder().decode(new Uint8Array(r));
  }
  gg.free(rx);
  return heard;
}

// 16-bit mono PCM WAV with half a second of silence on each side.
function wav(samples) {
  const pad = RATE / 2;
  const n = samples.length + 2 * pad;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + (pad + i) * 2);
  }
  return buf;
}

mkdirSync(`${root}docs/demo-audio`, { recursive: true });
let failed = 0;
for (const [name, wire, expect] of [
  ['tampered', tamperedWire(), (signer) => signer === null],
  ['expired', expiredWire(), (signer, f) => signer !== null && f.expiresMin < nowMinutes()],
]) {
  const audio = encode(wire);
  const heard = decode(audio);
  const { body, sig } = fromWire(heard ?? wire);
  const signer = verify(body, sig);
  const ok = heard === wire && expect(signer, unpackBody(body));
  if (!ok) failed++;
  writeFileSync(`${root}docs/demo-audio/${name}.wav`, wav(audio));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}.wav ${(audio.length / RATE).toFixed(2)}s, signer=${signer?.id ?? 'none'}`);
}
process.exit(failed ? 1 : 0);
