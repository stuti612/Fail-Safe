// Twist #1 proof from the existing CHIRP build. This is a digital loopback,
// not a speaker-to-phone or offline-receiver measurement.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.nacl = require('../vendor/nacl-fast.min.js');
const ggwaveFactory = require('../vendor/ggwave.js');
const { packBody, toWire, fromWire, nowMinutes } = await import('../shared/payload.js');
const { sign, verify } = await import('../shared/trust.js');
const root = new URL('..', import.meta.url);
const secret = readFileSync(new URL('keys/coliseum-ops.secret', root), 'utf8').trim();

const body = packBody({ type: 12, detail: 13, zone: 10, expiresMin: nowMinutes() + 1, msgId: 4242 });
const wire = toWire(body, sign(body, secret));
const parsed = fromWire(wire);
const tampered = parsed.body.slice();
tampered[1] = 1;
const checks = {
  packet_100_characters: wire.length === 100,
  signature_verifies_with_demo_venue_key: verify(parsed.body, parsed.sig)?.id === 'coliseum-ops',
  tampered_body_rejected: verify(tampered, parsed.sig) === null,
  random_signature_rejected: verify(parsed.body, new Uint8Array(64).fill(7)) === null,
};

const gg = await ggwaveFactory();
gg.disableLog();
const params = gg.getDefaultParameters();
params.sampleRateInp = params.sampleRateOut = 48000;
const tx = gg.init(params);
const trials = [];
for (const protocol of ['AUDIBLE_FAST', 'AUDIBLE_FASTEST']) {
  const raw = gg.encode(tx, wire, gg.ProtocolId[`GGWAVE_PROTOCOL_${protocol}`], 25);
  const waveform = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const rx = gg.init(params);
  const bytes = new Int8Array(waveform.buffer);
  let heard = null;
  for (let i = 0; i < bytes.length; i += 4096) {
    const decoded = gg.decode(rx, bytes.slice(i, i + 4096));
    if (decoded?.length) heard = new TextDecoder().decode(new Uint8Array(decoded));
  }
  gg.free(rx);
  trials.push({ protocol, digital_waveform_seconds: Number((waveform.length / 48000).toFixed(2)), decoded_same_packet: heard === wire });
}
gg.free(tx);

const evidence = {
  project: 'CHIRP',
  generated_at: new Date().toISOString(),
  twist: 'Identify a federal funding pathway',
  possible_federal_rd_pathway: {
    program: 'NSF SBIR Phase I',
    solicitation: 'https://www.nsf.gov/funding/opportunities/small-business-innovation-research-small-business-technology/nsf26-510/solicitation',
    project_pitch: 'https://seedfund.nsf.gov/project-pitch/',
    limit_usd: 305000,
    project_duration_months: '6–18',
    status: 'Conditional future R&D route. Company eligibility, invitation, technical novelty and customer demand are unproven.',
  },
  scope: 'Signed TEST code with hypothetical gate scenario and ggwave digital waveform loopback in Node; no physical sound path',
  authority: 'Demo key only; no agency or venue has authorized this system',
  current_wire_has_test_flag: false,
  signed_type_is_test: true,
  packet_characters: wire.length,
  protocol_checks: checks,
  digital_waveform_trials: trials,
  speaker_to_phone_trials: null,
  offline_phone_trials: null,
  venue_reach: null,
};
if (Object.values(checks).some(value => !value) || trials.some(trial => !trial.decoded_same_packet)) {
  throw new Error('Funding evidence regression failed');
}
writeFileSync(new URL('docs/twist1-evidence.json', root), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Wrote docs/twist1-evidence.json: ${trials.map(t => `${t.protocol} ${t.digital_waveform_seconds}s`).join(', ')}`);
process.exit(0);
