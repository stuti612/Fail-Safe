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
check('non-Actual status maps to TEST preview', r.alerts[0].type === 12);
r = parseCap(cap({ expires: '2099-01-01T00:00:00Z' }), opts);
check('far-future CAP expiry is capped at 12 h (bounds replay)', r.alerts[0].expiresMin === opts.nowMin + 12 * 60 && r.warnings.some((w) => /capped/.test(w)));
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

// ---- Reply chirp (offline ASK) + help queue ----
const { encodeHelp, decodeHelp, rankHelp, enqueueHelp, helpKey } = await import('../shared/help.js');
const req = { need: 3, lifeThreat: true, vulnerable: true, people: 4, lang: 'es', msgId: 4242, reqId: 777, lat: 34.19, lon: -118.13, createdMin: 29000000 };
const helpWire = encodeHelp(req);
check(`help code is ${helpWire.length} chars`, helpWire.length === 24);
check('help code round-trips', JSON.stringify(decodeHelp(helpWire)) === JSON.stringify(req));
check('help without GPS round-trips as null', decodeHelp(encodeHelp({ ...req, lat: null, lon: null })).lat === null);
check('alert wire is not a help code', decodeHelp(wire) === null);
check('garbage is not a help code', decodeHelp('!!!') === null && decodeHelp('') === null && decodeHelp('SGVsbG8gd29ybGQhISEhISEh') === null);
check('help code is not an alert', throws(() => fromWire(helpWire), /length/));
{
  const g = gg.init(params);
  const raw = gg.encode(tx, helpWire, gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FASTEST, 25);
  const bytes = new Int8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  let heard = null;
  for (let i = 0; i < bytes.length; i += 4096) { const x = gg.decode(g, bytes.slice(i, i + 4096)); if (x && x.length) heard = new TextDecoder().decode(new Uint8Array(x)); }
  gg.free(g);
  check(`help chirp decodes through ggwave FASTEST (${(bytes.length / 4 / 48000).toFixed(2)} s)`, decodeHelp(heard)?.reqId === 777);
}
const q = [];
const base = { need: 4, people: 1, lang: 'en', msgId: 0, lat: null, lon: null };
enqueueHelp(q, { ...base, reqId: 1, createdMin: 100 });                                  // old, ordinary
enqueueHelp(q, { ...base, reqId: 2, createdMin: 200, vulnerable: true });               // vulnerable
enqueueHelp(q, { ...base, reqId: 3, createdMin: 300, lifeThreat: true });               // life threat, newest
enqueueHelp(q, { ...base, reqId: 4, createdMin: 50 });                                  // oldest ordinary
check('duplicate help request is ignored', enqueueHelp(q, { ...base, reqId: 3, createdMin: 300, lifeThreat: true }) === false && q.length === 4);
check('help queue: life threat, then vulnerable, then oldest', rankHelp(q).map((r) => r.reqId).join() === '3,2,4,1');

// ---- Help server / Retell ----
const srv = await import('../server/core.mjs');
const st = srv.createState();
check('server refuses an unsigned alert', throws(() => srv.publishAlert(st, toWire(body, new Uint8Array(64))), /unsigned/));
srv.publishAlert(st, wire);
check('phone agent reads the signed alert in Spanish', /EVACÚE AHORA/.test(srv.activeAlertsText(st, 'es')));
check('no alerts -> agent never says "safe" is OK', /Do not tell the caller they are safe/.test(srv.activeAlertsText(srv.createState())));
check('webhook with missing transcript queues a callback', srv.handleRetellWebhook(st, { event: 'call_ended', call: { call_id: 'c1' } }).queued === true);
check('webhook with garbage transcript queues a callback', srv.handleRetellWebhook(st, { event: 'call_ended', call: { call_id: 'c2', transcript: '%%%% ... ##' } }).queued === true);
check('webhook with null body does not crash', srv.handleRetellWebhook(st, null).queued === false);
check('same call is not queued twice (call_analyzed after call_ended)', srv.handleRetellWebhook(st, { event: 'call_analyzed', call: { call_id: 'c1' } }).queued === false && st.help.filter((h) => h.callId === 'c1').length === 1);
check('call with no recorded need goes to human review (never auto-closed)', srv.handleRetellWebhook(st, { event: 'call_ended', call: { call_id: 'c3', transcript: 'Agent: hello. User: what is the alert for Altadena please' } }).queued === true);
srv.reportNeed(st, { need: 'medical' }, { callId: 'c5' });
check('call where the agent recorded a need is not queued again', srv.handleRetellWebhook(st, { event: 'call_ended', call: { call_id: 'c5', transcript: 'long enough transcript here' } }).queued === false);
check('life-threat words in transcript are queued as life threat', srv.handleRetellWebhook(st, { event: 'call_ended', call: { call_id: 'c4', transcript: 'my father is not breathing' } }).queued && srv.rankedHelp(st)[0].lifeThreat);
check('report_need with life threat tells agent to send caller to 911', /911/.test(srv.reportNeed(st, { need: 'medical', life_threat: true }).reply));
check('help cannot be closed without a person\'s name', srv.markHandled(st, helpKey(st.help[0]), '') === false && srv.markHandled(st, helpKey(st.help[0]), 'Ana R.') === true);
{
  const s2 = srv.createState();
  const venue = readFileSync(`${root}keys/coliseum-ops.secret`, 'utf8').trim();
  const b2 = packBody({ ...alert, type: 5, zone: 10 }); // same msgId, different issuer
  srv.publishAlert(s2, wire);
  srv.publishAlert(s2, toWire(b2, sign(b2, venue)));
  check('same msgId from two issuers keeps both alerts', s2.alerts.length === 2);
  srv.publishAlert(s2, wire);
  check('re-publishing the same alert does not duplicate it', s2.alerts.length === 2);
  const now = Date.now();
  s2.help = [
    { reqId: 1, createdMin: Math.floor(now / 60000) - 25 * 60, status: 'open', note: 'old' },
    { reqId: 2, createdMin: Math.floor(now / 60000) - 120, status: 'handled', handledAt: now - 2 * 3600_000, note: 'Main St', from: '+1213', lat: 34.1, lon: -118.1 },
    { reqId: 3, createdMin: Math.floor(now / 60000), status: 'open', note: 'keep', from: '+1310' },
  ];
  srv.pruneHelp(s2, now);
  check('help older than 24 h is dropped', !s2.help.some((h) => h.reqId === 1));
  check('handled help loses note/number/location after 1 h', s2.help.find((h) => h.reqId === 2).note === '' && s2.help.find((h) => h.reqId === 2).from === null);
  check('open help keeps its details', s2.help.find((h) => h.reqId === 3).from === '+1310');
}
{
  const h = { status: 'open', from: '+12135550100', reqId: 1, createdMin: 1 };
  srv.startCallback(h);
  check('callback: no answer -> retry', srv.callbackOutcome(h, { disconnection_reason: 'dial_no_answer' }) === 'call 2');
  check('callback: answered but silent counts as NOT reached -> sms', srv.callbackOutcome(h, { disconnection_reason: 'user_hangup', transcript: '' }) === 'sms');
  const v = { status: 'open', from: '+1', reqId: 2, createdMin: 1 };
  srv.startCallback(v);
  check('callback: voicemail is never "reached"', srv.callbackOutcome(v, { disconnection_reason: 'voicemail_reached', transcript: 'Hi you have reached Maria leave a message' }) === 'call 2');
  const a = { status: 'open', from: '+1', reqId: 3, createdMin: 1 };
  srv.startCallback(a);
  check('callback: real answer -> back to a person, request stays open', srv.callbackOutcome(a, { disconnection_reason: 'user_hangup', transcript: 'yes we still need help my mother is trapped' }) === 'answered' && a.status === 'open' && a.lifeThreat);
  check('callback: no phone number -> straight to door knock', srv.startCallback({ status: 'open', reqId: 4, createdMin: 1 }) === 'door knock');
  const s3 = srv.createState();
  s3.help.push(h);
  check('webhook routes our callback outcome by helpKey metadata', srv.handleRetellWebhook(s3, { event: 'call_ended', call: { metadata: { helpKey: helpKey(h) }, disconnection_reason: 'dial_busy' } }).step === 'door knock' || h.callback.step === 'door knock');
}
const sigBody = '{"event":"call_ended"}', ts = String(Date.now());
const { createHmac } = await import('node:crypto');
const goodSig = `v=${ts},d=${createHmac('sha256', 'k').update(sigBody + ts).digest('hex')}`;
check('Retell signature verifies', srv.verifyRetell(sigBody, goodSig, 'k'));
check('Retell signature rejects tampering / wrong key / stale', !srv.verifyRetell(sigBody + ' ', goodSig, 'k') && !srv.verifyRetell(sigBody, goodSig, 'x') && !srv.verifyRetell(sigBody, goodSig, 'k', Date.now() + 6 * 60_000));

// ---- Receiver decisions (replay / expiry / dedupe / zone) ----
const { receiveChirp, outsideZone } = await import('../shared/receive.js');
const seenR = new Set();
let rc = receiveChirp(wire, nowMinutes(), seenR);
check('signed alert accepted and verified', rc.status === 'ok' && rc.entry.sender?.id === 'la-county-oem');
seenR.add(wire); seenR.add(rc.key);
check('exact repeat is a duplicate', receiveChirp(wire, nowMinutes(), seenR).status === 'dup');
const sameId = packBody({ ...alert, detail: 5 });
check('same signer + msgId with new body is a duplicate (replay)', receiveChirp(toWire(sameId, sign(sameId, secret)), nowMinutes(), seenR).status === 'dup');
const spoofSameId = toWire(sameId, new Uint8Array(64).fill(1));
const rs = receiveChirp(spoofSameId, nowMinutes(), seenR);
check('unsigned chirp is shown as unverified, not dropped (HOLD rung)', rs.status === 'ok' && rs.entry.sender === null);
const oldBody = packBody({ ...alert, msgId: 9, expiresMin: nowMinutes() - 1 });
check('expired signed alert is dropped', receiveChirp(toWire(oldBody, sign(oldBody, secret)), nowMinutes()).status === 'expired');
check('malformed chirp is dropped', receiveChirp('not base64 !!', nowMinutes()).status === 'malformed');
check('wrong-version chirp is dropped', receiveChirp(toWire(Object.assign(packBody(alert), { 0: 9 }), new Uint8Array(64)), nowMinutes()).status === 'malformed');
const unk = packBody({ ...alert, type: 200, msgId: 10 });
check('unknown phrasebook code still verifies (shown as "Unknown alert")', receiveChirp(toWire(unk, sign(unk, secret)), nowMinutes()).status === 'ok');
check('phone 10 km from Altadena zone -> other area', outsideZone(zones[1], { lat: 34.10, lon: -118.13 }) === true);
check('phone inside Altadena zone -> same area', outsideZone(zones[1], { lat: 34.19, lon: -118.131 }) === false);
check('no GPS -> no guess', outsideZone(zones[1], null) === null);

process.exit(failed ? 1 : 0);
