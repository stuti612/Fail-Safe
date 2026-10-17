// This build accepts one signed, explicitly hypothetical venue TEST code.
import { fromWire, unpackBody } from './payload.js';
import { verify } from './trust.js';

export const DEMO = Object.freeze({ type: 12, detail: 13, zone: 10, signerId: 'coliseum-ops' });

export function acceptsDemo(alert, sender, nowMin) {
  return sender?.id === DEMO.signerId
    && alert?.type === DEMO.type && alert?.detail === DEMO.detail && alert?.zone === DEMO.zone
    && alert.expiresMin >= nowMin && alert.expiresMin <= nowMin + 2;
}

export function verifiedDemoWire(wire, nowMin) {
  try {
    const { body, sig } = fromWire(wire);
    const sender = verify(body, sig);
    const alert = unpackBody(body);
    return acceptsDemo(alert, sender, nowMin) ? { wire, alert, sender } : null;
  } catch {
    return null;
  }
}
