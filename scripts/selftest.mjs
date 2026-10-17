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

// ---- Trust edge cases ----
const stranger = globalThis.nacl.sign.keyPair();
check('alert signed by an unknown key is rejected', verify(body, globalThis.nacl.sign.detached(body, stranger.secretKey)) === null);

// ---- CAP / IPAWS import ----
const { parseCap, MAX_CAP_CHARS } = await import('../console/cap.js');
const json = (p) => JSON.parse(readFileSync(`${root}${p}`, 'utf8'));
const capMap = json('shared/cap-map.json');
const zones = json('shared/zones.json');
const book = json('shared/phrasebook.json');
const opts = { map: capMap, zones, nowMin: nowMinutes() };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const cap = ({ event = 'Evacuation Immediate', expires = '2099-01-01T00:00:00Z', areas = ['Altadena: Lake Ave corridor'], status = 'Actual', extra = '' } = {}) =>
  `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><status>${status}</status><msgType>Alert</msgType><info>` +
  (event === null ? '' : `<event>${event}</event>`) + (expires === null ? '' : `<expires>${expires}</expires>`) + extra +
  areas.map((a) => `<area><areaDesc>${a}</areaDesc></area>`).join('') + '</info></alert>';

const allCodes = [...Object.values(capMap.same), ...capMap.events, capMap.generic, capMap.test];
check('every CAP mapping points at a real phrasebook code', allCodes.every((c) => book.types[c.type] && book.details[c.detail]));

for (const f of ['1-evacuation-altadena', '2-smoke-multi-area', '3-unknown-event-tsunami']) {
  const r = parseCap(readFileSync(`${root}docs/samples/${f}.xml`, 'utf8'), opts);
  check(`sample ${f}: ${r.alerts.length} alert(s), zones ${r.alerts.map((a) => a.zone)}`, r.alerts.length > 0);
}
let r = parseCap(cap(), opts);
check('CAP evacuation -> EVACUATE in Altadena Lake Ave zone', r.alerts.length === 1 && r.alerts[0].type === 1 && r.alerts[0].zone === 1);
r = parseCap(cap({ event: 'Something Weird', extra: '<eventCode><valueName>SAME</valueName><value>EVI</value></eventCode>' }), opts);
check('SAME code wins over event text', r.alerts[0].type === 1);
r = parseCap(cap({ event: 'Volcano Warning' }), opts);
check('unknown event -> generic code + warning', r.alerts[0].type === capMap.generic.type && r.warnings.some((w) => /Unknown event/.test(w)));
r = parseCap(cap({ event: null }), opts);
check('missing <event> -> generic code + warning', r.alerts[0].type === capMap.generic.type && r.warnings.length > 0);
r = parseCap(cap({ expires: null }), opts);
check('missing <expires> -> default validity + warning', r.alerts[0].expiresMin === opts.nowMin + 60 && r.warnings.some((w) => /expires/.test(w)));
r = parseCap(cap({ areas: [] }), opts);
check('missing <area> -> one alert needing a manual zone', r.alerts.length === 1 && r.alerts[0].zone === null);
r = parseCap(cap({ areas: ['Pacific Palisades: Sunset Blvd', 'Malibu: Pacific Coast Hwy', 'Malibu PCH', 'Nowhere Town'] }), opts);
check('multiple areas -> one alert per zone, unmatched kept for manual pick', JSON.stringify(r.alerts.map((a) => a.zone)) === '[3,5,null]');
r = parseCap(cap({ status: 'Exercise' }), opts);
check('non-Actual status is sent as TEST', r.alerts[0].type === 12);
check('expired CAP is refused', throws(() => parseCap(cap({ expires: '2020-01-01T00:00:00Z' }), opts), /expired/));
check('unreadable <expires> is refused', throws(() => parseCap(cap({ expires: 'soon' }), opts), /Unreadable/));
check('malformed XML is refused', throws(() => parseCap(cap().replace('</info>', ''), opts), /Malformed/));
check('non-CAP text is refused', throws(() => parseCap('hello', opts), /no <alert>/));
check('CAP Cancel is refused', throws(() => parseCap(cap().replace('Alert</msgType>', 'Cancel</msgType>'), opts), /Cancel/));
check('oversized CAP is refused', throws(() => parseCap(cap({ extra: `<description>${'x'.repeat(MAX_CAP_CHARS)}</description>` }), opts), /too large/));
r = parseCap(cap({ extra: `<description>${'long text '.repeat(3000)}</description>` }), opts);
const capBody = packBody({ ...r.alerts[0], msgId: 1 });
check('long CAP description still yields a 100-char chirp (codes only)', toWire(capBody, sign(capBody, secret)).length === 100);

// ---- SLOW rung ----
const { waitSeconds, isWide, slowKey } = await import('../console/slow.js');
const a1 = { type: 1, zone: 1 };
check('first broadcast is not slowed', waitSeconds(a1, {}, 1e12) === 0);
check('repeat within 60 s is slowed', waitSeconds(a1, { [slowKey(a1)]: 1e12 }, 1e12 + 10_000) === 50);
check('repeat after 60 s is allowed', waitSeconds(a1, { [slowKey(a1)]: 1e12 }, 1e12 + 60_000) === 0);
check('same alert to another zone is not slowed', waitSeconds({ type: 1, zone: 2 }, { [slowKey(a1)]: 1e12 }, 1e12) === 0);
check('countywide and all-gates zones need a second confirm', isWide({ zone: 99 }, zones) && isWide({ zone: 11 }, zones) && !isWide(a1, zones));
check('CAP "Los Angeles County" maps to the countywide zone', parseCap(cap({ areas: ['Los Angeles County'] }), opts).alerts[0].zone === 99);

process.exit(failed ? 1 : 0);
