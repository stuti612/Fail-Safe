// CAP 1.2 (the IPAWS format) -> CHIRP alerts. Pure functions, no DOM, so the
// Node selftest can run them. Only codes go on air; CAP free text never does.
//
// ponytail: regex reader, not a full XML parser. Enough for one CAP document
// pasted by an operator; switch to DOMParser if we ever ingest live feeds.

export const MAX_CAP_CHARS = 64 * 1024;
export const DEFAULT_VALID_MIN = 60;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const clean = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e]).trim();
const tagRe = (tag) => new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'g');
const all = (xml, tag) => [...xml.matchAll(tagRe(tag))].map((m) => m[1]);
const one = (xml, tag) => clean(all(xml, tag)[0] ?? '');
const count = (xml, re) => (xml.match(re) || []).length;
const words = (s) => s.toLowerCase().match(/[a-z0-9]+/g) || [];

// ponytail: word-overlap score (zone's area named = 0.5, plus share of its name
// words). Ties go to the lowest id. Use CAP <polygon>/<geocode> if feeds carry them.
export function matchZone(areaDesc, zones) {
  const have = new Set(words(areaDesc));
  let best = null, bestScore = 0;
  for (const [id, z] of Object.entries(zones)) {
    const areaHit = words(z.area).every((w) => have.has(w)) ? 0.5 : 0;
    const name = words(z.name);
    const score = areaHit + 0.5 * (name.filter((w) => have.has(w)).length / name.length);
    if (score > bestScore) [best, bestScore] = [Number(id), score];
  }
  return bestScore >= 0.5 ? best : null;
}

// Returns { alerts: [{ type, detail, zone|null, areaDesc, expiresMin }], warnings, info }.
// Throws (with an operator-readable message) when the alert must not be sent.
export function parseCap(xml, { map, zones, nowMin }) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('Paste a CAP alert first.');
  if (xml.length > MAX_CAP_CHARS) throw new Error(`CAP text too large (${xml.length} chars, max ${MAX_CAP_CHARS}).`);
  for (const tag of ['alert', 'info', 'area']) {
    const opens = count(xml, new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>`, 'g'));
    const closes = count(xml, new RegExp(`</(?:[\\w-]+:)?${tag}>`, 'g'));
    if (opens !== closes) throw new Error(`Malformed XML: <${tag}> opened ${opens}×, closed ${closes}×.`);
  }
  const alertXml = all(xml, 'alert')[0];
  if (alertXml === undefined) throw new Error('Not a CAP alert: no <alert> element.');
  if (/^cancel$/i.test(one(alertXml, 'msgType'))) throw new Error('CAP Cancel is not converted. Send ALL CLEAR or a new alert by hand.');
  const infos = all(alertXml, 'info');
  if (!infos.length) throw new Error('CAP alert has no <info> block.');
  const info = infos.find((i) => /^en/i.test(one(i, 'language') || 'en')) || infos[0];

  const warnings = [];
  const event = one(info, 'event');
  const status = one(alertXml, 'status');
  const same = all(info, 'eventCode').filter((c) => /^SAME$/i.test(one(c, 'valueName'))).map((c) => one(c, 'value').toUpperCase());
  let code = same.map((c) => map.same[c]).find(Boolean) || map.events.find((e) => event.toLowerCase().includes(e.match));
  if (!code) {
    code = map.generic;
    warnings.push(`Unknown event "${event || '(missing)'}": using the generic "official alert" code. Check the preview.`);
  }
  if (status && !/^actual$/i.test(status)) {
    code = map.test;
    warnings.push(`CAP status is "${status}", not Actual: sending as TEST.`);
  }

  const expires = one(info, 'expires');
  let expiresMin = nowMin + DEFAULT_VALID_MIN;
  if (expires) {
    const t = Date.parse(expires);
    if (Number.isNaN(t)) throw new Error(`Unreadable <expires>: "${expires}".`);
    expiresMin = Math.floor(t / 60000);
    if (expiresMin <= nowMin) throw new Error(`Alert already expired (${expires}). Refusing to broadcast.`);
  } else {
    warnings.push(`No <expires>: valid for ${DEFAULT_VALID_MIN} minutes.`);
  }

  const areas = all(info, 'area').map((a) => one(a, 'areaDesc'));
  if (!areas.length) areas.push('');
  const alerts = [];
  const used = new Set();
  for (const areaDesc of areas) {
    const zone = matchZone(areaDesc, zones);
    if (zone !== null && used.has(zone)) continue; // one alert per zone
    if (zone === null) warnings.push(`No zone matches "${areaDesc || '(no area)'}": pick one by hand.`);
    else used.add(zone);
    alerts.push({ type: code.type, detail: code.detail, zone, areaDesc, expiresMin });
  }
  return {
    alerts,
    warnings,
    info: { event, status, urgency: one(info, 'urgency'), severity: one(info, 'severity'), expires, headline: one(info, 'headline'), sender: one(alertXml, 'sender') },
  };
}
