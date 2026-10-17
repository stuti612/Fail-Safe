// CHIRP broadcaster console: compose -> sign -> encode -> play.
import { initAudio, encode, play, durationOf } from '../shared/audio.js';
import { packBody, toWire, nowMinutes, SIG_LEN } from '../shared/payload.js';
import { sign, publicKeyFromSecret, findTrustedKey } from '../shared/trust.js';
import { loadPhrasebook, languages, describe, types, details, allZones } from '../shared/phrasebook.js';
import { STRICT_DEMO } from '../shared/config.js';
import { DEMO, acceptsDemo } from '../shared/demo-policy.js';
import { parseCap } from './cap.js';
import { speakAlert } from './speak.js';
import { waitSeconds, isWide, slowKey } from './slow.js';
import { startHelpQueue, publishToServer } from './helpqueue.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

await loadPhrasebook();

const pick = (all, only) => Object.entries(all).filter(([code]) => !STRICT_DEMO || Number(code) === only);
for (const [code, t] of pick(types(), DEMO.type)) $('type').add(new Option(`${t.icon} ${t.text.en}`, code));
for (const [code, d] of pick(details(), DEMO.detail)) $('detail').add(new Option(d.text.en || '(none)', code));
for (const [id, z] of pick(allZones(), DEMO.zone)) $('zone').add(new Option(z.name, id));
if (STRICT_DEMO) {
  $('strict-banner').classList.remove('hidden');
  $('valid').value = 1;
  $('speak-langs').value = 'en es';
  $('valid').disabled = $('speak-langs').disabled = true;
}

// ---- Signing key (never persisted) ----
let agency = null;
try { localStorage.removeItem('chirp.console.secret'); } catch {}
$('secret').oninput = checkKey;
function checkKey() {
  const secret = $('secret').value.trim();
  agency = null;
  if (!secret) {
    $('key-status').textContent = 'No key loaded: you can only play spoofed chirps.';
    return;
  }
  try {
    agency = findTrustedKey(publicKeyFromSecret(secret));
    if (STRICT_DEMO && agency?.id !== DEMO.signerId) $('key-status').textContent = '✖ Strict mode needs the venue TEST key. Broadcasting is blocked.';
    else $('key-status').textContent = agency
      ? `✔ Signing as ${agency.name}`
      : '⚠ Valid key, but phones do not trust it. Their alerts will show as UNVERIFIED.';
  } catch {
    $('key-status').textContent = '✖ That is not a valid signing key.';
  }
}
checkKey();

// ---- Compose ----
function currentAlert() {
  return {
    type: Number($('type').value),
    detail: Number($('detail').value),
    zone: Number($('zone').value),
    expiresMin: nowMinutes() + (STRICT_DEMO ? 1 : Math.max(1, Number($('valid').value) || 60)),
    msgId: nextMsgId(),
  };
}

function nextMsgId() {
  // Start at a random id so two consoles rarely collide.
  const id = (store.get('chirp.console.msgId', Math.floor(Math.random() * 65536)) + 1) % 65536;
  store.set('chirp.console.msgId', id);
  return id;
}

function renderPreview() {
  const sample = { type: Number($('type').value), detail: Number($('detail').value), zone: Number($('zone').value) };
  $('preview').replaceChildren(
    ...Object.entries(languages()).filter(([code]) => !STRICT_DEMO || ['en', 'es'].includes(code)).map(([code, info]) => {
      const d = describe(sample, code);
      const row = document.createElement('div');
      row.className = 'history-item';
      row.textContent = `${info.name}${info.reviewed ? '' : ' (unreviewed)'}: ${d.icon} ${d.title}${d.detail ? '. ' + d.detail : ''}`;
      return row;
    }),
  );
}
['type', 'detail', 'zone'].forEach((id) => $(id).addEventListener('change', renderPreview));
renderPreview();

// ---- Broadcast ----
let busy = false;

$('send').onclick = () => signAndBroadcast(currentAlert());

async function signAndBroadcast(alert) {
  const secret = $('secret').value.trim();
  if (!secret) return ($('status').textContent = 'Load a signing key first.');
  if (STRICT_DEMO && !acceptsDemo(alert, agency, nowMinutes())) return ($('status').textContent = 'Strict mode: only the signed TEST venue scenario can be broadcast.');
  const sentAt = store.get('chirp.console.sentAt', {});
  const wait = waitSeconds(alert, sentAt, Date.now());
  if (wait) return ($('status').textContent = `SLOW: this alert just went to this zone. Wait ${wait} s before repeating it.`);
  if (isWide(alert, allZones())) {
    const d = describe(alert, 'en');
    const typed = prompt(`WIDE-AREA ALERT\n"${d.title}" to everyone in ${d.zone}.\nType SEND to confirm.`);
    if (typed?.trim().toUpperCase() !== 'SEND') return ($('status').textContent = 'Wide-area alert not confirmed. Nothing sent.');
  }
  const body = packBody(alert);
  const wire = toWire(body, sign(body, secret));
  // Cooldown starts only once the chirp actually played.
  if (await broadcast(alert, wire, agency ? agency.name : 'Untrusted key', $('speak').checked)) {
    store.set('chirp.console.sentAt', { ...store.get('chirp.console.sentAt', {}), [slowKey(alert)]: Date.now() });
    if (agency) publishToServer(wire);
  }
}

$('spoof').onclick = () => {
  const alert = currentAlert();
  const fakeSig = crypto.getRandomValues(new Uint8Array(SIG_LEN));
  broadcast(alert, toWire(packBody(alert), fakeSig), 'SPOOFED (no valid signature)', false);
};

// ---- CAP / IPAWS import: CAP XML -> codes + zone -> preview -> sign -> chirp ----
// Strict mode: preview only.
const capMap = await fetch('../shared/cap-map.json').then((r) => r.json());
let capAlerts = [];

$('cap-sample').onchange = async () => {
  if (!$('cap-sample').value) return;
  $('cap').value = await fetch(`../docs/samples/${$('cap-sample').value}.xml`).then((r) => r.text());
  $('cap-read').click();
};

$('cap-read').onclick = () => {
  capAlerts = [];
  const out = $('cap-out');
  const line = (text, el = 'div') => Object.assign(document.createElement(el), { textContent: text });
  try {
    const { alerts, warnings, info } = parseCap($('cap').value, { map: capMap, zones: allZones(), nowMin: nowMinutes() });
    capAlerts = alerts;
    out.replaceChildren(
      line(`CAP: ${info.event || '(no event)'} · severity ${info.severity || '?'} · urgency ${info.urgency || '?'} · expires ${info.expires || '(default)'}`),
      ...warnings.map((w) => line(`⚠ ${w}`)),
      ...alerts.map((a, i) => {
        const row = document.createElement('div');
        row.className = 'row';
        const zone = document.createElement('select');
        zone.add(new Option('Pick a zone…', ''));
        for (const [id, z] of Object.entries(allZones())) zone.add(new Option(z.name, id, false, Number(id) === a.zone));
        zone.onchange = () => { a.zone = zone.value ? Number(zone.value) : null; load(a); };
        const show = line('Preview', 'button');
        show.className = 'secondary';
        show.onclick = () => load(a);
        row.append(line(`${i + 1}. "${a.areaDesc || 'no area'}" → ${describe(a, 'en').title}`), zone, show);
        return row;
      }),
    );
    if (alerts[0]) load(alerts[0]);
  } catch (err) {
    out.replaceChildren(line(`✖ ${err.message}`));
  }
  $('cap-send').classList.toggle('hidden', STRICT_DEMO || !capAlerts.length);
};

// Puts a CAP-derived alert in the compose form so the all-language preview shows it.
function load(a) {
  if (STRICT_DEMO) {
    const d = describe(a, 'en');
    return ($('status').textContent = `Strict mode, CAP preview only: ${d.title} · ${d.zone}.`);
  }
  $('type').value = a.type;
  $('detail').value = a.detail;
  if (a.zone !== null) $('zone').value = a.zone;
  $('valid').value = a.expiresMin - nowMinutes();
  renderPreview();
}

$('cap-send').onclick = async () => {
  if (STRICT_DEMO) return;
  if (capAlerts.some((a) => a.zone === null)) return ($('status').textContent = 'Pick a zone for every CAP area first.');
  if (capAlerts.some((a) => a.expiresMin <= nowMinutes())) return ($('status').textContent = 'CAP alert has expired. Not sent.');
  for (const a of capAlerts) await signAndBroadcast({ type: a.type, detail: a.detail, zone: a.zone, expiresMin: a.expiresMin, msgId: nextMsgId() });
};

// Resolves true only if every repeat played.
async function broadcast(alert, wire, senderLabel, speak) {
  if (busy) return false;
  busy = true;
  $('send').disabled = $('spoof').disabled = true;
  try {
    await initAudio();
    const samples = encode(wire, $('protocol').value, Number($('volume').value) || 25);
    const seconds = durationOf(samples);
    const repeats = Math.min(10, Math.max(1, Number($('repeats').value) || 1));
    const airtime = logRow(alert, senderLabel, `${seconds.toFixed(1)} s × ${repeats}`);
    const t0 = performance.now();
    for (let i = 1; i <= repeats; i++) {
      $('status').textContent = `Playing ${i}/${repeats} · ${wire.length} chars · ${seconds.toFixed(1)} s each`;
      await play(samples);
      if (i < repeats) await new Promise((r) => setTimeout(r, 700));
    }
    let done = `Done · ${wire.length} chars · ${seconds.toFixed(1)} s per chirp`;
    if (speak) {
      const langs = $('speak-langs').value.toLowerCase().split(/[\s,]+/).filter((l) => languages()[l]);
      $('status').textContent = `Speaking: ${langs.join(', ')}`;
      const s = await speakAlert(alert, langs);
      airtime.textContent += ` + speech ${s.seconds.toFixed(1)} s (${s.spoken.join(' ') || 'none'})`;
      if (s.skipped.length) done += ` · no on-device voice for: ${s.skipped.join(', ')}`;
      if (s.failed.length) done += ` · speech failed for: ${s.failed.join(', ')}`;
    }
    airtime.textContent += ` = ${((performance.now() - t0) / 1000).toFixed(1)} s total`;
    $('status').textContent = done;
    return true;
  } catch (err) {
    $('status').textContent = `Error: ${err.message}`;
    return false;
  } finally {
    busy = false;
    $('send').disabled = $('spoof').disabled = false;
  }
}

function logRow(alert, sender, airtime) {
  const d = describe(alert, 'en');
  const tr = document.createElement('tr');
  for (const text of [new Date().toLocaleTimeString(), `${d.icon} ${d.title}${d.detail ? ' · ' + d.detail : ''}`, d.zone, sender, airtime]) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
  }
  $('log').prepend(tr);
  return tr.lastChild;
}

startHelpQueue({ listEl: $('help-list'), statusEl: $('help-count'), listenBtn: $('help-listen'), store });
