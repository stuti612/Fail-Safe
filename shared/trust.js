// Ed25519 signing and verification. Needs vendor/nacl-fast.min.js loaded first
// (it sets globalThis.nacl).
import { TRUSTED_KEYS } from './keys.js';
import { b64ToBytes, bytesToB64 } from './payload.js';

const nacl = () => globalThis.nacl;

export function sign(body, secretKeyB64) {
  return nacl().sign.detached(body, b64ToBytes(secretKeyB64));
}

// Returns the trusted key entry that signed this body, or null.
export function verify(body, sig) {
  for (const key of TRUSTED_KEYS) {
    if (nacl().sign.detached.verify(body, sig, b64ToBytes(key.publicKey))) return key;
  }
  return null;
}

export function publicKeyFromSecret(secretKeyB64) {
  return bytesToB64(nacl().sign.keyPair.fromSecretKey(b64ToBytes(secretKeyB64)).publicKey);
}

export function findTrustedKey(publicKeyB64) {
  return TRUSTED_KEYS.find((k) => k.publicKey === publicKeyB64) || null;
}
