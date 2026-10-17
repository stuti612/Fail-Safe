// Help-queue + Retell logic, no HTTP, so selftest can drive it.
// Never-automate rules live here: the phone agent only reads SIGNED alerts,
// never says anyone is safe, and life threats go to 911 / a person.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { rankHelp, enqueueHelp, helpKey, NEEDS } from '../shared/help.js';

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

// ponytail: keyword flag (en + es) only raises priority; it never lowers or closes anything.
const LIFE = /\b(not breathing|can'?t breathe|unconscious|bleeding|chest pain|heart attack|stroke|trapped|fire|drowning|overdose|no respira|inconsciente|sangrando|atrapad[oa]|incendio|infarto|ahog\w*)\b/i;
const bool = (v) => v === true || v === 1 || /^(true|yes|1)$/i.test(String(v ?? ''));

// Retell custom function report_need, or the receiver's POST /help (source 'app').
export function reportNeed(state, args = {}, { source = 'phone', callId = null, from = null } = {}) {
  const need = Number(Object.keys(NEEDS).find((k) => NEEDS[k] === String(args.need || '').toLowerCase()) || args.need) || 4;
  const note = String(args.note || args.location || '').slice(0, 500);
  const req = {
    need: NEEDS[need] ? need : 4,
    lifeThreat: bool(args.life_threat ?? args.lifeThreat) || LIFE.test(note),
    vulnerable: bool(args.vulnerable),
    people: Math.min(255, Math.max(1, Math.floor(Number(args.people)) || 1)),
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

// Retell webhook. Deciding that a caller needs nothing is not automated: every
// call without a recorded report_need goes to a person for review, and a call
// with no usable transcript is a risk signal, never an "OK". A later event for
// the same call (call_analyzed after call_ended) updates the same entry.
export function handleRetellWebhook(state, body) {
  const call = body && typeof body === 'object' ? body.call || {} : {};
  if (body?.event !== 'call_ended' && body?.event !== 'call_analyzed') return { queued: false };
  if (call.metadata?.helpKey) { // one of our outbound callbacks
    const h = state.help.find((x) => helpKey(x) === call.metadata.helpKey);
    return { queued: false, help: body.event === 'call_ended' ? h : null, step: h && body.event === 'call_ended' ? callbackOutcome(h, call) : h?.callback?.step };
  }
  const transcript = typeof call.transcript === 'string' ? call.transcript : '';
  const words = transcript.match(/\p{L}{2,}/gu) || [];
  const life = LIFE.test(transcript);
  const note = words.length < 3 ? 'Call ended with no usable transcript: call back / send a person.' : `Call review (no need recorded by agent): ${transcript.slice(0, 480)}`;
  const existing = call.call_id && state.help.find((h) => h.callId === call.call_id);
  if (existing) {
    if (life) existing.lifeThreat = true;
    if (existing.reviewOnly && words.length >= 3) existing.note = note;
    return { queued: false, updated: true };
  }
  const r = reportNeed(state, { need: 'other', life_threat: life, note }, { source: 'phone', callId: call.call_id || null, from: call.from_number || null });
  const h = state.help[state.help.length - 1];
  if (r.added) h.reviewOnly = true; // created by the webhook, not by the agent
  return { queued: r.added };
}

export function markHandled(state, key, by) {
  const h = state.help.find((x) => helpKey(x) === key);
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

// ---- Outbound callback ladder ("what if they don't pick up?") ----
// call -> retry once -> SMS -> flag for a door knock. No answer, busy, voicemail
// and silence all count as NOT reached; nothing here ever marks a person "OK".
// An answered call goes back to a person to review (status stays open).
export const LADDER = ['call 1', 'call 2', 'sms', 'door knock'];
const NOT_REACHED = /^(dial_no_answer|dial_busy|dial_failed|voicemail_reached|inactivity|error_no_audio_received|machine_detected)$/;

export function startCallback(h) {
  if (h.status !== 'open') throw new Error('request is already handled');
  h.callback = { step: h.from ? 'call 1' : 'door knock', log: [`${new Date().toISOString()} ${h.from ? 'calling' : 'no phone number: door knock needed'}`] };
  return h.callback.step;
}

// Outcome of one callback call (from the Retell webhook). Returns the next step.
export function callbackOutcome(h, { disconnection_reason: reason = '', transcript = '' } = {}) {
  const cb = h.callback;
  if (!cb || cb.step === 'answered' || cb.step === 'door knock') return cb?.step;
  const spoke = (String(transcript).match(/\p{L}{2,}/gu) || []).length >= 3;
  if (!NOT_REACHED.test(reason) && spoke) {
    cb.step = 'answered';
    if (LIFE.test(transcript)) h.lifeThreat = true;
  } else {
    cb.step = LADDER[LADDER.indexOf(cb.step) + 1] || 'door knock';
  }
  cb.log.push(`${new Date().toISOString()} ${reason || (spoke ? 'answered' : 'silence')} -> ${cb.step}`);
  return cb.step;
}
