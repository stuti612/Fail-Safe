// Reply chirp ("I need help", the ASK rung): a short UNSIGNED code a phone plays
// back so a console in earshot can queue it with no network. Residents have no
// keys, so every help code is an "unverified resident report": shown, ranked,
// never auto-dismissed.
//
//   byte 0       magic 0x48 ('H'), so it can't be mistaken for an alert
//   byte 1       need: 1 medical, 2 mobility, 3 trapped, 4 other
//   byte 2       flags: bit0 life threat, bit1 vulnerable (child, elder, disability, power-dependent)
//   byte 3       people count (1-255)
//   bytes 4-5    language, 2 ASCII letters (phrasebook code)
//   bytes 6-7    msgId of the alert being answered (uint16, 0 = none)
//   bytes 8-9    request id (uint16, random per request; dedupe key with created)
//   bytes 10-11  latitude  × 100 (int16, ~1 km; 0x7FFF = unknown)
//   bytes 12-13  longitude × 100 (int16)
//   bytes 14-17  created, unix minutes (uint32)
// 18 bytes -> 24 base64 chars (~1.5 s on FASTEST).
import { bytesToB64, b64ToBytes } from './payload.js';

export const HELP_MAGIC = 0x48;
export const HELP_LEN = 18;
export const NEEDS = { 1: 'medical', 2: 'mobility', 3: 'trapped', 4: 'other' };
const NO_GPS = 0x7fff;

export function encodeHelp({ need, lifeThreat = false, vulnerable = false, people = 1, lang = 'en', msgId = 0, reqId, lat = null, lon = null, createdMin }) {
  const b = new Uint8Array(HELP_LEN);
  const v = new DataView(b.buffer);
  v.setUint8(0, HELP_MAGIC);
  v.setUint8(1, NEEDS[need] ? need : 4);
  v.setUint8(2, (lifeThreat ? 1 : 0) | (vulnerable ? 2 : 0));
  v.setUint8(3, Math.min(255, Math.max(1, people | 0)));
  v.setUint8(4, lang.charCodeAt(0) || 101);
  v.setUint8(5, lang.charCodeAt(1) || 110);
  v.setUint16(6, msgId & 0xffff);
  v.setUint16(8, reqId & 0xffff);
  v.setInt16(10, lat == null ? NO_GPS : Math.round(lat * 100));
  v.setInt16(12, lon == null ? NO_GPS : Math.round(lon * 100));
  v.setUint32(14, createdMin);
  return bytesToB64(b);
}

// Returns a help request, or null for anything that isn't a well-formed help code.
export function decodeHelp(text) {
  let b;
  try { b = b64ToBytes(String(text).trim()); } catch { return null; }
  if (b.length !== HELP_LEN || b[0] !== HELP_MAGIC || !NEEDS[b[1]] || b[3] === 0 || b[2] > 3) return null;
  const v = new DataView(b.buffer);
  const lat = v.getInt16(10), lon = v.getInt16(12);
  const lang = String.fromCharCode(b[4], b[5]);
  if (!/^[a-z]{2}$/.test(lang)) return null;
  return {
    need: b[1], lifeThreat: Boolean(b[2] & 1), vulnerable: Boolean(b[2] & 2), people: b[3], lang,
    msgId: v.getUint16(6), reqId: v.getUint16(8),
    lat: lat === NO_GPS ? null : lat / 100, lon: lon === NO_GPS ? null : lon / 100,
    createdMin: v.getUint32(14),
  };
}

// Same request heard by sound and POSTed by the app merges; a phone report (callId) never merges with one.
export const helpKey = (r) => `${r.reqId}:${r.createdMin}:${r.callId || ''}`;

// HELP QUEUE order: life threat first, then vulnerability, then oldest request.
// Missing flags count as false (POST / Retell reports may omit them).
export const rankHelp = (queue) => [...queue].sort((a, b) =>
  (!!b.lifeThreat - !!a.lifeThreat) || (!!b.vulnerable - !!a.vulnerable) || ((a.createdMin || 0) - (b.createdMin || 0)));

// Adds a request unless already queued (repeats, or the same request heard by
// sound and also POSTed). Returns true if it was new.
export function enqueueHelp(queue, req) {
  if (!req || queue.some((q) => helpKey(q) === helpKey(req))) return false;
  queue.push(req);
  return true;
}
