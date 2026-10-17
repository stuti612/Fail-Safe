// End-to-end check without a browser: pack -> sign -> base64 -> ggwave audio ->
// decode -> verify -> unpack. Also checks that tampered and unsigned alerts fail.
//
//   node scripts/selftest.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.nacl = require('../vendor/nacl-fast.min.js');
const ggwaveFactory = require('../vendor/ggwave.js');

const { packBody, unpackBody, toWire, fromWire, nowMinutes } = await import('../shared/payload.js');
const { sign, verify } = await import('../shared/trust.js');

const root = new URL('..', import.meta.url).pathname;
const secret = readFileSync(`${root}keys/la-county-oem.secret`, 'utf8').trim();

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};

const alert = { type: 1, detail: 2, zone: 2, expiresMin: nowMinutes() + 60, msgId: 4242 };
const body = packBody(alert);
const wire = toWire(body, sign(body, secret));
check(`wire is ${wire.length} chars (ggwave limit 140)`, wire.length <= 140);

const parsed = fromWire(wire);
check('signature verifies', verify(parsed.body, parsed.sig)?.id === 'la-county-oem');
check('fields round-trip', JSON.stringify(unpackBody(parsed.body)) === JSON.stringify({ version: 1, ...alert }));

const tampered = parsed.body.slice();
tampered[1] = 11; // EVACUATE -> ALL_CLEAR
check('tampered alert is rejected', verify(tampered, parsed.sig) === null);
check('random signature is rejected', verify(parsed.body, new Uint8Array(64).fill(7)) === null);

const gg = await ggwaveFactory();
gg.disableLog();
const params = gg.getDefaultParameters();
params.sampleRateInp = params.sampleRateOut = 48000;
const tx = gg.init(params);
for (const proto of ['AUDIBLE_FAST', 'AUDIBLE_FASTEST']) {
  const raw = gg.encode(tx, wire, gg.ProtocolId[`GGWAVE_PROTOCOL_${proto}`], 25);
  const audio = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const rx = gg.init(params);
  const bytes = new Int8Array(audio.buffer);
  let heard = null;
  for (let i = 0; i < bytes.length; i += 4096) {
    const r = gg.decode(rx, bytes.slice(i, i + 4096));
    if (r && r.length) heard = new TextDecoder().decode(new Uint8Array(r));
  }
  gg.free(rx);
  check(`${proto}: ${(audio.length / 48000).toFixed(2)}s of audio decodes back`, heard === wire);
}

process.exit(failed ? 1 : 0);
