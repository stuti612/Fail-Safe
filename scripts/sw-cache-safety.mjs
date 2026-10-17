// Synthetic service-worker cache test: private API responses must never be stored.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const handlers = {};
const entries = new Map([['chirp-v8', new Map()], ['chirp-v9', new Map()], ['chirp-v10', new Map()]]);
const puts = [];
const caches = {
  keys: async () => [...entries.keys()],
  delete: async (key) => entries.delete(key),
  open: async (key) => ({
    addAll: async () => {},
    put: async (req, res) => {
      puts.push(req.url);
      if (!entries.has(key)) entries.set(key, new Map());
      entries.get(key).set(req.url, res);
    },
  }),
  match: async () => null,
};
const self = {
  registration: { scope: 'https://example.test/chirp/' },
  location: { origin: 'https://example.test' },
  clients: { claim: async () => {} },
  skipWaiting: async () => {},
  addEventListener: (name, handler) => { handlers[name] = handler; },
};
const response = { ok: true, type: 'basic', clone() { return this; } };
runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), {
  self, caches, URL, fetch: async () => response, Promise,
});
const request = (url, token = false) => ({ method: 'GET', url, headers: { has: (name) => token && name.toLowerCase() === 'authorization' } });
async function visit(url, token = false) {
  let handled = false;
  handlers.fetch({ request: request(url, token), respondWith: (promise) => { handled = true; return promise; } });
  await new Promise((resolve) => setImmediate(resolve));
  return handled;
}
assert.equal(await visit('https://example.test/chirp/receiver/?strict=1'), true);
assert.equal(puts.length, 1);
assert.equal(await visit('https://example.test/chirp/range/'), true);
assert.equal(await visit('https://example.test/chirp/help'), false);
assert.equal(await visit('https://example.test/chirp/receiver/', true), false);
assert.equal(await visit('https://other.test/chirp/receiver/'), false);
assert.deepEqual(puts, ['https://example.test/chirp/receiver/?strict=1', 'https://example.test/chirp/range/']);
await new Promise((resolve) => handlers.activate({ waitUntil: (promise) => promise.then(resolve) }));
assert.equal(entries.has('chirp-v8'), false, 'old cache with API responses must be deleted');
assert.equal(entries.has('chirp-v9'), false, 'previous app cache must be deleted');
assert.equal(entries.has('chirp-v10'), false, 'previous app cache must be deleted');
console.log('PASS service worker caches only static app files and removes old API cache');
