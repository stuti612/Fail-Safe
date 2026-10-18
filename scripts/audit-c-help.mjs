// Track C / scope 8: "I need help" end to end.
//   receiver form (need, people, life threat -> 911 line, vulnerable) -> reply chirp played ->
//   honest status (NOT CONFIRMED / NOT DELIVERED) with no endpoint and while offline ->
//   POST delivered when back online -> console help queue (token prompt, ranking, Handled by needs
//   a name, escalate ladder in MOCK mode) -> receiver's captured help chirp heard by the console's
//   fake mic and merged with the POSTed copy. Checks PII left in localStorage on both sides.
// Starts python static server on 127.0.0.1:8980 and server/server.mjs on 127.0.0.1:8981 with a
// fake supervisor token, CHIRP_APP_ORIGIN=http://127.0.0.1:8980, no Retell keys. Deletes
// server/queue.json afterwards (refuses to run if one already exists).
//   node scripts/audit-c-help.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { Checks, startStatic, newContext, watch, PHONE, DESKTOP, AUDIT, wire, INSTRUMENT, SCREENS, ROOT, phrasebook, withFakeMic, capturedWav, sleep } from './audit-c-lib.mjs';

const C = new Checks('help');
const QUEUE = ROOT + 'server/queue.json';
if (existsSync(QUEUE) || existsSync(QUEUE + '.tmp')) { console.error('server/queue.json exists; refusing to touch it'); process.exit(2); }
const TOKEN = 'audit-c-fake-token';
const API = 'http://127.0.0.1:8981';
const srv = await startStatic(8980);
const env = { ...process.env, PORT: '8981', CHIRP_SUPERVISOR_TOKEN: TOKEN, CHIRP_APP_ORIGIN: srv.origin };
for (const k of ['RETELL_API_KEY', 'RETELL_FROM_NUMBER']) delete env[k];
const server = spawn('node', ['server/server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d)); server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; i < 50 && !/127\.0\.0\.1:8981/.test(serverLog); i++) await sleep(100);
C.info('help server', serverLog.trim());
const queue = async () => (await fetch(`${API}/help`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const ui = (k) => phrasebook.ui[k].en;
const browser = await chromium.launch();

async function fillForm(p) {
  await p.click('#help');
  await p.selectOption('#need', '3');
  await p.fill('#people', '4');
  C.ok('911 line hidden until life threat checked', !(await p.isVisible('#call911')));
  await p.check('#life');
  C.ok('life threat shows "call 911" line', (await p.isVisible('#call911')) && (await p.textContent('#call911')) === ui('call911'));
  await p.check('#vuln');
}

try {
  // ---- A: no endpoint configured ----
  const a = await newContext(browser, srv.origin, { ...PHONE, config: { help: '' } });
  await a.addInitScript(INSTRUMENT);
  const pa = await a.newPage();
  const la = watch(pa);
  await pa.goto(`${srv.origin}/receiver/`);
  await pa.waitForFunction(() => document.getElementById('help').textContent.length > 0);
  C.ok('help button available with no alert (full mode)', await pa.isVisible('#help'));
  await fillForm(pa);
  await pa.screenshot({ path: `${SCREENS}/c-help-form.png` });
  await pa.click('#help-send');
  await pa.waitForFunction(() => /CONFIRMED/.test(document.getElementById('help-status').textContent), null, { timeout: 15000 });
  const sa = await pa.textContent('#help-status');
  C.ok('no endpoint: status says chirp played, NOT CONFIRMED, and NOT DELIVERED (1)', sa.includes(ui('helpPlayed')) && sa.includes(`${ui('helpNotDelivered')} (1)`), sa);
  const played = await pa.evaluate(() => window.__played.map((x) => +(x.len / x.rate).toFixed(2)));
  C.ok('help reply chirp played twice (~1.5 s FASTEST each)', played.length === 2 && played.every((d) => d > 1 && d < 2.2), played);
  const outA = await pa.evaluate(() => JSON.parse(localStorage.getItem('chirp.outbox') || '[]'));
  C.ok('undelivered request kept in localStorage outbox', outA.length === 1 && outA[0].need === 3 && outA[0].people === 4 && outA[0].lifeThreat && outA[0].vulnerable, outA);
  C.ok('no page errors (no endpoint)', la.pageErrors.length === 0, la.pageErrors);
  await a.close();

  // ---- B: endpoint set, offline -> online ----
  const b = await newContext(browser, srv.origin, { ...PHONE, config: { help: `${API}/help` }, geolocation: { latitude: 34.18972, longitude: -118.13118 }, permissions: ['geolocation'] });
  await b.addInitScript(INSTRUMENT);
  const pb = await b.newPage();
  const lb = watch(pb);
  await pb.goto(`${srv.origin}/receiver/?debug=1`);
  await pb.waitForFunction(() => document.getElementById('help').textContent.length > 0);
  await pb.evaluate(() => { window.__keep = true; });
  await pb.fill('#paste', wire({ msgId: 4321 }, AUDIT.sec)); await pb.click('#paste-go'); await pb.click('#silence');
  await pb.evaluate(() => { window.__played = []; });
  await b.setOffline(true);
  await pb.waitForTimeout(300);
  await fillForm(pb);
  await pb.click('#help-send');
  await pb.waitForFunction(() => /CONFIRMED/.test(document.getElementById('help-status').textContent), null, { timeout: 15000 });
  const sb = await pb.textContent('#help-status');
  C.ok('offline: status NOT CONFIRMED + NOT DELIVERED (1)', sb.includes(ui('helpPlayed')) && sb.includes(`${ui('helpNotDelivered')} (1)`), sb);
  await pb.screenshot({ path: `${SCREENS}/c-help-not-delivered.png` });
  const helpWav = await capturedWav(pb, 'help-chirp.wav');
  C.ok('server has nothing while phone offline', (await queue()).length === 0);
  await b.setOffline(false);
  await pb.waitForFunction((t) => document.getElementById('help-status').textContent.includes(t), ui('helpDelivered'), { timeout: 15000 }).catch(() => {});
  const sb2 = await pb.textContent('#help-status');
  C.ok('back online: outbox flushed, status says saved in demo queue, nobody acknowledged', sb2.includes(ui('helpDelivered')) && !sb2.includes('NOT DELIVERED'), sb2);
  const q1 = await queue();
  const e = q1[0] || {};
  C.ok('server received POST: need 3, 4 people, life threat, vulnerable, source app, alert msgId', q1.length === 1 && e.need === 3 && e.people === 4 && e.lifeThreat && e.vulnerable && e.source === 'app' && e.msgId === 4321, e);
  C.ok('location coarse (2 decimals) in POST', e.lat === 34.19 && e.lon === -118.13, { lat: e.lat, lon: e.lon });
  const lsB = await pb.evaluate(() => ({ ...localStorage }));
  C.ok('receiver localStorage: outbox emptied after delivery (no lingering PII)', JSON.parse(lsB['chirp.outbox'] || '[]').length === 0, Object.keys(lsB));
  C.ok('no page errors (offline/online)', lb.pageErrors.length === 0, lb.pageErrors);
  await b.close();

  // extra queue entries for ranking
  const now = Math.floor(Date.now() / 60000);
  for (const body of [{ need: 4, people: 1, reqId: 11, createdMin: now - 30, lang: 'es' }, { need: 2, people: 2, vulnerable: true, reqId: 12, createdMin: now - 20, lang: 'ko', note: '<img src=x onerror="window.__xss=1">' }]) {
    await fetch(`${API}/help`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  // ---- C: console queue ----
  const c = await newContext(browser, srv.origin, { ...DESKTOP, config: { help: `${API}/help` } });
  const pc = await c.newPage();
  const lc = watch(pc);
  const prompts = [];
  let nameAnswer = null;
  pc.on('dialog', async (d) => {
    prompts.push(d.message());
    if (/Supervisor token/.test(d.message())) return d.accept(TOKEN);
    if (/Your name/.test(d.message())) return nameAnswer === null ? d.dismiss() : d.accept(nameAnswer);
    return d.dismiss();
  });
  await pc.goto(`${srv.origin}/console/`);
  await pc.waitForFunction(() => document.querySelectorAll('#help-list tr').length >= 3, null, { timeout: 15000 }).catch(() => {});
  C.ok('console asks for supervisor token once on 401', prompts.filter((m) => /Supervisor token/.test(m)).length === 1, prompts);
  const tokenStore = await pc.evaluate(() => ({ s: sessionStorage.getItem('chirp.token'), l: JSON.stringify({ ...localStorage }) }));
  C.ok('token kept in sessionStorage only (not localStorage)', tokenStore.s === TOKEN && !tokenStore.l.includes(TOKEN), tokenStore);
  const rows = await pc.$$eval('#help-list tr', (t) => t.map((r) => [...r.cells].map((c) => c.textContent)));
  C.info('console help queue rows', rows.map((r) => r.slice(0, 2).join(' / ')));
  C.ok('queue ranked: life threat, then vulnerable, then oldest', rows.length === 3 && /LIFE THREAT/.test(rows[0][0]) && /VULNERABLE/.test(rows[1][0]) && /⚪/.test(rows[2][0]), rows.map((r) => r[0]));
  C.ok('every entry labelled unverified resident report', rows.every((r) => /unverified resident report/.test(r[4])));
  C.ok('help note with HTML rendered as text, not executed', !(await pc.evaluate(() => window.__xss)) && (await pc.$$('#help-list img')).length === 0);
  await pc.screenshot({ path: `${SCREENS}/c-help-console-queue.png`, fullPage: true });
  const pii = await pc.evaluate(() => localStorage.getItem('chirp.console.help') || '');
  C.info('console localStorage chirp.console.help (PII at rest)', pii.slice(0, 400));
  C.info('PII at rest: console keeps resident lat/lon, notes and caller numbers in localStorage (24 h; redacted 1 h after handled, per helpqueue.js prune)', /"lat":34\.19/.test(pii) ? 'confirmed: lat/lon + note present' : 'not present');

  // Handled by: dismissed / blank / whitespace keep it open; a name closes it.
  const handledBtn = () => pc.locator('#help-list tr').first().locator('button', { hasText: 'Handled by' });
  for (const ans of [null, '', '   ']) {
    nameAnswer = ans;
    await handledBtn().click();
    await pc.waitForTimeout(200);
    C.ok(`Handled by with ${ans === null ? 'dismissed prompt' : JSON.stringify(ans)} keeps entry open`, /LIFE THREAT/.test(await pc.textContent('#help-list tr:first-child')) && (await handledBtn().count()) === 1);
  }
  // Escalate (MOCK ladder) on the vulnerable entry
  const vulnRow = pc.locator('#help-list tr', { hasText: 'VULNERABLE' });
  await vulnRow.locator('button', { hasText: /Escalate|Call back/ }).click();
  await pc.waitForTimeout(800);
  C.ok('Escalate with no phone number goes straight to DOOR KNOCK NEEDED', /DOOR KNOCK NEEDED/.test(await vulnRow.textContent()), await vulnRow.textContent());
  // A phone-line (Retell mock) report with a caller number walks the full ladder.
  await fetch(`${API}/retell/function`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'report_need', args: { need: 'medical', note: 'need insulin' }, call: { call_id: 'audit-call-1', from_number: '+15555550100' } }) });
  const phoneRow = pc.locator('#help-list tr', { hasText: 'medical' });
  await phoneRow.waitFor({ timeout: 10000 });
  C.ok('phone report shows caller number as Where and a Call back button', /\+15555550100/.test(await phoneRow.textContent()) && (await phoneRow.locator('button', { hasText: 'Call back' }).count()) === 1, await phoneRow.textContent());
  await phoneRow.locator('button', { hasText: 'Call back' }).click();
  await pc.waitForTimeout(500);
  C.ok('Call back starts at call 1', /📞 call 1/.test(await phoneRow.textContent()), await phoneRow.textContent());
  nameAnswer = 'Audit Tester';
  await handledBtn().click();
  await pc.waitForTimeout(800);
  const q2 = await queue();
  const closed = q2.find((x) => x.lifeThreat);
  C.ok('Handled by "Audit Tester" closes entry in console and on server', /✔ Audit Tester/.test(await pc.textContent('#help-list')) && closed?.status === 'handled' && closed?.handledBy === 'Audit Tester', closed);
  const seen = new Set();
  for (let i = 0; i < 50 && !seen.has('door'); i++) { const t = await phoneRow.textContent(); if (/call 2/.test(t)) seen.add('call2'); if (/sms/.test(t)) seen.add('sms'); if (/DOOR KNOCK/.test(t)) seen.add('door'); await sleep(500); }
  C.ok('MOCK ladder: no answer is never OK; phone report escalates to DOOR KNOCK NEEDED', seen.has('door'), [...seen]);
  C.info('ladder steps observed in console (5 s poll may skip short steps)', [...seen].join(' -> '));
  C.ok('no page errors in console queue', lc.pageErrors.length === 0, lc.pageErrors);
  await c.close();

  // ---- D: help chirp heard by console mic, merged with the POSTed copy ----
  if (helpWav) {
    const r = await withFakeMic(helpWav.file, async (br) => {
      const cx = await newContext(br, srv.origin, { ...DESKTOP, config: { help: `${API}/help` }, permissions: ['microphone'] });
      const p = await cx.newPage();
      p.on('dialog', (d) => d.accept(TOKEN));
      await p.goto(`${srv.origin}/console/`);
      await p.waitForTimeout(1500);
      await p.click('#help-listen');
      await p.waitForTimeout(helpWav.seconds * 1000 + 2500);
      const q = await p.evaluate(() => JSON.parse(localStorage.getItem('chirp.console.help') || '[]').map((h) => ({ reqId: h.reqId, source: h.source, need: h.need })));
      return q;
    });
    const posted = q1[0];
    const same = r.filter((h) => h.reqId === posted.reqId);
    C.ok("receiver's real help chirp decoded by console mic (digital loopback)", same.length >= 1, r);
    C.ok('sound + POST copies of the same request merge into one queue entry', same.length === 1, same);
    // Sound-only console (no server)
    const r2 = await withFakeMic(helpWav.file, async (br) => {
      const cx = await newContext(br, srv.origin, { ...DESKTOP, config: { help: '' }, permissions: ['microphone'] });
      const p = await cx.newPage();
      await p.goto(`${srv.origin}/console/`);
      await p.click('#help-listen');
      await p.waitForTimeout(helpWav.seconds * 1000 + 2500);
      return p.$$eval('#help-list tr', (t) => t.map((x) => x.textContent));
    });
    C.ok('sound-only console queues the help chirp (need trapped, 4 people, life threat, source sound)', r2.length === 1 && /LIFE THREAT/.test(r2[0]) && /trapped · 4 people/.test(r2[0]) && /sound/.test(r2[0]), r2);
  } else C.ok('captured help chirp audio', false);
} finally {
  await browser.close();
  server.kill('SIGTERM');
  srv.stop();
  await sleep(300);
  for (const f of [QUEUE, QUEUE + '.tmp']) if (existsSync(f)) rmSync(f);
  C.ok('server/queue.json cleaned up', !existsSync(QUEUE));
  C.done();
}
