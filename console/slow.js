// SLOW rung: the console won't repeat the same alert to the same zone within
// COOLDOWN_MS, and a wide-area zone needs a typed second confirmation (the
// lesson of the Jan 2025 LA County false countywide alert).
export const COOLDOWN_MS = 60_000;
export const slowKey = (a) => `${a.type}:${a.zone}`;

// Seconds the operator must still wait before repeating this alert (0 = go).
export const waitSeconds = (alert, sentAt, now) =>
  Math.max(0, Math.ceil(((sentAt[slowKey(alert)] ?? -Infinity) + COOLDOWN_MS - now) / 1000));

export const isWide = (alert, zones) => Boolean(zones[alert.zone]?.wide);
