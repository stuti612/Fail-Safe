// Audit track A, item 9: real ggwave (vendor/ggwave.js) channel tests in Node.
// Imported by audit-a-protocol.mjs; can also run alone:
//   node scripts/audit-a-audio.mjs           (N=5 trials per cell)
//   AUDIT_AUDIO_N=10 node scripts/audit-a-audio.mjs
//
// ONE ggwave tx instance for all encodes; every decode uses a fresh rx instance
// that is freed right after (CLAUDE.md instance-limit gotcha).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.nacl ??= require('../vendor/nacl-fast.min.js');
const ggwaveFactory = require('../vendor/ggwave.js');

const SR = 48000;

// Seeded PRNG + Gaussian, so every run is reproducible from AUDIT_SEED.
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => {
  let u = 0; while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};

export async function runAudio({ check, info, wire, receiveChirp, nowMin, seed = 1, N = 5, log = console.log }) {
  // Silence the "n = ..., nActual = ..." prints the wasm emits on stdout/stderr.
  const gg = await ggwaveFactory({ print: () => {}, printErr: () => {} });
  gg.disableLog();
  const params = gg.getDefaultParameters();
  params.sampleRateInp = params.sampleRateOut = SR;
  const tx = gg.init(params);
  let liveRx = 0, maxLiveRx = 0;

  const encode = (text, proto) => {
    const raw = gg.encode(tx, text, gg.ProtocolId[`GGWAVE_PROTOCOL_${proto}`], 25);
    return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  };
  // Returns every text the decoder emitted.
  const decode = (samples, chunkBytes = 4096, rxParams = params) => {
    const rx = gg.init(rxParams); liveRx++; maxLiveRx = Math.max(maxLiveRx, liveRx);
    const bytes = new Int8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    const out = [];
    try {
      for (let i = 0; i < bytes.length; i += chunkBytes) {
        const r = gg.decode(rx, bytes.slice(i, i + chunkBytes));
        if (r && r.length) out.push(Buffer.from(r).toString('utf8'));
      }
    } finally { gg.free(rx); liveRx--; }
    return out;
  };
  const resample = (x, ratio) => { // ratio = outRate / inRate, linear interpolation
    const out = new Float32Array(Math.floor(x.length * ratio));
    for (let i = 0; i < out.length; i++) { const t = i / ratio, k = Math.floor(t), f = t - k; out[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? 0) * f; }
    return out;
  };
  const rms = (x) => { let s = 0, n = 0; for (const v of x) { if (v !== 0) { s += v * v; n++; } } return Math.sqrt(s / Math.max(1, n)); };
  const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  // Pads with silence (lead + offset, 0.5 s tail) then adds white noise at snrDb over the WHOLE buffer.
  const channel = (sig, { snrDb = Infinity, gain = 1, clip = false, leadSamples = SR / 2, rnd }) => {
    const out = new Float32Array(leadSamples + sig.length + SR / 2);
    const sigRms = rms(sig) * gain;
    const sigma = Number.isFinite(snrDb) ? sigRms / Math.pow(10, snrDb / 20) : 0;
    for (let i = 0; i < out.length; i++) {
      const j = i - leadSamples;
      let v = (j >= 0 && j < sig.length ? sig[j] * gain : 0) + (sigma ? sigma * gauss(rnd) : 0);
      if (clip) v = Math.max(-1, Math.min(1, v));
      out[i] = v;
    }
    return out;
  };

  const results = { snr: {}, amp: {}, chunk: {}, durations: {}, peaks: {}, garbageAccepted: 0, garbageSeen: 0 };
  const noteOutputs = (outs) => {
    for (const o of outs) {
      if (o === wire) continue;
      results.garbageSeen++;
      const r = receiveChirp(o, nowMin, new Set());
      if (r.entry?.sender) results.garbageAccepted++;
    }
  };
  const PROTOS = ['AUDIBLE_FASTEST', 'AUDIBLE_FAST', 'AUDIBLE_NORMAL'];
  const SNRS = [Infinity, 30, 20, 10, 6, 3, 0, -6, -10, -15, -20];
  let cellSeed = seed;
  for (const proto of PROTOS) {
    const sig = encode(wire, proto);
    results.durations[proto] = sig.length / SR;
    results.peaks[proto] = peak(sig);
    results.snr[proto] = {};
    for (const snr of SNRS) {
      let ok = 0;
      for (let t = 0; t < N; t++) {
        const rnd = mulberry32(cellSeed++);
        const outs = decode(channel(sig, { snrDb: snr, rnd, leadSamples: SR / 2 + Math.floor(rnd() * 1024) }));
        noteOutputs(outs);
        if (outs.includes(wire)) ok++;
      }
      results.snr[proto][snr] = ok;
    }
    // Amplitude: relative to ggwave's own volume-25 output, then normalised-to-full-scale x2 with hard clipping.
    results.amp[proto] = {};
    const amps = [['x0.01', { gain: 0.01 }], ['x0.1', { gain: 0.1 }], ['x0.5', { gain: 0.5 }], ['x2 (no clip)', { gain: 2 }],
      ['full-scale x2 clipped', { gain: 2 / results.peaks[proto], clip: true }], ['full-scale x8 clipped', { gain: 8 / results.peaks[proto], clip: true }]];
    for (const [label, opt] of amps) {
      let ok = 0;
      for (let t = 0; t < N; t++) {
        const rnd = mulberry32(cellSeed++);
        const outs = decode(channel(sig, { ...opt, snrDb: 30, rnd }));
        noteOutputs(outs);
        if (outs.includes(wire)) ok++;
      }
      results.amp[proto][label] = ok;
    }
  }

  // Time offset + partial chunking (FAST only, clean channel + 30 dB noise).
  {
    const sig = encode(wire, 'AUDIBLE_FAST');
    const offsets = [0, 1, 333, 1023, 4097];
    const chunks = [4096, 8192, 12288, 1 << 20, 400, 2048, 4092, 4095];
    for (const off of offsets) for (const cb of chunks) {
      const rnd = mulberry32(cellSeed++);
      const outs = decode(channel(sig, { snrDb: 30, rnd, leadSamples: off }), cb);
      noteOutputs(outs);
      results.chunk[`offset ${off} / chunk ${cb} B`] = outs.includes(wire);
    }
  }

  // A 50 ms dropout in the middle of the chirp (speaker glitch / door slam).
  const dropout = {};
  for (const proto of PROTOS) {
    let ok = 0;
    for (let t = 0; t < N; t++) {
      const sig = encode(wire, proto).slice();
      const rnd = mulberry32(cellSeed++);
      const at = Math.floor(sig.length * (0.2 + 0.6 * rnd()));
      sig.fill(0, at, at + SR / 20);
      const outs = decode(channel(sig, { snrDb: 30, rnd }));
      noteOutputs(outs);
      if (outs.includes(wire)) ok++;
    }
    dropout[proto] = ok;
  }
  results.dropout = dropout;

  // Sample-rate mismatch: console at 48 kHz, receiver AudioContext at 44.1 kHz (common on
  // Android), and speaker/mic clock drift (consumer crystals are ~+-20..100 ppm).
  results.rate = {};
  {
    const p441 = { ...params, sampleRateInp: 44100 };
    for (const proto of PROTOS) {
      const sig = encode(wire, proto);
      let ok = 0;
      for (let t = 0; t < N; t++) {
        const buf = resample(channel(sig, { snrDb: 20, rnd: mulberry32(cellSeed++) }), 44100 / SR);
        const outs = decode(buf, 4096, p441);
        noteOutputs(outs);
        if (outs.includes(wire)) ok++;
      }
      results.rate[`${proto} 48k->44.1k rx`] = ok;
      for (const ppm of [100, 1000, 5000]) {
        let okd = 0;
        for (let t = 0; t < N; t++) {
          const buf = resample(channel(sig, { snrDb: 20, rnd: mulberry32(cellSeed++) }), 1 + ppm / 1e6);
          const outs = decode(buf);
          noteOutputs(outs);
          if (outs.includes(wire)) okd++;
        }
        results.rate[`${proto} drift ${ppm} ppm`] = okd;
      }
    }
  }

  // Phase sweep: clean channel, every sample offset across one 1024-sample frame.
  results.phaseFail = {};
  for (const proto of PROTOS) {
    const sig = encode(wire, proto);
    results.phaseFail[proto] = [];
    for (let lead = 0; lead < 1024; lead++) {
      const outs = decode(channel(sig, { leadSamples: SR / 2 + lead, rnd: mulberry32(1) }));
      noteOutputs(outs);
      if (!outs.includes(wire)) results.phaseFail[proto].push(lead);
    }
  }
  // 44.1 kHz receiver, clean, chunk-size matrix (samples per decode() call).
  results.rate441chunks = {};
  {
    const sig = resample(encode(wire, 'AUDIBLE_FAST'), 44100 / SR);
    const p441 = { ...params, sampleRateInp: 44100 };
    for (const n of [512, 941, 1024, 2048, 4096, 8192]) {
      const buf = new Float32Array(22050 + sig.length + 22050); buf.set(sig, 22050);
      const outs = decode(buf, n * 4, p441);
      noteOutputs(outs);
      results.rate441chunks[n] = outs.includes(wire);
    }
  }

  // audio.js uses ONE instance for both encode and decode. Interrupt a decode with an encode.
  {
    const sig = encode(wire, 'AUDIBLE_FAST');
    const buf = channel(sig, { snrDb: 30, rnd: mulberry32(cellSeed++) });
    const one = gg.init(params);
    const bytes = new Int8Array(buf.buffer);
    const outs = [];
    for (let i = 0, k = 0; i < bytes.length; i += 4096, k++) {
      if (k === Math.floor(bytes.length / 4096 / 2)) gg.encode(one, 'SGVscCBjaGlycCB0ZXN0IDEyMzQ1', gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FASTEST, 25);
      const r = gg.decode(one, bytes.slice(i, i + 4096));
      if (r && r.length) outs.push(Buffer.from(r).toString('utf8'));
    }
    gg.free(one);
    noteOutputs(outs);
    results.sharedInstanceOk = outs.includes(wire);
  }

  // Pure noise for 20 s: decoder should emit nothing, and anything it emits must not verify.
  {
    const rnd = mulberry32(cellSeed++);
    const noise = new Float32Array(SR * 20).map(() => 0.05 * gauss(rnd));
    const outs = decode(noise);
    results.noiseOutputs = outs.length;
    noteOutputs(outs);
  }

  gg.free(tx);

  // ---- report ----
  log('\n  SNR table (decodes / N, white Gaussian noise over the whole buffer, random 0-1023 sample lead):');
  log(`  ${'protocol'.padEnd(17)} ${'dur s'.padStart(6)} ${SNRS.map((s) => (Number.isFinite(s) ? `${s} dB` : 'clean').padStart(7)).join('')}`);
  for (const p of PROTOS) log(`  ${p.padEnd(17)} ${results.durations[p].toFixed(2).padStart(6)} ${SNRS.map((s) => `${results.snr[p][s]}/${N}`.padStart(7)).join('')}`);
  log('\n  Amplitude table (30 dB SNR):');
  for (const p of PROTOS) log(`  ${p.padEnd(17)} peak=${results.peaks[p].toFixed(3)} ` + Object.entries(results.amp[p]).map(([k, v]) => `${k}: ${v}/${N}`).join(' | '));
  log('  Sample rate / clock drift (20 dB): ' + Object.entries(results.rate).map(([k, v]) => `${k} ${v}/${N}`).join(' | '));
  log('\n  50 ms dropout: ' + PROTOS.map((p) => `${p} ${dropout[p]}/${N}`).join(' | '));
  log('  Offset/chunk (AUDIBLE_FAST, 30 dB): ' + Object.entries(results.chunk).filter(([, v]) => !v).map(([k]) => k).join('; ') + (Object.values(results.chunk).every(Boolean) ? 'all decoded' : '  <- FAILED cells'));
  log(`  Pure noise 20 s: ${results.noiseOutputs} decoder outputs. Non-matching outputs seen overall: ${results.garbageSeen}, of which verified: ${results.garbageAccepted}`);
  log('  Clean phase sweep failures: ' + PROTOS.map((p) => `${p} ${results.phaseFail[p].length}/1024`).join(' | '));
  log('  44.1 kHz rx, chunk samples: ' + Object.entries(results.rate441chunks).map(([k, v]) => `${k}:${v ? 'ok' : 'FAIL'}`).join(' '));
  log(`  Max simultaneous rx instances: ${maxLiveRx} (plus 1 tx)`);

  // ---- checks ----
  for (const p of PROTOS) info(`audio ${p}: clean channel (random lead) decoded ${results.snr[p][Infinity]}/${N}`);
  for (const p of PROTOS) check(`audio ${p}: clean digital channel decodes at every tested sample phase (all 1024 lead offsets within one frame)`, results.phaseFail[p].length === 0, `${results.phaseFail[p].length}/1024 offsets fail${results.phaseFail[p].length ? `: ${results.phaseFail[p].slice(0, 8).join(',')}` : ''}`);
  check('audio: receiver AudioContext at 44.1 kHz decodes with 1024-sample buffers (audio.js createScriptProcessor(1024))', results.rate441chunks['1024'], Object.entries(results.rate441chunks).map(([k, v]) => `${k}:${v ? 'ok' : 'FAIL'}`).join(' '));
  for (const p of PROTOS) check(`audio ${p}: 10 dB SNR decodes >= ${N - 1}/${N}`, results.snr[p][10] >= N - 1, `${results.snr[p][10]}/${N}`);
  for (const p of PROTOS) info(`audio ${p}: wideband SNR 0 dB ${results.snr[p][0]}/${N}, -10 dB ${results.snr[p][-10]}/${N}, -15 dB ${results.snr[p][-15]}/${N}`);
  for (const p of PROTOS) check(`audio ${p}: x0.1 amplitude decodes`, results.amp[p]['x0.1'] >= N - 1, `${results.amp[p]['x0.1']}/${N}`);
  for (const p of PROTOS) check(`audio ${p}: full-scale x2 hard clipping decodes`, results.amp[p]['full-scale x2 clipped'] >= N - 1, `${results.amp[p]['full-scale x2 clipped']}/${N}`);
  const frameMultiple = (k) => Number(k.match(/chunk (\d+) B/)[1]) % 4096 === 0;
  const alignedFails = Object.entries(results.chunk).filter(([k, v]) => !v && frameMultiple(k)).map(([k]) => k);
  check('audio: every time offset decodes when chunks are whole 1024-sample frames (what audio.js feeds)', alignedFails.length === 0, alignedFails.join('; ') || 'all ok');
  const partial = Object.entries(results.chunk).filter(([k]) => !frameMultiple(k));
  info(`audio: chunks that are NOT a multiple of 1024 samples (4096 B) decode in ${partial.filter(([, v]) => v).length}/${partial.length} cells: the binding appears to drop partial frames. audio.js uses createScriptProcessor(1024), so the app is safe; any future AudioWorklet (128-frame quanta) MUST re-buffer to 1024.`);
  check('audio: one shared instance can encode mid-decode without losing the chirp being heard (receiver plays help chirps while listening)', results.sharedInstanceOk, String(results.sharedInstanceOk));
  for (const p of PROTOS) check(`audio ${p}: decodes when receiver runs at 44.1 kHz and console at 48 kHz`, results.rate[`${p} 48k->44.1k rx`] >= N - 1, `${results.rate[`${p} 48k->44.1k rx`]}/${N}`);
  for (const p of PROTOS) check(`audio ${p}: survives 100 ppm sample-clock drift`, results.rate[`${p} drift 100 ppm`] >= N - 1, `${results.rate[`${p} drift 100 ppm`]}/${N}`);
  for (const p of PROTOS) info(`audio ${p}: drift 1000 ppm ${results.rate[`${p} drift 1000 ppm`]}/${N}, 5000 ppm ${results.rate[`${p} drift 5000 ppm`]}/${N}`);
  check('audio: no corrupted/garbage decoder output ever verifies as signed', results.garbageAccepted === 0, `${results.garbageSeen} non-matching outputs, ${results.garbageAccepted} verified`);
  check('audio: 20 s of pure noise produces no verified alert', results.garbageAccepted === 0, `${results.noiseOutputs} outputs`);
  return results;
}

// Standalone mode.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { packBody, toWire, nowMinutes } = await import('../shared/payload.js');
  const { TRUSTED_KEYS } = await import('../shared/keys.js');
  const { receiveChirp } = await import('../shared/receive.js');
  const kp = globalThis.nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(Number(process.env.AUDIT_SEED || 1) & 255));
  TRUSTED_KEYS.push({ id: 'audit-a', name: 'Audit key', publicKey: Buffer.from(kp.publicKey).toString('base64') });
  const body = packBody({ type: 1, detail: 2, zone: 2, expiresMin: nowMinutes() + 60, msgId: 4242 });
  const wire = toWire(body, globalThis.nacl.sign.detached(body, kp.secretKey));
  let failed = 0;
  const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  [${d}]` : ''}`); if (!ok) failed++; };
  const info = (n) => console.log(`INFO  ${n}`);
  await runAudio({ check, info, wire, receiveChirp, nowMin: nowMinutes(), seed: Number(process.env.AUDIT_SEED || 1), N: Number(process.env.AUDIT_AUDIO_N || 5) });
  process.exit(failed ? 1 : 0);
}
