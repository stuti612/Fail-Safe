// Track C / scopes 2 + 6: receiver through the REAL browser decode path (getUserMedia ->
// ScriptProcessor -> ggwave wasm -> verify -> render), fed by Chromium's fake microphone with WAVs
// generated here (Node + vendor/ggwave.js, signed with a throwaway audit key trusted via a routed
// keys.js). DIGITAL loopback, not acoustic: no speaker, room, mic or AGC is involved.
//   node scripts/audit-c-audio.mjs                 full SNR matrix + behaviour WAVs, sequential (~12 min)
//   AUDIT_C_PAR=2 ...                               run 2 browsers at a time (only on an idle host)
//   AUDIT_C_QUICK=1 node scripts/audit-c-audio.mjs  fewer conditions
// Static server on 127.0.0.1:8973. WAVs are written to $AUDIT_C_OUT (default $TMPDIR/audit-c).
import { chromium } from 'playwright';
import { Checks, startStatic, newContext, AUDIT, UNTRUSTED, wire, nowMin, ggwave, concat, writeWav, fakeMicArgs, INSTRUMENT, sleep, OUT } from './audit-c-lib.mjs';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const C = new Checks('audio');
const RATE = 48000;
const srv = await startStatic(8973);
const { enc } = await ggwave(RATE);
const silence = (s) => new Float32Array(Math.round(s * RATE));

// Deterministic PRNG + Gaussian white noise; pink via Paul Kellet's filter. Both normalised to RMS 1.
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function noise(n, kind, seed) {
  const r = rng(seed), out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
    if (kind === 'white') out[i] = w;
    else {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
  }
  const rms = Math.sqrt(out.reduce((a, x) => a + x * x, 0) / n);
  for (let i = 0; i < n; i++) out[i] /= rms;
  return out;
}

// Builds a WAV of `wires` chirps with 1 s gaps; returns path + metadata.
function build(name, wires, { proto = 'fast', snr = null, kind = 'white', gain = 1, seed = 1 } = {}) {
  const parts = [silence(1)], mask = [];
  for (const w of wires) { const s = enc(w, proto, 25); parts.push(s, silence(1)); }
  parts.push(silence(1.5));
  const sig = concat(parts);
  let p2 = 0, cnt = 0, peak0 = 0;
  for (const x of sig) { if (x !== 0) { p2 += x * x; cnt++; } peak0 = Math.max(peak0, Math.abs(x)); }
  const sigRms = Math.sqrt(p2 / cnt);
  for (let i = 0; i < sig.length; i++) sig[i] *= gain;
  if (snr !== null) {
    const nz = noise(sig.length, kind, seed), k = (sigRms * gain) / 10 ** (snr / 20);
    for (let i = 0; i < sig.length; i++) sig[i] += nz[i] * k;
  }
  let peak = 0; for (const x of sig) peak = Math.max(peak, Math.abs(x));
  const scale = peak > 0.98 ? 0.98 / peak : 1;
  if (scale !== 1) for (let i = 0; i < sig.length; i++) sig[i] *= scale;
  return { file: writeWav(`${name}.wav`, sig, RATE), seconds: sig.length / RATE, sigRmsDbfs: 20 * Math.log10(sigRms * gain * scale), peakDbfs: 20 * Math.log10(peak * scale), clean_peak: peak0 };
}

// Launch Chromium with the WAV as microphone, open the receiver, tap Start, wait for the file.
async function runReceiver(wav, { query = '', afterStart } = {}) {
  const browser = await chromium.launch({ args: fakeMicArgs(wav.file) });
  try {
    const ctx = await newContext(browser, srv.origin, { permissions: ['microphone'], viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(INSTRUMENT);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${srv.origin}/receiver/${query}`);
    await page.waitForFunction(() => document.getElementById('start').textContent.length > 0);
    await page.click('#start');
    await page.waitForSelector('#listening:not(.hidden)');
    const t0 = Date.now();
    const extra = afterStart ? await afterStart(page, t0) : null;
    const remaining = wav.seconds * 1000 + 2500 - (Date.now() - t0);
    if (remaining > 0) await sleep(remaining);
    const res = await page.evaluate(() => ({
      history: JSON.parse(localStorage.getItem('chirp.history') || '[]').map((h) => ({ msgId: h.alert.msgId, type: h.alert.type, signed: Boolean(h.sender), late: !!h.late })),
      vibes: window.__vibes.length,
      played: window.__played.map((p) => ({ t: p.t, sec: p.len / p.rate })),
      stops: window.__stops,
      silenceVisible: !document.getElementById('silence').classList.contains('hidden'),
      current: document.querySelector('#current .alert')?.className || '',
    }));
    return { ...res, errs, extra, t0 };
  } finally {
    await browser.close();
  }
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

try {
  // ---------------- SNR / amplitude matrix ----------------
  // Run SEQUENTIALLY by default: the fake mic is real-time paced, and under host CPU load the
  // renderer drops ScriptProcessor frames (4 parallel browsers on a loaded host decoded 0-3/5 even
  // for clean audio). Cells with misses are re-run once; both results are reported.
  const QUICK = !!process.env.AUDIT_C_QUICK;
  const PAR = Number(process.env.AUDIT_C_PAR || 1);
  const N = 4;
  const conds = [];
  for (const proto of ['fast', 'fastest']) {
    conds.push({ proto, label: 'clean', snr: null });
    for (const snr of QUICK ? [0] : [10, 0, -6, -9, -12]) conds.push({ proto, label: `white ${snr} dB`, kind: 'white', snr });
    for (const snr of QUICK ? [] : [0, -6]) conds.push({ proto, label: `pink ${snr} dB`, kind: 'pink', snr });
    for (const db of QUICK ? [-60] : [-40, -60]) conds.push({ proto, label: `clean, gain ${db} dB`, gain: 10 ** (db / 20), snr: null });
  }
  let id = 1;
  const jobs = conds.map((c, k) => {
    const ids = Array.from({ length: N }, () => 2000 + id++);
    const wires = ids.map((msgId) => wire({ type: 3, detail: 8, zone: 21, msgId, expiresMin: nowMin() + 60 }, AUDIT.sec));
    return { ...c, ids, wav: build(`snr-${k}-${c.proto}-${c.label.replace(/\W+/g, '_')}`, wires, { proto: c.proto, snr: c.snr, kind: c.kind, gain: c.gain ?? 1, seed: k + 7 }) };
  });
  const load0 = loadavg()[0].toFixed(1);
  console.log(`matrix: ${jobs.length} WAVs, ${jobs.reduce((a, j) => a + j.wav.seconds, 0).toFixed(0)} s of audio, ${PAR} at a time, host load ${load0}`);
  const decodeOnce = async (j) => {
    const r = await runReceiver(j.wav);
    return { got: j.ids.map((m) => (r.history.some((h) => h.signed && h.msgId === m) ? 1 : 0)).join(''), errors: r.errs.length, stray: r.history.filter((h) => !j.ids.includes(h.msgId)).length };
  };
  const results = await pool(jobs, PAR, async (j) => {
    const a = await decodeOnce(j);
    const b = a.got.includes('0') ? await decodeOnce(j) : null;
    const n = (g) => [...g].filter((x) => x === '1').length;
    const row = { proto: j.proto, condition: j.label, run1: `${n(a.got)}/${N} (${a.got})`, run2: b ? `${n(b.got)}/${N} (${b.got})` : '', best: Math.max(n(a.got), b ? n(b.got) : 0), sent: N, sigRmsDbfs: +j.wav.sigRmsDbfs.toFixed(1), peakDbfs: +j.wav.peakDbfs.toFixed(1), errors: a.errors + (b?.errors || 0), stray: a.stray + (b?.stray || 0), load: loadavg()[0].toFixed(1) };
    console.log(`  ${j.proto.padEnd(7)} ${j.label.padEnd(20)} ${row.run1}${b ? '  retry ' + row.run2 : ''}  (signal RMS ${row.sigRmsDbfs} dBFS, load ${row.load})`);
    return row;
  });
  writeFileSync(`${OUT}/audio-matrix.json`, JSON.stringify(results, null, 2));
  for (const r of results) {
    const txt = `${r.run1}${r.run2 ? ' / retry ' + r.run2 : ''}`;
    if (r.condition === 'clean' || /white 10/.test(r.condition)) C.ok(`${r.proto} ${r.condition}: ${N}/${N} decoded through browser path (best of 2 runs)`, r.best === N, txt);
    else C.info(`${r.proto} ${r.condition}`, txt);
    if (r.errors) C.ok(`${r.proto} ${r.condition}: no page errors`, false, r.errors);
  }
  C.ok('no garbled/false alerts rendered under any noise condition', results.every((r) => r.stray === 0), results.filter((r) => r.stray).map((r) => r.condition));

  // ---------------- behaviour via audio ----------------
  const spoof = wire({ type: 1, detail: 12, zone: 1, msgId: 3001 }, null);
  const untrusted = wire({ type: 1, detail: 12, zone: 1, msgId: 3002 }, UNTRUSTED.sec);
  const expired = wire({ type: 1, detail: 12, zone: 1, msgId: 3003, expiresMin: nowMin() - 10 }, AUDIT.sec);
  const tooLong = wire({ type: 1, detail: 12, zone: 1, msgId: 3004, expiresMin: nowMin() + 13 * 60 }, AUDIT.sec);
  const b1 = build('behave-spoof-expired', [spoof, spoof, untrusted, untrusted, expired, expired, tooLong, tooLong], { proto: 'fastest' });
  const A = wire({ type: 1, detail: 12, zone: 1, msgId: 3010 }, AUDIT.sec);
  const Areplay = wire({ type: 11, detail: 0, zone: 1, msgId: 3010 }, AUDIT.sec);
  const b2 = build('behave-verified-dup-replay', [A, A, Areplay], { proto: 'fastest' });
  const b3 = build('behave-silence', [wire({ type: 3, detail: 8, zone: 21, msgId: 3020 }, AUDIT.sec)], { proto: 'fastest' });

  const silenceRun = () => runReceiver(b3, {
    afterStart: async (page) => {
      await page.waitForSelector('#silence:not(.hidden)', { timeout: 20000 });
      await sleep(3000);
      const t = await page.evaluate(() => { document.getElementById('silence').click(); return Date.now(); });
      return { silencedAt: t };
    },
  });
  // b2 keeps listening past the 30 s ring cap.
  const tasks = [() => runReceiver(b1), () => runReceiver({ ...b2, seconds: Math.max(b2.seconds, 46) }), silenceRun];
  const [r1, r2, r3] = await pool([0, 1, 2], PAR, (i) => tasks[i]());
  const byId = (r, m) => r.history.find((h) => h.msgId === m);
  C.ok('audio: unsigned spoof decoded and shown UNVERIFIED', byId(r1, 3001) && !byId(r1, 3001).signed, byId(r1, 3001));
  C.ok('audio: untrusted-key alert shown UNVERIFIED', byId(r1, 3002) && !byId(r1, 3002).signed, byId(r1, 3002));
  C.ok('audio: expired signed alert shown as expired (late)', byId(r1, 3003)?.late === true, byId(r1, 3003));
  C.ok('audio: >12 h validity alert rejected', !byId(r1, 3004), byId(r1, 3004));
  C.ok('audio: spoof/untrusted/expired never vibrate or ring', r1.vibes === 0 && r1.played.length === 0, { vibes: r1.vibes, ringBuffers: r1.played.length });
  C.ok('audio: verified alert shown once despite repeat', r2.history.filter((h) => h.msgId === 3010).length === 1 && byId(r2, 3010)?.type === 1, r2.history);
  C.ok('audio: replay with same signer+msgId, different body ignored', !r2.history.some((h) => h.type === 11), r2.history);
  const rings = r2.played.filter((p) => p.sec > 2 && p.sec < 3);
  C.ok('audio: verified alert rings (ringtone buffers ~2.4 s played) and vibrates', rings.length >= 2 && r2.vibes >= 2, { rings: rings.length, vibes: r2.vibes });
  const span = rings.length ? (rings.at(-1).t + rings.at(-1).sec * 1000 - rings[0].t) / 1000 : 0;
  C.ok('audio: phone ring stops at ~30 s cap while listening (<= 33 s, Silence hidden)', span <= 33 && span >= 27 && !r2.silenceVisible, { ringSeconds: +span.toFixed(1), cycles: rings.length });
  const s3 = r3.extra?.silencedAt;
  const lastRing = r3.played.filter((p) => p.sec > 2 && p.sec < 3).at(-1);
  const tail = lastRing ? (lastRing.t + lastRing.sec * 1000 - s3) / 1000 : 0;
  C.ok('audio: Silence stops the ringtone immediately (< 0.3 s of ring after tap)', tail < 0.3, { ringContinuesSeconds: +tail.toFixed(2), sourceStopCalls: r3.stops });
  C.ok('audio: no page errors in behaviour runs', [r1, r2, r3].every((r) => r.errs.length === 0), [r1.errs, r2.errs, r3.errs]);
} finally {
  srv.stop();
  C.done();
}
