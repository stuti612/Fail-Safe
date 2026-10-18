// Audit track A helper: runs an existing gate (selftest / test-demo-policy) with
// THROWAWAY keypairs instead of keys/*.secret, so the gate's logic can be judged
// separately from the key-file problem.
//
//   node scripts/audit-a-gate-shim.mjs selftest
//
// - Every TRUSTED_KEYS entry's publicKey is replaced IN MEMORY ONLY with a fresh
//   tweetnacl key (shared/keys.js on disk is untouched).
// - fs.readFileSync for any path ending in keys/<id>.secret returns the matching
//   throwaway secret. The real secret files are NEVER opened by this shim.
import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const nacl = (globalThis.nacl = require('../vendor/nacl-fast.min.js'));
const b64 = (u8) => Buffer.from(u8).toString('base64');

const { TRUSTED_KEYS } = await import('../shared/keys.js');
const secrets = {};
for (const k of TRUSTED_KEYS) {
  const kp = nacl.sign.keyPair();
  k.publicKey = b64(kp.publicKey);
  secrets[k.id] = b64(kp.secretKey);
}

const orig = fs.readFileSync;
fs.readFileSync = function patched(p, ...rest) {
  const s = p instanceof URL ? fileURLToPath(p) : String(p);
  const m = s.match(/keys[\\/]([\w-]+)\.secret$/);
  if (m) {
    if (!secrets[m[1]]) throw new Error(`audit shim: no throwaway key for ${m[1]}`);
    return secrets[m[1]];
  }
  return orig.call(this, p, ...rest);
};
syncBuiltinESMExports();

const name = process.argv[2];
if (!/^[\w-]+$/.test(name || '')) throw new Error('usage: audit-a-gate-shim.mjs <gate-name>');
await import(`./${name}.mjs`);
