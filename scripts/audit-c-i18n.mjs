// Track C / scope 3: every phrasebook language in the receiver. Selects the language, renders a
// verified alert and the help form, checks <html lang>, finds English text left in non-English UI
// (diff against the English run), text clipping and 320 px overflow, and builds a screenshot grid.
// Also a static phrasebook completeness scan (missing keys -> English fallback at runtime).
//   node scripts/audit-c-i18n.mjs              (static server on 127.0.0.1:8974)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { Checks, startStatic, newContext, watch, PHONE, AUDIT, wire, SCREENS, INSTRUMENT, phrasebook } from './audit-c-lib.mjs';

const C = new Checks('i18n');
const LANGS = Object.keys(phrasebook.languages);
C.info('languages in phrasebook', LANGS.join(', '));

// ---- static completeness ----
const missing = [];
for (const sec of ['types', 'details']) for (const [k, v] of Object.entries(phrasebook[sec])) for (const l of LANGS) if (!(l in v.text)) missing.push(`${sec}.${k}(${v.key}).${l}`);
for (const [k, v] of Object.entries(phrasebook.ui)) for (const l of LANGS) if (!(l in v)) missing.push(`ui.${k}.${l}`);
C.ok('phrasebook: every type/detail/ui key has every language', missing.length === 0, missing.join(', '));
const sameAsEn = [];
for (const [k, v] of Object.entries(phrasebook.ui)) for (const l of LANGS) if (l !== 'en' && v[l] && v[l] === v.en) sameAsEn.push(`ui.${k}.${l}`);
for (const sec of ['types', 'details']) for (const [k, v] of Object.entries(phrasebook[sec])) for (const l of LANGS) if (l !== 'en' && v.text[l] && v.text[l] === v.text.en && v.text.en) sameAsEn.push(`${sec}.${k}.${l}`);
C.info('phrasebook strings identical to English (may be untranslated)', sameAsEn.join(', ') || 'none');
C.info('reviewed flags', Object.entries(phrasebook.languages).map(([c, l]) => `${c}:${l.reviewed}`).join(' '));
const rtl = LANGS.filter((l) => ['ar', 'he', 'fa', 'ur'].includes(l));
C.info('RTL', rtl.length ? `RTL languages present: ${rtl}` : 'No RTL language in phrasebook; receiver never sets dir= (grep: no "dir" handling in receiver/app.js). Adding Arabic/Farsi later would render LTR.');
const rxSrc = readFileSync(new URL('../receiver/app.js', import.meta.url), 'utf8');
C.info('receiver sets dir attribute', /\.dir\s*=|setAttribute\('dir'/.test(rxSrc) ? 'yes' : 'no');

const srv = await startStatic(8974);
const browser = await chromium.launch();
const leafTexts = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('#debug, .sr-only, script, style, option, select')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    out.push({ sel: el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ').filter(Boolean).join('.') : el.tagName.toLowerCase(), text: own });
  }
  return out;
});
const clipped = (page) => page.evaluate(() => [...document.querySelectorAll('button, .badge, .title, .detail, .zone, .meta, .warn, label, select, .pill, h2')].filter((e) => {
  const r = e.getBoundingClientRect(); if (!r.width) return false;
  const cs = getComputedStyle(e);
  return (e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== 'visible') || r.right > document.documentElement.clientWidth + 1;
}).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')}: "${e.textContent.trim().slice(0, 40)}"`));

const shots = [];
let enTexts = null;
try {
  const ctx = await newContext(browser, srv.origin, { ...PHONE });
  await ctx.addInitScript(INSTRUMENT);
  for (const lang of LANGS) {
    const page = await ctx.newPage();
    const log = watch(page);
    await page.goto(`${srv.origin}/receiver/?debug=1`);
    await page.waitForFunction(() => document.getElementById('start').textContent.length > 0);
    await page.selectOption('#lang', lang);
    await page.fill('#paste', wire({ msgId: 500 + LANGS.indexOf(lang), type: 1, detail: 12, zone: 1 }, AUDIT.sec));
    await page.click('#paste-go');
    await page.fill('#paste', wire({ msgId: 600 + LANGS.indexOf(lang), type: 2, detail: 5, zone: 3 }, null));
    await page.click('#paste-go');
    await page.waitForTimeout(150);
    C.ok(`${lang}: <html lang> = ${lang}`, (await page.getAttribute('html', 'lang')) === lang, await page.getAttribute('html', 'lang'));
    C.ok(`${lang}: #announce lang = ${lang}`, (await page.getAttribute('#announce', 'lang')) === lang);
    const a = await page.screenshot();
    const textsAlarm = await leafTexts(page);
    await page.click('#silence').catch(() => {});
    await page.click('#help');
    await page.check('#life');
    await page.locator('#help-send').scrollIntoViewIfNeeded();
    const b = await page.screenshot();
    shots.push({ lang, a, b });
    const texts = [...textsAlarm, ...(await leafTexts(page))];
    if (lang === 'en') enTexts = texts;
    else {
      const enSet = new Set(enTexts.map((t) => t.text));
      const leftovers = texts.filter((t) => enSet.has(t.text) && !/^(CHIRP|\d+)$/.test(t.text) && !t.sel.includes('zone'));
      const uniq = [...new Map(leftovers.map((t) => [t.text, `${t.sel}: "${t.text.slice(0, 60)}"`])).values()];
      C.ok(`${lang}: no English text left in localized receiver UI`, uniq.length === 0, uniq.join(' | '));
    }
    // Demo scenario detail (code 13) rendered in this language.
    await page.fill('#paste', wire({ msgId: 700 + LANGS.indexOf(lang), type: 12, detail: 13, zone: 10 }, AUDIT.sec));
    await page.click('#paste-go');
    const det = await page.textContent('#current .detail');
    if (lang !== 'en') C.ok(`${lang}: detail 13 (DEMO_GATE_SCENARIO) is translated`, det !== phrasebook.details[13].text.en, det);
    await page.click('#silence').catch(() => {});
    const clip = await clipped(page);
    C.ok(`${lang}: no clipped/overflowing text at 390 px`, clip.length === 0, clip.join(' | '));
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(80);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    C.ok(`${lang}: no horizontal overflow at 320 px (alert + help form open)`, sw[0] <= sw[1], sw);
    C.ok(`${lang}: no page errors`, log.pageErrors.length === 0, log.pageErrors);
    if (lang === 'hy') await page.screenshot({ path: `${SCREENS}/c-i18n-hy-320.png` });
    await page.close();
  }

  // Kiosk stacked languages carry their own lang attribute.
  const k = await ctx.newPage();
  await k.goto(`${srv.origin}/receiver/?debug=1&kiosk=1&langs=en,es,zh,ko,hy`);
  await k.waitForFunction(() => document.getElementById('start').textContent.length > 0);
  await k.selectOption('#lang', 'en');
  await k.fill('#paste', wire({ msgId: 777 }, AUDIT.sec));
  await k.click('#paste-go');
  const trs = await k.$$eval('#current .tr', (els) => els.map((e) => e.lang));
  C.ok('kiosk: stacked translations tagged with lang (es, zh, ko, hy)', trs.join(',') === 'es,zh,ko,hy', trs);
  await k.setViewportSize({ width: 1280, height: 800 });
  await k.screenshot({ path: `${SCREENS}/c-i18n-kiosk.png` });
  await ctx.close();

  // ---- grid ----
  const g = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const tile = (buf, cap) => `<figure><img src="data:image/png;base64,${buf.toString('base64')}"><figcaption>${cap}</figcaption></figure>`;
  await g.setContent(`<style>body{margin:0;background:#222;color:#fff;font:12px system-ui;display:grid;grid-template-columns:repeat(10,1fr);gap:4px;padding:4px}figure{margin:0}img{width:100%;display:block}figcaption{text-align:center}</style>
    ${shots.map((s) => tile(s.a, s.lang + ' alert')).join('')}${shots.map((s) => tile(s.b, s.lang + ' help')).join('')}`);
  await g.waitForTimeout(300);
  await g.screenshot({ path: `${SCREENS}/c-i18n-grid.png`, fullPage: true });
} finally {
  await browser.close();
  srv.stop();
  C.done();
}
