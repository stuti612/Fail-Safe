// Track C / scope 4: accessibility without new dependencies. An injected checker reports
// (a) buttons/links without an accessible name, nested interactive elements,
// (b) form controls without a label, (c) WCAG AA text contrast (4.5:1, 3:1 for large text) from
// computed styles, light and dark scheme, (d) #announce live-region content on a new alert,
// (e) keyboard focus order + operability of the help form, (f) document structure basics.
// Contrast is approximate: solid background found by walking ancestors, element/ancestor opacity
// folded into text alpha; background images/gradients are not modelled.
//   node scripts/audit-c-a11y.mjs              (static server on 127.0.0.1:8975)
import { chromium } from 'playwright';
import { Checks, startStatic, newContext, PHONE, AUDIT, wire, nowMin, INSTRUMENT, SCREENS } from './audit-c-lib.mjs';

const C = new Checks('a11y');
const srv = await startStatic(8975);
const browser = await chromium.launch();

const AUDITOR = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('.hidden, dialog:not([open])'); };
  const name = (el) => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(' ').map((i) => document.getElementById(i)?.textContent || '').join(' ') || el.textContent || el.title || el.querySelector('img')?.alt || '').trim();
  const out = { names: [], nested: [], labels: [], contrast: [], structure: [] };
  const sel = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
  for (const el of document.querySelectorAll('button, a[href], a, [role=button]')) {
    if (!visible(el)) continue;
    if (!name(el)) out.names.push(sel(el));
    if (el.matches('a') && el.querySelector('button, input, select, a')) out.nested.push(`${sel(el)} contains ${sel(el.querySelector('button, input, select, a'))}`);
  }
  for (const img of document.querySelectorAll('img, svg')) if (visible(img) && !img.closest('[aria-hidden=true]') && !(img.alt || img.getAttribute('aria-label'))) out.names.push(sel(img));
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (!visible(el)) continue;
    const lbl = [...(el.labels || [])].map((l) => l.textContent.trim()).join(' ') || el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent);
    if (!lbl || !lbl.trim()) out.labels.push(sel(el));
  }
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || !visible(el) || el.closest('.sr-only, option, #flash') || el.disabled || el.closest('button:disabled')) continue;
    const cs = getComputedStyle(el);
    let fg = parse(cs.color); let alpha = fg[3];
    let bg = null, node = el;
    while (node && node.nodeType === 1) {
      const s = getComputedStyle(node);
      alpha *= Number(s.opacity);
      const b = parse(s.backgroundColor);
      if (b[3] > 0) { bg = bg ? blend(bg, b) : b; if (b[3] >= 1) break; }
      node = node.parentElement;
    }
    if (!bg || bg[3] < 1) bg = blend(bg || [0, 0, 0, 0], parse(getComputedStyle(document.body).backgroundColor)[3] ? parse(getComputedStyle(document.body).backgroundColor) : [255, 255, 255, 1]);
    const eff = blend([fg[0], fg[1], fg[2], alpha], bg);
    const L1 = lum(eff), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const large = px >= 24 || (bold && px >= 18.66);
    const need = large ? 3 : 4.5;
    if (ratio < need) out.contrast.push(`${sel(el)} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}:1 < ${need} (fg rgb(${eff.slice(0, 3).map(Math.round)}) bg rgb(${bg.slice(0, 3).map(Math.round)}), ${px}px${bold ? ' bold' : ''})`);
  }
  if (!document.querySelector('h1')) out.structure.push('no <h1>');
  if (!document.documentElement.lang) out.structure.push('no html lang');
  if (!document.title) out.structure.push('no <title>');
  return out;
};

async function audit(page, label) {
  const r = await page.evaluate(AUDITOR);
  C.ok(`${label}: all buttons/links/images have accessible names`, r.names.length === 0, r.names.join(' | '));
  C.ok(`${label}: no nested interactive elements`, r.nested.length === 0, r.nested.join(' | '));
  C.ok(`${label}: all form controls labelled`, r.labels.length === 0, r.labels.join(' | '));
  C.ok(`${label}: text contrast >= WCAG AA`, r.contrast.length === 0, [...new Set(r.contrast)].join(' | '));
  if (r.structure.length) C.info(`${label}: structure`, r.structure.join(', '));
}

const paste = async (p, w) => { await p.fill('#paste', w); await p.click('#paste-go'); await p.waitForTimeout(120); };
try {
  for (const scheme of ['light', 'dark']) {
    const ctx = await newContext(browser, srv.origin, { ...PHONE, colorScheme: scheme });
    await ctx.addInitScript(INSTRUMENT);
    const p = await ctx.newPage();
    await p.goto(`${srv.origin}/receiver/?debug=1`);
    await p.waitForFunction(() => document.getElementById('start').textContent.length > 0);
    await audit(p, `${scheme} receiver idle`);
    await paste(p, wire({ msgId: 1, type: 4, detail: 7, zone: 21, expiresMin: nowMin() - 3 }, AUDIT.sec)); // expired (history)
    await paste(p, wire({ msgId: 2, type: 9, detail: 8, zone: 21 }, AUDIT.sec)); // moderate
    await paste(p, wire({ msgId: 3, type: 11, detail: 0, zone: 21 }, AUDIT.sec)); // info
    await paste(p, wire({ msgId: 4, type: 2, detail: 12, zone: 21 }, AUDIT.sec)); // severe
    await paste(p, wire({ msgId: 5, type: 1, detail: 12, zone: 21 }, null)); // unverified
    await audit(p, `${scheme} receiver unverified card + history (expired/moderate/info/severe compact)`);
    for (const [m, t, label] of [[6, 1, 'extreme'], [7, 2, 'severe'], [8, 9, 'moderate'], [9, 11, 'info']]) {
      await paste(p, wire({ msgId: m, type: t, detail: 12, zone: 21 }, AUDIT.sec));
      await p.click('#silence').catch(() => {});
      await audit(p, `${scheme} receiver ${label} card`);
    }
    await paste(p, wire({ msgId: 10, type: 1, detail: 12, zone: 21, expiresMin: nowMin() - 1 }, AUDIT.sec));
    await audit(p, `${scheme} receiver expired card`);
    await p.click('#help'); await p.check('#life');
    await audit(p, `${scheme} receiver help form + 911 line`);
    if (scheme === 'dark') await p.screenshot({ path: `${SCREENS}/c-a11y-dark-receiver.png`, fullPage: false });
    const con = await ctx.newPage();
    await con.goto(`${srv.origin}/console/`);
    await con.fill('#secret', AUDIT.sec);
    await con.selectOption('#cap-sample', '2-smoke-multi-area');
    await con.waitForTimeout(400);
    await audit(con, `${scheme} console (CAP loaded)`);
    await con.click('#send'); await con.waitForSelector('#review[open]');
    await audit(con, `${scheme} console review dialog`);
    const focusInDialog = await con.evaluate(() => document.activeElement?.closest('dialog')?.id);
    C.ok(`${scheme} console review dialog takes focus`, focusInDialog === 'review', focusInDialog);
    await con.keyboard.press('Escape');
    C.ok(`${scheme} Escape closes review without sending`, !(await con.isVisible('#review')) && /Cancelled|Nothing sent/.test(await con.textContent('#status')), await con.textContent('#status'));
    const rg = await ctx.newPage();
    await rg.goto(`${srv.origin}/range/`);
    await audit(rg, `${scheme} range`);
    const ix = await ctx.newPage();
    await ix.goto(`${srv.origin}/index.html`);
    await audit(ix, `${scheme} index`);
    await ctx.close();
  }

  // ---- live region + keyboard ----
  const ctx = await newContext(browser, srv.origin, { ...PHONE });
  await ctx.addInitScript(INSTRUMENT);
  const p = await ctx.newPage();
  await p.goto(`${srv.origin}/receiver/?debug=1`);
  await p.waitForFunction(() => document.getElementById('start').textContent.length > 0);
  const live = await p.$eval('#announce', (e) => ({ role: e.getAttribute('role'), live: e.getAttribute('aria-live'), atomic: e.getAttribute('aria-atomic') }));
  C.ok('#announce is an assertive live region', live.role === 'alert' && live.live === 'assertive', live);
  await p.evaluate(() => { window.__ann = []; new MutationObserver(() => window.__ann.push(document.getElementById('announce').textContent)).observe(document.getElementById('announce'), { childList: true, characterData: true, subtree: true }); });
  await paste(p, wire({ msgId: 50, type: 1, detail: 12, zone: 1 }, AUDIT.sec));
  await p.waitForTimeout(300);
  const ann = await p.textContent('#announce');
  C.ok('new verified alert announced in #announce (badge, zone, title, detail)', /Demo signature/.test(ann) && /EVACUATE NOW/.test(ann) && /Altadena/.test(ann), ann);
  await p.click('#silence');
  await paste(p, wire({ msgId: 51, type: 1, detail: 12, zone: 1 }, null));
  await p.waitForTimeout(300);
  const ann2 = await p.textContent('#announce');
  C.ok('unverified alert announced as UNVERIFIED', /UNVERIFIED/.test(ann2), ann2);
  await p.selectOption('#lang', 'es');
  await p.waitForTimeout(200);
  C.ok('language change re-renders but does not re-announce', (await p.textContent('#announce')) === ann2, await p.textContent('#announce'));

  // keyboard: focus order through the receiver with an alert shown and help form open
  await p.selectOption('#lang', 'en');
  await p.evaluate(() => document.activeElement.blur());
  await p.focus('#help');
  await p.keyboard.press('Enter');
  C.ok('keyboard: Enter on "I need help" opens the form', await p.isVisible('#help-form'));
  const order = [];
  for (let i = 0; i < 8; i++) { await p.keyboard.press('Tab'); order.push(await p.evaluate(() => document.activeElement.id || document.activeElement.tagName)); }
  C.info('keyboard: Tab order after "I need help"', order.join(' -> '));
  const want = ['call', 'need', 'people', 'life', 'vuln', 'help-send'];
  const idx = want.filter((w) => order.includes(w)).map((w) => order.indexOf(w));
  C.ok('keyboard: help form controls reachable in visual order (need, people, life, vuln, send)', ['need', 'people', 'life', 'vuln', 'help-send'].every((w) => order.includes(w)) && idx.every((v, i) => i === 0 || v > idx[i - 1]), order);
  C.ok('keyboard: Call-for-help link is a single tab stop (no <a><button> double stop)', order.filter((x) => x === 'call' || x === 'BUTTON').length <= 1, order);
  await p.focus('#life');
  await p.keyboard.press('Space');
  C.ok('keyboard: Space on life-threat checkbox shows the 911 line', await p.isVisible('#call911'));
  const focusStyle = await p.evaluate(() => { const e = document.getElementById('help-send'); e.focus(); const cs = getComputedStyle(e); return cs.outlineStyle + ' ' + cs.outlineWidth; });
  C.info('focus indicator on Send help (keyboard focus via .focus())', focusStyle);
  await ctx.close();
  // committed config shows the Call button: audit it as shipped
  const cc = await newContext(browser, srv.origin, { ...PHONE, config: { phone: '+12135550100' } });
  const q = await cc.newPage();
  await q.goto(`${srv.origin}/receiver/`);
  await q.waitForTimeout(300);
  await audit(q, 'receiver with RETELL_PHONE set (Call button visible)');
  await cc.close();
} finally {
  await browser.close();
  srv.stop();
  C.done();
}
