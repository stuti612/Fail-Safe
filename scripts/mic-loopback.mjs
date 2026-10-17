// Browser mic-path loopback (digital, NOT acoustic): renders 3 range patterns + 1 signed
// alert to a WAV, feeds it to headless Chromium as the microphone, and checks that the
// range page logs 3/3 and the receiver shows the verified alert.
//   python3 -m http.server 8765 &   npm i --no-save playwright   node scripts/mic-loopback.mjs
// Set CHIRP_TEST_ORIGIN to use a different local port.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
const R = new URL('..', import.meta.url).pathname;
const ORIGIN = process.env.CHIRP_TEST_ORIGIN || 'http://localhost:8765';
const require = createRequire(import.meta.url);
globalThis.nacl = require(R + 'vendor/nacl-fast.min.js');
const { packBody, toWire, nowMinutes } = await import(R + 'shared/payload.js');
const { sign } = await import(R + 'shared/trust.js');
const { makePattern } = await import(R + 'range/pattern.js');
const gg = await require(R + 'vendor/ggwave.js')();
gg.disableLog();
const p = gg.getDefaultParameters(); p.sampleRateInp = p.sampleRateOut = 48000;
const tx = gg.init(p);
const secret = readFileSync(R + 'keys/la-county-oem.secret', 'utf8').trim();
const body = packBody({ type: 3, detail: 8, zone: 21, expiresMin: nowMinutes() + 60, msgId: 999 });
const msgs = [makePattern(42, 1), makePattern(42, 2), makePattern(42, 3), toWire(body, sign(body, secret))];
const chunks = [new Float32Array(48000)];
for (const m of msgs) {
  const raw = gg.encode(tx, m, gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 25);
  chunks.push(new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)), new Float32Array(48000));
}
const n = chunks.reduce((a, c) => a + c.length, 0);
const buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(96000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
let o = 44; for (const c of chunks) for (const x of c) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), o); o += 2; }
const wav = `${tmpdir()}/chirp-loopback.wav`;
writeFileSync(wav, buf);
console.log(`wav ${(n / 48000).toFixed(1)} s`);
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ permissions: ['microphone'] });
const errs = [];
const range = await ctx.newPage(); range.on('pageerror', (e) => errs.push(e.message));
await range.goto(`${ORIGIN}/range/`); await range.fill('#sent', '3'); await range.fill('#distance', '0'); await range.click('#listen');
const rx = await ctx.newPage(); rx.on('pageerror', (e) => errs.push(e.message));
await rx.goto(`${ORIGIN}/receiver/`); await rx.waitForTimeout(500); await rx.click('#start');
await range.waitForTimeout(40000);
const runs = await range.innerText('#runs'), cur = await rx.innerText('#current');
console.log('range:', runs.replace(/\t/g, ' | '));
console.log('receiver:', cur.replace(/\n/g, ' | '));
console.log('errors:', errs);
await b.close();
const ok = /3\/3/.test(runs) && /SHELTER IN PLACE/.test(cur) && !errs.length;
console.log(ok ? 'PASS mic loopback' : 'FAIL mic loopback');
process.exit(ok ? 0 : 1);
