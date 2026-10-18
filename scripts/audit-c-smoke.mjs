// Track C / scope 1: smoke test. Every page loads with zero page errors / console errors in full
// and ?strict=1 mode, at phone (390x844, iPhone UA) and desktop widths; no horizontal overflow at
// 390 px and 320 px; primary tap targets >= 44x44 px.
//   node scripts/audit-c-smoke.mjs            (starts its own static server on 127.0.0.1:8971)
// Chromium only (Playwright 1.47; WebKit/Firefox browsers are not installed on this machine).
import { chromium } from 'playwright';
import { Checks, startStatic, newContext, watch, PHONE, DESKTOP, AUDIT, wire, SCREENS, INSTRUMENT } from './audit-c-lib.mjs';

const C = new Checks('smoke');
const srv = await startStatic(8971);
const browser = await chromium.launch();
C.info('browser', `Chromium ${browser.version()}`);
const PAGES = ['/index.html', '/receiver/', '/receiver/?strict=1', '/receiver/?kiosk=1', '/receiver/?debug=1', '/console/', '/console/?strict=1', '/range/'];

const overflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const off = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width && getComputedStyle(e).visibility !== 'hidden' && r.right > vw + 1 && !e.closest('.scroll-x') && !e.closest('.sr-only') && !e.closest('dialog:not([open])');
  }).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')} right=${Math.round(e.getBoundingClientRect().right)}`);
  return { sw: document.documentElement.scrollWidth, vw, off };
});

try {
  for (const [label, opts] of [['phone', PHONE], ['desktop', DESKTOP]]) {
    for (const cfg of [{ name: 'routed-config', config: {} }, { name: 'committed-config', config: null }]) {
      const ctx = await newContext(browser, srv.origin, { config: cfg.config, ...opts });
      for (const path of PAGES) {
        const page = await ctx.newPage();
        const log = watch(page);
        await page.goto(srv.origin + path, { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(400);
        // Errors caused only by our blocking of the committed external tunnel are reported separately.
        const ext = log.consoleErrors.filter((e) => /Failed to load resource|ERR_FAILED/.test(e));
        const real = log.consoleErrors.filter((e) => !ext.includes(e));
        const id = `${label} ${cfg.name} ${path}`;
        C.ok(`load no page errors: ${id}`, log.pageErrors.length === 0, log.pageErrors.join(' | '));
        if (cfg.name === 'routed-config') C.ok(`load no console errors: ${id}`, log.consoleErrors.length === 0, log.consoleErrors.join(' | '));
        else { C.ok(`load no app console errors: ${id}`, real.length === 0, real.join(' | ')); if (ext.length) C.info(`external-endpoint errors (blocked by test): ${id}`, ext.length + ' x ' + ext[0]); }
        if (label === 'phone' && cfg.name === 'routed-config') {
          for (const w of [390, 320]) {
            await page.setViewportSize({ width: w, height: 844 });
            await page.waitForTimeout(100);
            const o = await overflow(page);
            C.ok(`no horizontal overflow @${w}px: ${path}`, o.sw <= o.vw && o.off.length === 0, o);
          }
          await page.setViewportSize(PHONE.viewport);
          await page.screenshot({ path: `${SCREENS}/c-smoke-${path.replace(/[^a-z0-9]+/gi, '_')}-390.png` });
        }
        await page.close();
      }
      if (cfg.name === 'committed-config') C.info(`${label} external requests blocked by test (committed config)`, [...new Set(ctx.blocked.map((u) => new URL(u).origin + new URL(u).pathname))]);
      await ctx.close();
    }
  }

  // ---- tap targets at phone width ----
  const ctx = await newContext(browser, srv.origin, { ...PHONE });
  await ctx.addInitScript(INSTRUMENT);
  const size = async (page, sel) => { const b = await page.locator(sel).boundingBox(); return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null; };
  const rx = await ctx.newPage();
  await rx.goto(srv.origin + '/receiver/?debug=1');
  await rx.waitForSelector('#start:has-text("")');
  let s = await size(rx, '#start'); C.ok('tap target >=44 px: receiver Start listening', s && s.w >= 44 && s.h >= 44, s);
  await rx.fill('#paste', wire({ msgId: 4242 }, AUDIT.sec));
  await rx.click('#paste-go');
  await rx.waitForSelector('#silence:not(.hidden)');
  s = await size(rx, '#silence'); C.ok('tap target >=44 px: receiver Silence alarm', s && s.w >= 44 && s.h >= 44, s);
  s = await size(rx, '#help'); C.ok('tap target >=44 px: receiver I need help', s && s.w >= 44 && s.h >= 44, s);
  await rx.screenshot({ path: `${SCREENS}/c-smoke-receiver-verified-390.png` });
  await rx.click('#help');
  s = await size(rx, '#help-send'); C.ok('tap target >=44 px: receiver Send help', s && s.w >= 44 && s.h >= 44, s);
  for (const sel of ['#life', '#vuln', '#lang']) { s = await size(rx, sel); C.info(`receiver control size ${sel}`, s); }
  const lifeLbl = await rx.locator('label.check:has(#life)').boundingBox();
  C.ok('tap target >=44 px: life-threat checkbox incl. label', lifeLbl && lifeLbl.height >= 44, lifeLbl && { w: Math.round(lifeLbl.width), h: Math.round(lifeLbl.height) });
  s = await size(rx, '#lang'); C.ok('tap target >=44 px: receiver language picker', s && s.h >= 44, s);
  const con = await ctx.newPage();
  await con.goto(srv.origin + '/console/');
  await con.fill('#secret', AUDIT.sec);
  s = await size(con, '#send'); C.ok('tap target >=44 px: console Review & broadcast', s && s.w >= 44 && s.h >= 44, s);
  await con.click('#send');
  await con.waitForSelector('#review[open]');
  s = await size(con, '#review-approve'); C.ok('tap target >=44 px: console Approve & broadcast', s && s.w >= 44 && s.h >= 44, s);
  s = await size(con, '#review-cancel'); C.ok('tap target >=44 px: console Cancel', s && s.w >= 44 && s.h >= 44, s);
  await con.screenshot({ path: `${SCREENS}/c-smoke-console-review-390.png` });
  await con.click('#review-cancel');
  await ctx.close();
} finally {
  await browser.close();
  srv.stop();
  C.done();
}
