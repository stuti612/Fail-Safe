// Receiver decision for one heard chirp. Pure, so selftest can cover it.
//   ok        -> show it (verified alerts may buzz; unverified never do: HOLD rung)
//   dup       -> already shown (same wire, or same signer + msgId)
//   expired   -> drop
//   malformed -> drop
import { fromWire, unpackBody } from './payload.js';
import { verify } from './trust.js';

export function receiveChirp(text, nowMin, seen = new Set()) {
  let parsed;
  try { parsed = fromWire(text); } catch { return { status: 'malformed' }; }
  const sender = verify(parsed.body, parsed.sig);
  const alert = unpackBody(parsed.body);
  // Unsigned chirps dedupe by exact wire only, so a spoof can't suppress a real alert's msgId.
  const key = sender ? `${sender.id}:${alert.msgId}` : text;
  if (seen.has(text) || seen.has(key)) return { status: 'dup' };
  if (alert.expiresMin < nowMin) return { status: 'expired' };
  return { status: 'ok', key, entry: { alert, sender: sender && { id: sender.id, name: sender.name }, wire: text } };
}

// Coarse "is this phone inside the zone?" check. Zones may carry {lat, lon, radiusKm};
// returns null when either side has no position (never guess).
export function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function outsideZone(zone, pos) {
  if (!zone?.lat || !pos) return null;
  return distanceKm(zone, pos) > (zone.radiusKm || 3) * 2;
}
