// Shared helpers for the track-C browser audit (scripts/audit-c-*.mjs). Not a test itself.
// Never edits app files: keys.js / config.js are replaced in the browser with page routes,
// and the throwaway audit keypair lives only in memory for one run.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

export const ROOT = new URL('..', import.meta.url).pathname;
export const SCREENS = join(ROOT, 'docs/testing/screens');
export const OUT = process.env.AUDIT_C_OUT || join(tmpdir(), 'audit-c');
mkdirSync(SCREENS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
globalThis.nacl ??= require(ROOT + 'vendor/nacl-fast.min.js');
const nacl = globalThis.nacl;
export const payload = await import(ROOT + 'shared/payload.js');
const keysMod = await import(ROOT + 'shared/keys.js');
export const COMMITTED_KEYS = JSON.parse(JSON.stringify(keysMod.TRUSTED_KEYS));
export const phrasebook = JSON.parse(readFileSync(ROOT + 'shared/phrasebook.json', 'utf8'));
export const zones = JSON.parse(readFileSync(ROOT + 'shared/zones.json', 'utf8'));

export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const PHONE = { viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1280, height: 900 } };

// ---- keys ----
const b64 = (u8) => Buffer.from(u8).toString('base64');
function keypair() { const k = nacl.sign.keyPair(); return { pub: b64(k.publicKey), sec: b64(k.secretKey) }; }
// AUDIT: trusted only inside the test browser via the routed keys.js.
export const AUDIT = keypair();
// AUDIT_VENUE: a throwaway key registered under id "coliseum-ops" so strict-mode policy can be exercised
// (we do not hold the committed venue secret). Documented as such in C-browser.md.
export const AUDIT_VENUE = keypair();
export const UNTRUSTED = keypair();
export function keysJs({ venue = false } = {}) {
  const list = [...COMMITTED_KEYS, { id: 'audit-c', name: 'AUDIT C throwaway key', publicKey: AUDIT.pub }];
  if (venue) list.push({ id: 'coliseum-ops', name: 'AUDIT C throwaway venue key', publicKey: AUDIT_VENUE.pub });
  return `export const TRUSTED_KEYS = ${JSON.stringify(list)};\n`;
}
export function configJs({ help = '', phone = '' } = {}) {
  return `export const RETELL_PHONE = ${JSON.stringify(phone)};\nexport const HELP_ENDPOINT = ${JSON.stringify(help)};\nexport const STRICT_DEMO = new URLSearchParams(globalThis.location?.search || '').has('strict');\n`;
}

export const nowMin = () => Math.floor(Date.now() / 60000);
export function wire(alert, secretB64) {
  const body = payload.packBody({ type: 1, detail: 12, zone: 1, expiresMin: nowMin() + 60, msgId: 1000, ...alert });
  const sig = secretB64 ? nacl.sign.detached(body, Buffer.from(secretB64, 'base64')) : nacl.randomBytes(64);
  return payload.toWire(body, sig);
}

// ---- static server ----
export async function startStatic(port) {
  const p = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(origin + '/index.html'); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return { origin, stop: () => p.kill('SIGTERM'), proc: p };
}

// ---- browser context with routes ----
// opts: keys (bool|'venue'), config ({help, phone} | null = committed file), block external hosts always.
export async function newContext(browser, origin, { keys = true, config = {}, sw = 'block', ...ctxOpts } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: sw, ...ctxOpts });
  const host = new URL(origin).host;
  ctx.blocked = [];
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol.startsWith('http') && u.host !== host && !u.host.startsWith('127.0.0.1:')) { ctx.blocked.push(u.href); return route.abort(); }
    if (keys && u.pathname.endsWith('/shared/keys.js')) return route.fulfill({ contentType: 'text/javascript', body: keysJs({ venue: keys === 'venue' }) });
    if (config && u.pathname.endsWith('/shared/config.js')) return route.fulfill({ contentType: 'text/javascript', body: configJs(config) });
    return route.continue();
  });
  return ctx;
}

// Collect page errors + console errors per page.
export function watch(page) {
  const log = { pageErrors: [], consoleErrors: [], warnings: [] };
  page.on('pageerror', (e) => log.pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') log.consoleErrors.push(m.text());
    if (m.type() === 'warning') log.warnings.push(m.text());
  });
  return log;
}

// Stubs navigator.vibrate (counts calls) and records every AudioBufferSourceNode played.
export const INSTRUMENT = () => {
  window.__vibes = [];
  try {
    Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: function (p) { window.__vibes.push({ t: Date.now(), p }); return true; } });
  } catch {}
  window.__played = []; window.__keep = false; window.__stops = 0;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    try {
      const b = this.buffer;
      window.__played.push({ t: Date.now(), rate: b.sampleRate, len: b.length, data: window.__keep ? Array.from(b.getChannelData(0)) : null });
    } catch {}
    return start.apply(this, a);
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...a) { window.__stops++; return stop.apply(this, a); };
};

// ---- checks ----
export class Checks {
  constructor(name) { this.name = name; this.rows = []; this.t0 = Date.now(); }
  ok(id, cond, detail = '') {
    const pass = Boolean(cond);
    this.rows.push({ id, pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id}${detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : ''}`);
    return pass;
  }
  info(id, detail) { this.rows.push({ id, pass: null, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); console.log(`INFO ${id} :: ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)}`); }
  done(extra = {}) {
    const fail = this.rows.filter((r) => r.pass === false).length, pass = this.rows.filter((r) => r.pass === true).length;
    console.log(`\n${this.name}: ${pass} PASS, ${fail} FAIL (${((Date.now() - this.t0) / 1000).toFixed(0)} s)`);
    writeFileSync(join(OUT, `${this.name}.json`), JSON.stringify({ name: this.name, pass, fail, rows: this.rows, ...extra }, null, 2));
    process.exitCode = fail ? 1 : 0;
  }
}

// ---- audio ----
let ggCache = {};
export async function ggwave(rate = 48000) {
  if (ggCache[rate]) return ggCache[rate];
  const gg = await require(ROOT + 'vendor/ggwave.js')();
  gg.disableLog();
  const p = gg.getDefaultParameters(); p.sampleRateInp = p.sampleRateOut = rate;
  const inst = gg.init(p);
  const enc = (text, proto = 'fast', vol = 25) => {
    const id = gg.ProtocolId[{ fast: 'GGWAVE_PROTOCOL_AUDIBLE_FAST', fastest: 'GGWAVE_PROTOCOL_AUDIBLE_FASTEST', normal: 'GGWAVE_PROTOCOL_AUDIBLE_NORMAL' }[proto]];
    const raw = gg.encode(inst, text, id, vol);
    return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  };
  return (ggCache[rate] = { gg, inst, enc });
}

export function wavBuffer(samples, rate = 48000) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0, o = 44; i < n; i++, o += 2) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), o);
  return buf;
}
export function concat(parts) {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function writeWav(name, samples, rate = 48000) {
  const f = join(OUT, name);
  writeFileSync(f, wavBuffer(samples, rate));
  return f;
}
export const fakeMicArgs = (wav) => ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { existsSync };

// Launch a separate Chromium whose microphone is the given WAV; fn(browser) runs inside.
export async function withFakeMic(wavPath, fn) {
  const b = await chromium.launch({ args: fakeMicArgs(wavPath) });
  try { return await fn(b); } finally { await b.close(); }
}
// Collect buffers played by a page (INSTRUMENT with __keep=true) into one WAV with 1 s gaps.
export async function capturedWav(page, name, { from = 0 } = {}) {
  const bufs = await page.evaluate((t) => window.__played.filter((p) => p.t >= t && p.data).map((p) => ({ rate: p.rate, data: p.data })), from);
  if (!bufs.length) return null;
  const rate = bufs[0].rate, gap = new Float32Array(rate);
  const parts = [gap];
  for (const b of bufs) parts.push(Float32Array.from(b.data), gap);
  const all = concat(parts);
  return { file: writeWav(name, all, rate), seconds: all.length / rate, count: bufs.length, rate };
}
