// CHIRP wire format v1.
// An alert is an 11-byte body plus a 64-byte Ed25519 signature, sent as base64
// (100 chars). Never send free text: phones look codes up in phrasebook.json.
//
//   byte 0      version (1)
//   byte 1      alert type code    -> phrasebook.types
//   byte 2      detail code        -> phrasebook.details
//   bytes 3-4   zone id (uint16)   -> zones.json
//   bytes 5-8   expires, unix minutes (uint32)
//   bytes 9-10  message id (uint16), used to ignore repeats

export const VERSION = 1;
export const BODY_LEN = 11;
export const SIG_LEN = 64;

export function packBody({ type, detail, zone, expiresMin, msgId }) {
  const body = new Uint8Array(BODY_LEN);
  const v = new DataView(body.buffer);
  v.setUint8(0, VERSION);
  v.setUint8(1, type);
  v.setUint8(2, detail);
  v.setUint16(3, zone);
  v.setUint32(5, expiresMin);
  v.setUint16(9, msgId);
  return body;
}

export function unpackBody(body) {
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    version: v.getUint8(0),
    type: v.getUint8(1),
    detail: v.getUint8(2),
    zone: v.getUint16(3),
    expiresMin: v.getUint32(5),
    msgId: v.getUint16(9),
  };
}

export function toWire(body, sig) {
  const all = new Uint8Array(BODY_LEN + SIG_LEN);
  all.set(body);
  all.set(sig, BODY_LEN);
  return bytesToB64(all);
}

// Throws on anything that is not a well-formed v1 alert.
export function fromWire(text) {
  const all = b64ToBytes(text.trim());
  if (all.length !== BODY_LEN + SIG_LEN) throw new Error(`bad length ${all.length}`);
  if (all[0] !== VERSION) throw new Error(`unknown version ${all[0]}`);
  return { body: all.slice(0, BODY_LEN), sig: all.slice(BODY_LEN) };
}

export const nowMinutes = () => Math.floor(Date.now() / 60000);

export function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
