// Range-test pattern: same 100-char shape as a real signed alert (so airtime and
// decode odds match), but marked zone 0xFFFF, type TEST, detail = run id,
// msgId = sequence number. The signature is random: receivers show it as
// UNVERIFIED TEST and never buzz.
import { packBody, unpackBody, toWire, fromWire, nowMinutes, SIG_LEN } from '../shared/payload.js';

export const PATTERN_ZONE = 0xffff;

export const makePattern = (run, seq) =>
  toWire(packBody({ type: 12, detail: run & 0xff, zone: PATTERN_ZONE, expiresMin: nowMinutes() + 5, msgId: seq }), crypto.getRandomValues(new Uint8Array(SIG_LEN)));

export function parsePattern(text) {
  try {
    const a = unpackBody(fromWire(text).body);
    return a.zone === PATTERN_ZONE && a.type === 12 ? { run: a.detail, seq: a.msgId } : null;
  } catch {
    return null;
  }
}

// One CSV row per run; quotes every field.
export const toCsv = (rows) => [['time', 'run', 'protocol', 'distance_m', 'noise', 'sent', 'received', 'success_pct', 'device'], ...rows.map((r) =>
  [r.time, r.run, r.protocol, r.distance, r.noise, r.sent, r.received, r.sent ? Math.round((100 * r.received) / r.sent) : '', r.device])]
  .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
