// Help-queue + Retell logic, no HTTP, so selftest can drive it.
// Never-automate rules live here: the phone agent only reads SIGNED alerts,
// never says anyone is safe, and life threats go to 911 / a person.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { rankHelp, enqueueHelp, NEEDS } from '../shared/help.js';

globalThis.nacl ??= createRequire(import.meta.url)('../vendor/nacl-fast.min.js');
const { fromWire, unpackBody } = await import('../shared/payload.js');
const { verify } = await import('../shared/trust.js');

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const book = json('../shared/phrasebook.json');
const zones = json('../shared/zones.json');
const say = (texts, lang) => (texts && (texts[lang] ?? texts.en)) || '';
const nowMin = () => Math.floor(Date.now() / 60000);

// x-retell-signature: "v=<ms>,d=<hex HMAC-SHA256(rawBody + v, apiKey)>", 5-minute window.
export function verifyRetell(rawBody, header, apiKey, nowMs = Date.now()) {
  const m = /^v=(\d+),d=([0-9a-f]+)$/i.exec(header || '');
  if (!m || Math.abs(nowMs - Number(m[1])) > 5 * 60_000) return false;
  const want = createHmac('sha256', apiKey).update(rawBody + m[1]).digest();
  const got = Buffer.from(m[2], 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

export function createState() {
  return { alerts: [], help: [] };
}

// Console publishes the exact wire it chirped; only verified, unexpired alerts are kept.
export function publishAlert(state, wire) {
  const { body, sig } = fromWire(wire);
  const sender = verify(body, sig);
  if (!sender) throw new Error('unsigned or untrusted alert refused');
  const alert = unpackBody(body);
  if (alert.expiresMin <= nowMin()) throw new Error('expired alert refused');
  // Same issuer + msgId = same alert (a re-publish); other issuers never collide.
  state.alerts = state.alerts.filter((a) => !(a.senderId === sender.id && a.msgId === alert.msgId) && a.expiresMin > nowMin());
  state.alerts.push({ ...alert, senderId: sender.id, sender: sender.name });
  return alert;
}

export function activeAlertsText(state, lang = 'en') {
  const live = state.alerts.filter((a) => a.expiresMin > nowMin());
  if (!live.length) return 'There are no signed CHIRP alerts right now. Do not tell the caller they are safe. If they are in danger, tell them to call 911.';
  return live.map((a) => {
    const t = book.types[a.type], d = book.details[a.detail];
    return [`Signed CHIRP demo alert from ${a.sender} for ${zones[a.zone]?.name || `zone ${a.zone}`}`, say(t?.text, lang), say(d?.text, lang)].filter(Boolean).join('. ');
  }).join('\n') + '\nRead these exactly. Do not add instructions that are not here.';
}

const LIFE = /\b(not breathing|can'?t breathe|unconscious|bleeding|chest pain|heart attack|stroke|trapped|fire|drowning|overdose)\b/i;

// Retell custom function report_need, or the receiver's POST /help (source 'app').
export function reportNeed(state, args = {}, { source = 'phone', callId = null, from = null } = {}) {
  const need = Number(Object.keys(NEEDS).find((k) => NEEDS[k] === String(args.need || '').toLowerCase()) || args.need) || 4;
  const note = String(args.note || args.location || '').slice(0, 500);
  const req = {
    need: NEEDS[need] ? need : 4,
    lifeThreat: Boolean(args.life_threat ?? args.lifeThreat) || LIFE.test(note),
    vulnerable: Boolean(args.vulnerable),
    people: Math.min(255, Math.max(1, Number(args.people) || 1)),
    lang: /^[a-z]{2}$/.test(args.language || args.lang) ? (args.language || args.lang) : 'en',
    msgId: Number(args.msgId) || 0,
    reqId: Number(args.reqId) || Math.floor(Math.random() * 65536),
    lat: args.lat ?? null, lon: args.lon ?? null,
    createdMin: Number(args.createdMin) || nowMin(),
    source, callId, from: from || args.callback_number || null, note,
    label: 'unverified resident report', status: 'open',
  };
  const added = enqueueHelp(state.help, req);
  return {
    added,
    reply: req.lifeThreat
      ? 'LIFE THREAT: tell the caller to hang up and dial 911 now. If they cannot, transfer to a person immediately. Do not promise help is coming.'
      : 'Request recorded for a person to review. Do not promise when help will arrive and do not tell the caller they are safe.',
  };
}

// Retell webhook. A call with no usable transcript is a risk signal, never an "OK".
export function handleRetellWebhook(state, body) {
  const call = body && typeof body === 'object' ? body.call || {} : {};
  if (body?.event !== 'call_ended' && body?.event !== 'call_analyzed') return { queued: false };
  if (state.help.some((h) => h.callId && h.callId === call.call_id)) return { queued: false };
  const transcript = typeof call.transcript === 'string' ? call.transcript : '';
  const words = transcript.match(/\p{L}{2,}/gu) || [];
  if (words.length >= 3 && !LIFE.test(transcript)) return { queued: false };
  const r = reportNeed(state, {
    need: 'other', life_threat: LIFE.test(transcript),
    note: words.length < 3 ? 'Call ended with no usable transcript: call back / send a person.' : transcript.slice(0, 500),
  }, { source: 'phone', callId: call.call_id || null, from: call.from_number || null });
  return { queued: r.added };
}

export function markHandled(state, key, by) {
  const h = state.help.find((x) => `${x.reqId}:${x.createdMin}` === key);
  if (!h || !String(by || '').trim()) return false; // a named person must close it
  Object.assign(h, { status: 'handled', handledBy: String(by).slice(0, 80), handledAt: Date.now() });
  return true;
}

// Caller notes, numbers and locations are kept only while useful: handled
// requests lose them after 1 h, every request is dropped after 24 h.
export const RETAIN_MS = { handled: 60 * 60_000, all: 24 * 60 * 60_000 };
export function pruneHelp(state, now = Date.now()) {
  state.help = state.help.filter((h) => now - (h.createdMin || 0) * 60000 < RETAIN_MS.all);
  for (const h of state.help) {
    if (h.status === 'handled' && now - (h.handledAt || now) > RETAIN_MS.handled) Object.assign(h, { note: '', from: null, lat: null, lon: null });
  }
}

export const rankedHelp = (state) => rankHelp(state.help.filter((h) => h.status === 'open')).concat(state.help.filter((h) => h.status !== 'open'));
