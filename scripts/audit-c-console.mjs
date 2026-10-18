// Track C / scope 7: broadcaster console. Preview in all languages, key handling (secret never in
// Web Storage), sign & broadcast with review, SLOW cooldown, typed SEND for wide zones (dismiss,
// Enter, accept), spoof button, CAP sample -> zone pick enforced -> batch, strict mode, spoken
// fallback availability, and two digital loopbacks: console's actual played audio -> receiver
// (fake mic) and console test pattern -> range page (fake mic).
//   node scripts/audit-c-console.mjs           (static server on 127.0.0.1:8978)
import { chromium } from 'playwright';
import { Checks, startStatic, newContext, watch, PHONE, AUDIT, UNTRUSTED, INSTRUMENT, SCREENS, phrasebook, withFakeMic, capturedWav } from './audit-c-lib.mjs';

const C = new Checks('console');
const srv = await startStatic(8978);
const browser = await chromium.launch();
const LANGS = Object.keys(phrasebook.languages);
const status = (p) => p.textContent('#status');
const logRows = (p) => p.$$eval('#log tr', (t) => t.length);
const storage = (p) => p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
async function waitDone(p, timeout = 60000) { await p.waitForFunction(() => /^Done|Error/.test(document.getElementById('status').textContent), null, { timeout }); }

try {
  const ctx = await newContext(browser, srv.origin, { ...PHONE });
  await ctx.addInitScript(INSTRUMENT);
  const p = await ctx.newPage();
  const log = watch(p);
  p.on('dialog', (d) => d.dismiss());
  await p.goto(`${srv.origin}/console/`);
  await p.evaluate(() => { window.__keep = true; });

  // ---- preview ----
  const rows = await p.$$eval('#preview .history-item', (r) => r.map((x) => x.textContent));
  C.ok(`preview shows all ${LANGS.length} languages`, rows.length === LANGS.length, rows.length);
  C.ok('preview labels non-English rows (unreviewed)', rows.slice(1).every((r) => /\(unreviewed\)/.test(r)), rows.map((r) => r.slice(0, 30)));
  const types = await p.$$eval('#type option', (o) => o.map((x) => x.value));
  const details = await p.$$eval('#detail option', (o) => o.map((x) => x.value));
  const fallbacks = [];
  for (const d of details) {
    await p.selectOption('#detail', d);
    const r = await p.$$eval('#preview .history-item', (x) => x.map((y) => y.textContent));
    const en = phrasebook.details[d].text.en;
    if (en) r.slice(1).forEach((row, i) => { if (row.includes(en)) fallbacks.push(`detail ${d} in ${LANGS[i + 1]}`); });
  }
  C.ok('preview: no English fallback for any detail in non-English rows', fallbacks.length === 0, fallbacks.join(', '));
  C.info('compose options', `${types.length} types, ${details.length} details, ${(await p.$$eval('#zone option', (o) => o.length))} zones`);

  // ---- key handling ----
  C.ok('secret input is type=password, autocomplete=off', (await p.getAttribute('#secret', 'type')) === 'password' && (await p.getAttribute('#secret', 'autocomplete')) === 'off');
  await p.fill('#secret', 'not-a-key');
  C.ok('invalid key rejected', /not a valid signing key/.test(await p.textContent('#key-status')), await p.textContent('#key-status'));
  await p.fill('#secret', UNTRUSTED.sec);
  C.ok('untrusted valid key warned (phones show UNVERIFIED)', /phones do not trust it/.test(await p.textContent('#key-status')), await p.textContent('#key-status'));
  await p.fill('#secret', AUDIT.sec);
  C.ok('trusted key recognised', /Signing as AUDIT C/.test(await p.textContent('#key-status')), await p.textContent('#key-status'));
  const secretBits = [AUDIT.sec, AUDIT.sec.slice(0, 24), Buffer.from(AUDIT.sec, 'base64').toString('hex').slice(0, 32)];
  let st = await storage(p);
  C.ok('secret not in localStorage/sessionStorage/cookies after paste', !secretBits.some((b) => st.includes(b)), st.slice(0, 200));

  // ---- broadcast (fastest, 1 repeat, speech on) ----
  const voices = await p.evaluate(() => (globalThis.speechSynthesis ? speechSynthesis.getVoices().length : -1));
  C.info('speechSynthesis in headless Chromium', voices < 0 ? 'speechSynthesis undefined' : `${voices} voices available`);
  await p.selectOption('#type', '3'); await p.selectOption('#detail', '8'); await p.selectOption('#zone', '21');
  await p.selectOption('#protocol', 'fastest'); await p.fill('#repeats', '1');
  const t0 = Date.now();
  await p.click('#send');
  await p.waitForSelector('#review[open]');
  C.ok('review dialog: approve enabled for a normal zone, wide confirm hidden', !(await p.isDisabled('#review-approve')) && !(await p.isVisible('#review-wide')));
  const reviewLangs = await p.$$eval('#review-langs .history-item', (r) => r.length);
  C.ok('review dialog shows every language', reviewLangs === LANGS.length, reviewLangs);
  await p.click('#review-approve');
  await waitDone(p);
  const s1 = await status(p);
  C.ok('signed broadcast completes and logs', /^Done/.test(s1) && (await logRows(p)) === 1, s1);
  C.info('spoken fallback result', `${s1} | log airtime: ${await p.textContent('#log tr:first-child td:last-child')}`);
  C.ok('spoken fallback reports missing voices honestly (skipped, not spoken)', voices > 0 || /no on-device voice for: en, es/.test(s1), s1);
  const signedWav = await capturedWav(p, 'console-signed.wav', { from: t0 });
  st = await storage(p);
  C.ok('secret still not in storage after broadcast', !secretBits.some((b) => st.includes(b)));

  // ---- SLOW ----
  await p.click('#send');
  await p.waitForTimeout(200);
  C.ok('SLOW: immediate repeat to same type+zone blocked with wait time, no dialog', /SLOW: .* Wait \d+ s/.test(await status(p)) && !(await p.isVisible('#review')), await status(p));
  await p.selectOption('#zone', '20');
  await p.click('#send');
  await p.waitForSelector('#review[open]');
  C.ok('SLOW is per zone: same alert to another zone goes to review', await p.isVisible('#review'));
  await p.click('#review-cancel');
  await p.waitForTimeout(200);
  C.ok('Cancel -> "Cancelled. Nothing sent."', /Cancelled\. Nothing sent/.test(await status(p)), await status(p));

  // ---- wide zone ----
  const rowsBefore = await logRows(p);
  await p.selectOption('#type', '1'); await p.selectOption('#zone', '99');
  await p.click('#send');
  await p.waitForSelector('#review[open]');
  C.ok('wide zone: SEND confirm shown, Approve disabled, focus in confirm box', (await p.isVisible('#review-wide')) && (await p.isDisabled('#review-approve')) && (await p.evaluate(() => document.activeElement.id)) === 'review-confirm');
  await p.screenshot({ path: `${SCREENS}/c-console-wide-confirm.png` });
  await p.fill('#review-confirm', 'SEN');
  C.ok('wide zone: partial text keeps Approve disabled', await p.isDisabled('#review-approve'));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  C.ok('wide zone: Enter with incomplete text does not send', (await logRows(p)) === rowsBefore && /not confirmed/.test(await status(p)), await status(p));
  await p.click('#send'); await p.waitForSelector('#review[open]');
  await p.fill('#review-confirm', 'SEND');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  C.info('wide zone: Enter after typing SEND', `log rows ${rowsBefore} -> ${await logRows(p)}; status "${await status(p)}" (implicit submit uses the first submit button = Cancel)`);
  await p.click('#send'); await p.waitForSelector('#review[open]');
  await p.keyboard.press('Escape');
  C.ok('wide zone: dismiss (Escape) sends nothing', (await logRows(p)) === rowsBefore && /not confirmed/.test(await status(p)), await status(p));
  await p.click('#send'); await p.waitForSelector('#review[open]');
  await p.fill('#review-confirm', 'send');
  C.info('wide zone: lowercase "send" accepted', String(!(await p.isDisabled('#review-approve'))));
  await p.fill('#review-confirm', 'SEND');
  await p.click('#review-approve');
  await waitDone(p);
  C.ok('wide zone: typed SEND + Approve broadcasts', (await logRows(p)) === rowsBefore + 1, await status(p));

  // ---- spoof ----
  const t1 = Date.now();
  const rb = await logRows(p);
  await p.click('#spoof');
  await waitDone(p);
  const spoofRow = await p.textContent('#log tr:first-child');
  C.ok('spoof button plays an unsigned chirp and logs it as SPOOFED', (await logRows(p)) === rb + 1 && /SPOOFED/.test(spoofRow), spoofRow);
  C.info('spoof button bypasses review dialog', 'yes (by design: unsigned demo chirp, receivers show UNVERIFIED)');
  const spoofWav = await capturedWav(p, 'console-spoof.wav', { from: t1 });

  // ---- CAP ----
  await p.selectOption('#cap-sample', '2-smoke-multi-area');
  await p.waitForFunction(() => document.querySelectorAll('#cap-out select').length === 3);
  const capText = await p.textContent('#cap-out');
  C.ok('CAP sample 2: 3 areas, Topanga needs a manual zone, 12 h cap warning', /Topanga/.test(capText) && /pick one by hand/.test(capText) && /capped at 12 h/.test(capText), capText.slice(0, 300));
  await p.click('#cap-send');
  C.ok('CAP batch blocked until every area has a zone (no dialog)', /Pick a zone for every CAP area first/.test(await status(p)) && !(await p.isVisible('#review')), await status(p));
  await p.locator('#cap-out select').nth(2).selectOption('4');
  const rc = await logRows(p);
  await p.click('#cap-send');
  for (let i = 1; i <= 3; i++) {
    await p.waitForSelector('#review[open]');
    const step = await p.textContent('#review-step');
    C.ok(`CAP batch: review step ${i} of 3 labelled`, new RegExp(`CAP area ${i} of 3`).test(step), step);
    if (i < 3) { await p.click('#review-approve'); await p.waitForFunction(() => !document.getElementById('review').open); }
    else await p.click('#review-cancel');
  }
  await p.waitForTimeout(500);
  C.ok('CAP batch: cancel at area 3 stops batch and says later areas NOT sent', /CAP batch stopped at area 3 of 3; later areas NOT sent/.test(await status(p)) && (await logRows(p)) === rc + 2, await status(p));
  await p.screenshot({ path: `${SCREENS}/c-console-cap-batch.png`, fullPage: true });
  await p.selectOption('#cap-sample', '3-unknown-event-tsunami');
  await p.waitForTimeout(400);
  C.ok('CAP sample 3: unknown event -> generic code with warning', /Unknown event/.test(await p.textContent('#cap-out')), (await p.textContent('#cap-out')).slice(0, 200));
  await p.fill('#cap', '<alert><msgType>Cancel</msgType><info></info></alert>');
  await p.click('#cap-read');
  C.ok('CAP Cancel refused with operator message', /Cancel is not converted/.test(await p.textContent('#cap-out')));

  // ---- test pattern ----
  const t2 = Date.now();
  await p.fill('#pattern-n', '3'); await p.selectOption('#protocol', 'fast');
  await p.click('#pattern-send');
  await p.waitForFunction(() => /done/.test(document.getElementById('pattern-status').textContent), null, { timeout: 60000 });
  const patWav = await capturedWav(p, 'console-pattern.wav', { from: t2 });
  C.ok('no page errors in console session', log.pageErrors.length === 0, log.pageErrors);
  await ctx.close();

  // ---- strict console ----
  const sc = await newContext(browser, srv.origin, { ...PHONE });
  const s = await sc.newPage();
  await s.goto(`${srv.origin}/console/?strict=1`);
  await s.waitForFunction(() => document.getElementById('type').options.length > 0);
  const opts = await s.evaluate(() => ['type', 'detail', 'zone'].map((id) => document.getElementById(id).options.length));
  C.ok('strict console: one type, one detail, one zone; validity locked', opts.join() === '1,1,1' && (await s.isDisabled('#valid')), opts);
  await s.selectOption('#cap-sample', '1-evacuation-altadena');
  await s.waitForTimeout(400);
  C.ok('strict console: CAP is preview-only (no broadcast-all button)', !(await s.isVisible('#cap-send')) && /preview only/.test(await s.textContent('#status')), await s.textContent('#status'));
  await s.fill('#secret', AUDIT.sec);
  C.ok('strict console: non-venue key blocked', /Broadcasting is blocked/.test(await s.textContent('#key-status')));
  await sc.close();

  // ---- loopbacks ----
  if (signedWav && spoofWav) {
    const both = { file: signedWav.file, seconds: signedWav.seconds };
    const res = await withFakeMic(both.file, async (b) => {
      const c = await newContext(b, srv.origin, { permissions: ['microphone'] });
      const r = await c.newPage();
      await r.goto(`${srv.origin}/receiver/`); await r.waitForTimeout(300); await r.click('#start');
      await r.waitForTimeout(both.seconds * 1000 + 2500);
      return r.evaluate(() => JSON.parse(localStorage.getItem('chirp.history') || '[]').map((h) => ({ type: h.alert.type, zone: h.alert.zone, signed: !!h.sender })));
    });
    C.ok("loopback: console's real broadcast audio decoded by receiver as verified SHELTER IN PLACE / Union Station", res.some((h) => h.type === 3 && h.zone === 21 && h.signed), res);
    const res2 = await withFakeMic(spoofWav.file, async (b) => {
      const c = await newContext(b, srv.origin, { permissions: ['microphone'] });
      const r = await c.newPage();
      await r.goto(`${srv.origin}/receiver/`); await r.waitForTimeout(300); await r.click('#start');
      await r.waitForTimeout(spoofWav.seconds * 1000 + 2500);
      return r.evaluate(() => JSON.parse(localStorage.getItem('chirp.history') || '[]').map((h) => ({ type: h.alert.type, signed: !!h.sender })));
    });
    C.ok("loopback: console's spoof audio decoded by receiver as UNVERIFIED", res2.length >= 1 && res2.every((h) => !h.signed), res2);
  } else C.ok('captured console audio for loopback', false, 'no buffers captured');
  if (patWav) {
    const runs = await withFakeMic(patWav.file, async (b) => {
      const c = await newContext(b, srv.origin, { permissions: ['microphone'] });
      const r = await c.newPage();
      await r.goto(`${srv.origin}/range/`); await r.fill('#sent', '3'); await r.click('#listen');
      await r.waitForTimeout(patWav.seconds * 1000 + 2500);
      return r.innerText('#runs');
    });
    C.ok(`loopback: console test pattern (3 x FAST, captured ${patWav.count} buffers) counted 3/3 on range page`, /3\/3/.test(runs), runs.replace(/\s+/g, ' '));
  } else C.ok('captured console test pattern audio', false);
} finally {
  await browser.close();
  srv.stop();
  C.done();
}
