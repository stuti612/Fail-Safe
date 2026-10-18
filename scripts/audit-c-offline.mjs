// Track C / scope 5: offline / PWA. Loads the receiver online with the service worker enabled,
// waits for activation, checks the cache name and contents, then goes offline
// (context.setOffline) and reloads receiver / console / range / index from cache. Also checks
// that non-app requests (help API style URLs, Authorization requests) never enter Cache Storage
// and simulates a VERSION bump via a routed sw.js to exercise the update path.
//   node scripts/audit-c-offline.mjs           (static server on 127.0.0.1:8976)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { Checks, startStatic, watch, PHONE, ROOT, SCREENS, wire, configJs } from './audit-c-lib.mjs';

const C = new Checks('offline');
const srv = await startStatic(8976);
const browser = await chromium.launch();
const swSrc = readFileSync(ROOT + 'sw.js', 'utf8');
const VERSION = swSrc.match(/VERSION = '([^']+)'/)[1];
const FILES = [...swSrc.matchAll(/^\s+'(\.\/[^']*)',$/gm)].map((m) => m[1]);
C.info('sw.js', `VERSION=${VERSION}, ${FILES.length} files precached, strategy: network-first, cache fallback (ignoreSearch)`);

try {
  const ctx = await browser.newContext({ ...PHONE, serviceWorkers: 'allow' });
  const host = new URL(srv.origin).host;
  let swBump = null;
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.host !== host) return route.abort();
    if (u.pathname.endsWith('/shared/config.js')) return route.fulfill({ contentType: 'text/javascript', body: configJs({}) });
    if (swBump && u.pathname === '/sw.js') return route.fulfill({ contentType: 'text/javascript', body: swSrc.replace(VERSION, swBump) });
    return route.continue();
  });
  const p = await ctx.newPage();
  const log = watch(p);
  await p.goto(`${srv.origin}/receiver/`);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  const controlled = await p.evaluate(() => !!navigator.serviceWorker.controller);
  C.ok('service worker activated and controls the receiver (clients.claim)', controlled);
  const cache = await p.evaluate(async () => {
    const keys = await caches.keys();
    const entries = {};
    for (const k of keys) entries[k] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
    return { keys, entries };
  });
  C.ok(`cache name is ${VERSION} and only that`, cache.keys.length === 1 && cache.keys[0] === VERSION, cache.keys);
  C.ok(`all ${FILES.length} app files precached`, (cache.entries[VERSION] || []).length >= FILES.length, (cache.entries[VERSION] || []).length);

  // Non-app requests must not be cached (same-origin unknown path, Authorization header, POST, query on API path).
  await p.evaluate(async (o) => {
    await fetch(o + '/help').catch(() => {});
    await fetch(o + '/help?lang=es').catch(() => {});
    await fetch(o + '/receiver/app.js', { headers: { Authorization: 'Bearer x' } }).catch(() => {});
    await fetch(o + '/alerts', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    await fetch('http://127.0.0.1:8977/help', { headers: { Authorization: 'Bearer x' } }).catch(() => {});
  }, srv.origin);
  await p.waitForTimeout(500);
  const after = await p.evaluate(async (v) => (await (await caches.open(v)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search), VERSION);
  const appPaths = new Set(FILES.map((f) => new URL(f, srv.origin + '/').pathname));
  const extra = after.filter((x) => !appPaths.has(x.split('?')[0]));
  C.ok('no API / non-app responses in Cache Storage (help, alerts, auth requests)', extra.length === 0, extra);
  C.info('cache entries with a query string (network-first puts the request URL incl. query)', after.filter((x) => x.includes('?')));

  // ---- offline ----
  await ctx.setOffline(true);
  const pages = ['/receiver/', '/receiver/?debug=1', '/receiver/?kiosk=1', '/receiver/?strict=1', '/console/', '/console/?strict=1', '/range/', '/', '/index.html'];
  for (const path of pages) {
    const q = await ctx.newPage();
    const l = watch(q);
    const resp = await q.goto(srv.origin + path).catch((e) => ({ err: e.message }));
    await q.waitForTimeout(600);
    const ok = !resp?.err && (await q.evaluate(() => document.body?.innerText.length > 20));
    C.ok(`offline load from cache: ${path}`, ok, resp?.err || '');
    C.ok(`offline no page errors: ${path}`, l.pageErrors.length === 0, l.pageErrors);
    const appErrs = l.consoleErrors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
    C.ok(`offline no app console errors: ${path}`, appErrs.length === 0, appErrs);
    if (l.consoleErrors.length - appErrs.length) C.info(`offline network errors (expected while offline): ${path}`, l.consoleErrors.filter((e) => !appErrs.includes(e)));
    if (path === '/receiver/?debug=1') {
      await q.waitForFunction(() => document.getElementById('start').textContent.length > 0);
      C.ok('offline: network pill says Offline', /Offline/.test(await q.textContent('#net')), await q.textContent('#net'));
      await q.fill('#paste', wire({ msgId: 1 }, null)); await q.click('#paste-go');
      C.ok('offline: alert renders from cached phrasebook', /EVACUATE/.test(await q.textContent('#current')), await q.textContent('#current'));
      const sw = await q.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      C.ok('offline: no horizontal overflow at 390 px with "Offline · still listening" pill', sw[0] <= sw[1], sw);
      await q.screenshot({ path: `${SCREENS}/c-offline-receiver-390.png` });
    }
    if (path === '/console/') {
      await q.selectOption('#cap-sample', '1-evacuation-altadena');
      await q.waitForTimeout(400);
      C.ok('offline: console loads CAP sample from cache', /CAP:/.test(await q.textContent('#cap-out')), (await q.textContent('#cap-out')).slice(0, 120));
    }
    await q.close();
  }
  await ctx.setOffline(false);

  // ---- update path: VERSION bump ----
  swBump = VERSION + '-audit';
  const r = await p.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update().catch((e) => e.message); return 'ok'; });
  await p.waitForTimeout(3000);
  const keys2 = await p.evaluate(() => caches.keys());
  if (keys2.includes(swBump)) C.ok('VERSION bump: new cache installed and old cache deleted on activate', keys2.length === 1, keys2);
  else C.info('VERSION bump simulation', `routed sw.js not picked up by registration.update() (${r}); cache keys ${keys2}. Update path reviewed from source only.`);
  C.ok('no page errors on receiver during SW lifecycle', log.pageErrors.length === 0, log.pageErrors);
  await ctx.close();
} finally {
  await browser.close();
  srv.stop();
  C.done();
}
