// Track C / scope 2 (paste path): receiver behaviour via the ?debug=1 paste box, with a throwaway
// audit key trusted through a routed shared/keys.js. navigator.vibrate is stubbed and counted.
// Alarm caps (30 s phone / 60 s kiosk) are checked with Playwright's fake clock.
//   node scripts/audit-c-receiver.mjs         (static server on 127.0.0.1:8972)
import { chromium } from 'playwright';
import { Checks, startStatic, newContext, watch, PHONE, AUDIT, AUDIT_VENUE, UNTRUSTED, wire, nowMin, SCREENS, INSTRUMENT, phrasebook } from './audit-c-lib.mjs';

const C = new Checks('receiver');
const srv = await startStatic(8972);
const browser = await chromium.launch();
const en = (k) => phrasebook.ui[k].en;

async function open(ctx, query = '?debug=1') {
  const page = await ctx.newPage();
  page.log = watch(page);
  await page.goto(`${srv.origin}/receiver/${query}`);
  await page.waitForFunction(() => document.getElementById('start').textContent.length > 0);
  return page;
}
const paste = async (page, w) => { await page.fill('#paste', w); await page.click('#paste-go'); await page.waitForTimeout(150); };
const state = (page) => page.evaluate(() => ({
  vibes: window.__vibes.length,
  vibeZero: window.__vibes.filter((v) => v.p === 0).length,
  silence: !document.getElementById('silence').classList.contains('hidden'),
  current: document.querySelector('#current .alert')?.className || '',
  badge: document.querySelector('#current .badge')?.textContent || '',
  zone: document.querySelector('#current .zone')?.textContent || '',
  title: document.querySelector('#current .title')?.textContent || '',
  meta: document.querySelector('#current .meta')?.textContent || '',
  history: JSON.parse(localStorage.getItem('chirp.history') || '[]').length,
  verifiedInHistory: JSON.parse(localStorage.getItem('chirp.history') || '[]').filter((h) => h.sender).length,
}));

try {
  const ctx = await newContext(browser, srv.origin, { ...PHONE });
  await ctx.addInitScript(INSTRUMENT);

  // ---- verified ----
  let p = await open(ctx);
  await paste(p, wire({ msgId: 1 }, AUDIT.sec));
  let s = await state(p);
  C.ok('verified alert shown with verified badge', /extreme/.test(s.current) && s.badge === en('verified'), s);
  C.ok('verified alert shows signer name', /AUDIT C throwaway key/.test(s.meta), s.meta);
  C.ok('verified alert vibrates', s.vibes >= 1, s.vibes);
  C.ok('verified alert shows Silence alarm button', s.silence);
  await p.screenshot({ path: `${SCREENS}/c-rx-verified.png` });
  await p.waitForTimeout(2600);
  const before = (await state(p)).vibes;
  C.ok('alarm repeats while not silenced (vibration every ~2.4 s)', before >= 2, before);
  await p.click('#silence');
  s = await state(p);
  C.ok('Silence hides button and calls vibrate(0)', !s.silence && s.vibeZero === 1, s);
  await p.waitForTimeout(3000);
  const after = (await state(p)).vibes;
  C.ok('no further vibration after Silence', after === s.vibes, { atSilence: s.vibes, after });

  // ---- duplicate + replay ----
  const w1 = wire({ msgId: 2 }, AUDIT.sec);
  await paste(p, w1); await paste(p, w1);
  s = await state(p);
  C.ok('duplicate wire shown once', s.history === 2, s.history);
  await paste(p, wire({ msgId: 2, type: 3, detail: 8 }, AUDIT.sec));
  s = await state(p);
  C.ok('replay: same signer+msgId with different body is ignored', s.history === 2 && !/SHELTER/i.test(s.title), { history: s.history, title: s.title });
  C.ok('replay logged as dup', p.log.warnings.some((w) => /ignored dup/.test(w)), p.log.warnings.slice(-3));
  await p.close();

  // ---- unsigned spoof, wrong key, expired, >12 h, unknown ----
  p = await open(ctx);
  await paste(p, wire({ msgId: 3 }, null));
  s = await state(p);
  C.ok('unsigned spoof shown as UNVERIFIED', /unverified/.test(s.current) && /UNVERIFIED/.test(s.badge), s);
  C.ok('unsigned spoof never vibrates / no Silence button', s.vibes === 0 && !s.silence, s);
  await p.screenshot({ path: `${SCREENS}/c-rx-unverified.png` });
  await paste(p, wire({ msgId: 4 }, UNTRUSTED.sec));
  s = await state(p);
  C.ok('validly signed by an untrusted key -> UNVERIFIED, no vibration', /unverified/.test(s.current) && s.vibes === 0, s);
  await paste(p, wire({ msgId: 5, expiresMin: nowMin() - 5 }, AUDIT.sec));
  s = await state(p);
  C.ok('expired signed alert shown as Expired (greyed), not as current verified', /expired/.test(s.current) && s.badge === en('expired'), s);
  C.ok('expired signed alert never vibrates', s.vibes === 0 && !s.silence, s);
  await p.screenshot({ path: `${SCREENS}/c-rx-expired.png` });
  const h0 = s.history;
  await paste(p, wire({ msgId: 6, expiresMin: nowMin() + 12 * 60 + 2 }, AUDIT.sec));
  s = await state(p);
  C.ok('>12 h validity rejected (not shown, no vibration)', s.history === h0 && s.vibes === 0, s);
  await paste(p, wire({ msgId: 7, expiresMin: nowMin() + 12 * 60 }, AUDIT.sec));
  s = await state(p);
  C.ok('exactly 12 h validity accepted', s.history === h0 + 1, s.history);
  await p.click('#silence').catch(() => {});
  await paste(p, wire({ msgId: 8, type: 200, detail: 99 }, AUDIT.sec));
  s = await state(p);
  C.ok("unknown type code renders 'Unknown alert'", /Unknown alert \(200\)/.test(s.title), s.title);
  await p.selectOption('#lang', 'es');
  s = await state(p);
  C.ok('unknown type label is localized in Spanish UI', !/Unknown alert/.test(s.title), s.title);
  await p.selectOption('#lang', 'en');
  await paste(p, 'not base64 !!');
  await paste(p, wire({ msgId: 9, zone: 0xffff, type: 12 }, null));
  s = await state(p);
  C.ok('malformed and range-pattern chirps are dropped', s.history === h0 + 2, s.history);
  C.ok('no page errors across paste cases', p.log.pageErrors.length === 0, p.log.pageErrors);
  await p.close();

  // ---- unsigned spoofs vs a verified alert ----
  p = await open(ctx);
  await paste(p, wire({ msgId: 10, type: 1, detail: 12 }, AUDIT.sec));
  await p.click('#silence');
  await paste(p, wire({ msgId: 11, type: 11, detail: 0 }, null)); // fake ALL CLEAR
  s = await state(p);
  await p.screenshot({ path: `${SCREENS}/c-rx-spoof-displaces.png`, fullPage: true });
  C.ok('verified EVACUATE stays the primary card after one unsigned ALL CLEAR spoof', /extreme/.test(s.current), { primary: s.current, title: s.title });
  for (let i = 0; i < 30; i++) await p.evaluate((w) => { document.getElementById('paste').value = w; document.getElementById('paste-go').click(); }, wire({ msgId: 100 + i, type: 11, detail: 0 }, null));
  s = await state(p);
  C.ok('verified alert still on screen/in history after 30 unsigned spoofs', s.verifiedInHistory >= 1, s);
  await p.close();

  // ---- tampered stored history ----
  p = await ctx.newPage();
  await p.goto(`${srv.origin}/receiver/`);
  await p.evaluate((w) => localStorage.setItem('chirp.history', JSON.stringify([{ wire: w, sender: { id: 'la-county-oem', name: 'LA County' }, alert: { type: 1 }, at: Date.now() }])), wire({ msgId: 12 }, null));
  await p.reload(); await p.waitForTimeout(300);
  s = await state(p);
  C.ok('tampered localStorage history cannot fake a signer (re-verified -> UNVERIFIED)', /unverified/.test(s.current), s);
  await p.close();
  await ctx.close();

  // ---- GPS ----
  for (const [label, geo, expectVibe, expectAway] of [
    ['GPS far outside zone', { latitude: 40.7128, longitude: -74.006 }, false, true],
    ['GPS inside zone', { latitude: 34.1897, longitude: -118.1312 }, true, false],
    ['no GPS permission', null, true, false],
  ]) {
    const g = await newContext(browser, srv.origin, { ...PHONE, ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}) });
    await g.addInitScript(INSTRUMENT);
    const q = await open(g);
    await q.waitForTimeout(800); // let locate() resolve
    await paste(q, wire({ msgId: 20 }, AUDIT.sec));
    s = await state(q);
    C.ok(`${label}: vibration ${expectVibe ? 'on' : 'suppressed'}`, (s.vibes > 0) === expectVibe, s.vibes);
    C.ok(`${label}: 'another area' label ${expectAway ? 'shown' : 'absent'}`, s.zone.includes(en('otherArea')) === expectAway, s.zone);
    if (expectAway) await q.screenshot({ path: `${SCREENS}/c-rx-other-area.png` });
    await g.close();
  }

  // ---- alarm caps with a fake clock (debug path, not listening: flash + vibrate loop) ----
  for (const [label, query, capMs] of [['phone', '?debug=1', 30000], ['kiosk', '?debug=1&kiosk=1', 60000]]) {
    const k = await newContext(browser, srv.origin, { ...PHONE });
    await k.addInitScript(INSTRUMENT);
    const q = await k.newPage();
    await q.clock.install();
    await q.goto(`${srv.origin}/receiver/${query}`);
    await q.waitForFunction(() => document.getElementById('start').textContent.length > 0);
    await paste(q, wire({ msgId: 30 }, AUDIT.sec));
    await q.clock.runFor(capMs - 3000);
    const mid = await state(q);
    await q.clock.runFor(6000);
    const end = await state(q);
    const expected = Math.ceil(capMs / 2400);
    C.ok(`${label} alarm still active just before ${capMs / 1000} s cap`, mid.silence, mid);
    C.ok(`${label} alarm stops by ${capMs / 1000} s cap (Silence hidden)`, !end.silence, end);
    C.ok(`${label} vibration count ~= cap/2.4 s (${expected} +/-1)`, Math.abs(end.vibes - expected) <= 1, end.vibes);
    await k.close();
  }

  // ---- strict mode ----
  const st = await newContext(browser, srv.origin, { ...PHONE, keys: 'venue' });
  await st.addInitScript(INSTRUMENT);
  p = await open(st, '?debug=1&strict=1');
  const langs = await p.$$eval('#lang option', (o) => o.map((x) => x.value));
  C.ok('strict: only en/es offered', langs.join(',') === 'en,es', langs);
  C.ok('strict: banner shown', await p.isVisible('#strict-banner'));
  const demo = (o = {}) => ({ type: 12, detail: 13, zone: 10, expiresMin: nowMin() + 1, ...o });
  for (const [label, w] of [
    ['other code signed by venue key', wire(demo({ type: 1, detail: 12, zone: 1, msgId: 40 }), AUDIT_VENUE.sec)],
    ['demo code signed by non-venue trusted key', wire(demo({ msgId: 41 }), AUDIT.sec)],
    ['demo code unsigned', wire(demo({ msgId: 42 }), null)],
    ['demo code with 3-min validity', wire(demo({ msgId: 43, expiresMin: nowMin() + 3 }), AUDIT_VENUE.sec)],
    ['demo code expired', wire(demo({ msgId: 44, expiresMin: nowMin() - 1 }), AUDIT_VENUE.sec)],
  ]) {
    await paste(p, w);
    s = await state(p);
    C.ok(`strict rejects: ${label}`, s.history === 0, s.history);
  }
  await paste(p, wire(demo({ msgId: 45 }), AUDIT_VENUE.sec));
  s = await state(p);
  C.ok('strict accepts the signed demo code', s.history === 1 && /Demo signature/.test(s.meta), s);
  C.info('strict mode alarm', `vibrations=${s.vibes} (strict mode never alarms by design: onChirp guards alarm with !STRICT_DEMO)`);
  await p.screenshot({ path: `${SCREENS}/c-rx-strict-demo.png` });
  await st.close();
} finally {
  await browser.close();
  srv.stop();
  C.done();
}
