// CHIRP broadcaster console: compose -> sign -> encode -> play.
import { initAudio, encode, play, durationOf } from '../shared/audio.js';
import { packBody, toWire, nowMinutes, SIG_LEN } from '../shared/payload.js';
import { sign, publicKeyFromSecret, findTrustedKey } from '../shared/trust.js';
import { loadPhrasebook, languages, describe, types, details, allZones } from '../shared/phrasebook.js';
import { parseCap } from './cap.js';
import { speakAlert } from './speak.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

await loadPhrasebook();

for (const [code, t] of Object.entries(types())) $('type').add(new Option(`${t.icon} ${t.text.en}`, code));
for (const [code, d] of Object.entries(details())) $('detail').add(new Option(d.text.en || '(none)', code));
for (const [id, z] of Object.entries(allZones())) $('zone').add(new Option(z.name, id));

// ---- Signing key ----
let agency = null;
$('secret').value = store.get('chirp.console.secret', '');
$('secret').oninput = checkKey;
function checkKey() {
  const secret = $('secret').value.trim();
  store.set('chirp.console.secret', secret);
  agency = null;
  if (!secret) {
    $('key-status').textContent = 'No key loaded: you can only play spoofed chirps.';
    return;
  }
  try {
    agency = findTrustedKey(publicKeyFromSecret(secret));
    $('key-status').textContent = agency
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
    expiresMin: nowMinutes() + Math.max(1, Number($('valid').value) || 60),
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
    ...Object.entries(languages()).map(([code, info]) => {
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

function signAndBroadcast(alert) {
  const secret = $('secret').value.trim();
  if (!secret) return ($('status').textContent = 'Load a signing key first.');
  const body = packBody(alert);
  return broadcast(alert, toWire(body, sign(body, secret)), agency ? agency.name : 'Untrusted key', $('speak').checked);
}

$('spoof').onclick = () => {
  const alert = currentAlert();
  const fakeSig = crypto.getRandomValues(new Uint8Array(SIG_LEN));
  broadcast(alert, toWire(packBody(alert), fakeSig), 'SPOOFED (no valid signature)', false);
};

// ---- CAP / IPAWS import: CAP XML -> codes + zone -> preview -> sign -> chirp ----
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
  $('cap-send').classList.toggle('hidden', !capAlerts.length);
};

// Puts a CAP-derived alert in the compose form so the all-language preview shows it.
function load(a) {
  $('type').value = a.type;
  $('detail').value = a.detail;
  if (a.zone !== null) $('zone').value = a.zone;
  $('valid').value = a.expiresMin - nowMinutes();
  renderPreview();
}

$('cap-send').onclick = async () => {
  if (capAlerts.some((a) => a.zone === null)) return ($('status').textContent = 'Pick a zone for every CAP area first.');
  if (capAlerts.some((a) => a.expiresMin <= nowMinutes())) return ($('status').textContent = 'CAP alert has expired. Not sent.');
  for (const a of capAlerts) await signAndBroadcast({ type: a.type, detail: a.detail, zone: a.zone, expiresMin: a.expiresMin, msgId: nextMsgId() });
};

async function broadcast(alert, wire, senderLabel, speak) {
  if (busy) return;
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
      if (s.skipped.length) done += ` · no voice installed for: ${s.skipped.join(', ')}`;
    }
    airtime.textContent += ` = ${((performance.now() - t0) / 1000).toFixed(1)} s total`;
    $('status').textContent = done;
  } catch (err) {
    $('status').textContent = `Error: ${err.message}`;
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
