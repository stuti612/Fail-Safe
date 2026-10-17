// Independent regression gate for the mock help server. No real caller data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createState, reportNeed, handleRetellWebhook, activeAlertsText } from '../server/core.mjs';

const failures = [];
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (err) { failures.push(name); console.error(`FAIL ${name}: ${err.message}`); }
}

await check('later call analysis upgrades an earlier empty-call case', () => {
  const state = createState();
  handleRetellWebhook(state, { event: 'call_ended', call: { call_id: 'call-a', transcript: '' } });
  handleRetellWebhook(state, { event: 'call_analyzed', call: { call_id: 'call-a', transcript: 'my child is not breathing' } });
  assert.equal(state.help.length, 1);
  assert.equal(state.help[0].lifeThreat, true);
});

await check('unresolved English mobility call enters human-review queue', () => {
  const state = createState();
  handleRetellWebhook(state, { event: 'call_analyzed', call: { call_id: 'call-b', transcript: 'I need a wheelchair now please' } });
  assert.equal(state.help.length, 1);
});

await check('unresolved Spanish distress call enters human-review queue', () => {
  const state = createState();
  handleRetellWebhook(state, { event: 'call_analyzed', call: { call_id: 'call-c', transcript: 'Mi hijo no respira ayuda' } });
  assert.equal(state.help.length, 1);
});

await check('triage parses false and whole people count', () => {
  const state = createState();
  reportNeed(state, { life_threat: 'false', vulnerable: 'false', people: '2.5' });
  assert.equal(state.help[0].lifeThreat, false);
  assert.equal(state.help[0].vulnerable, false);
  assert.equal(Number.isInteger(state.help[0].people), true);
});

await check('distinct reports sharing a short request ID are both retained', () => {
  const state = createState();
  reportNeed(state, { reqId: 71, createdMin: 500, note: 'synthetic mobility need' }, { source: 'app' });
  reportNeed(state, { reqId: 71, createdMin: 500, note: 'synthetic medical need' }, { source: 'phone', callId: 'call-d' });
  assert.equal(state.help.length, 2);
});

await check('demo-key readout does not claim official warning authority', () => {
  const state = createState();
  state.alerts.push({ type: 12, detail: 13, zone: 10, expiresMin: Math.floor(Date.now() / 60000) + 1, sender: 'CHIRP venue TEST key' });
  assert.doesNotMatch(activeAlertsText(state), /official alert/i);
});

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

await check('supervisor queue is not exposed without authorization', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), CHIRP_SUPERVISOR_TOKEN: 'synthetic-test-token', CHIRP_APP_ORIGIN: 'http://localhost:8000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    let response;
    for (let i = 0; i < 30; i++) {
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
      try { response = await fetch(`http://127.0.0.1:${port}/help`); break; } catch { await delay(50); }
    }
    assert.ok(response, 'server did not start');
    assert.ok([401, 403].includes(response.status), `GET /help returned ${response.status}`);
    assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
    const allowed = await fetch(`http://127.0.0.1:${port}/help`, { headers: { Authorization: 'Bearer synthetic-test-token', Origin: 'http://localhost:8000' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:8000');
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
    const unrelated = await fetch(`http://127.0.0.1:${port}/help`, { headers: { Authorization: 'Bearer synthetic-test-token', Origin: 'https://unrelated.test' } });
    assert.equal(unrelated.headers.get('access-control-allow-origin'), null);
    const preflight = await fetch(`http://127.0.0.1:${port}/help`, { method: 'OPTIONS', headers: { Origin: 'https://unrelated.test' } });
    assert.equal(preflight.status, 403);
  } finally {
    child.kill();
  }
});

await check('missing supervisor token closes private routes by default', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), CHIRP_SUPERVISOR_TOKEN: '', CHIRP_APP_ORIGIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    let response;
    for (let i = 0; i < 30; i++) {
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
      try { response = await fetch(`http://127.0.0.1:${port}/help`, { headers: { Origin: 'https://unrelated.test' } }); break; } catch { await delay(50); }
    }
    assert.ok(response, 'server did not start');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const simplePost = await fetch(`http://127.0.0.1:${port}/help`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(simplePost.status, 415);
  } finally {
    child.kill();
  }
});

console.log(`${8 - failures.length}/8 server-safety gates passed`);
if (failures.length) process.exitCode = 1;
