// CHIRP broadcaster console: compose -> sign -> encode -> play.
import { initAudio, encode, play, durationOf } from '../shared/audio.js';
import { packBody, toWire, nowMinutes, SIG_LEN } from '../shared/payload.js';
import { sign, publicKeyFromSecret, findTrustedKey } from '../shared/trust.js';
import { loadPhrasebook, languages, describe, types, details, allZones } from '../shared/phrasebook.js';

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

$('send').onclick = () => {
  const secret = $('secret').value.trim();
  if (!secret) return ($('status').textContent = 'Load a signing key first.');
  const alert = currentAlert();
  const body = packBody(alert);
  broadcast(alert, toWire(body, sign(body, secret)), agency ? agency.name : 'Untrusted key');
};

$('spoof').onclick = () => {
  const alert = currentAlert();
  const fakeSig = crypto.getRandomValues(new Uint8Array(SIG_LEN));
  broadcast(alert, toWire(packBody(alert), fakeSig), 'SPOOFED (no valid signature)');
};

async function broadcast(alert, wire, senderLabel) {
  if (busy) return;
  busy = true;
  $('send').disabled = $('spoof').disabled = true;
  try {
    await initAudio();
    const samples = encode(wire, $('protocol').value, Number($('volume').value) || 25);
    const seconds = durationOf(samples);
    const repeats = Math.min(10, Math.max(1, Number($('repeats').value) || 1));
    logRow(alert, senderLabel, `${seconds.toFixed(1)} s × ${repeats}`);
    for (let i = 1; i <= repeats; i++) {
      $('status').textContent = `Playing ${i}/${repeats} · ${wire.length} chars · ${seconds.toFixed(1)} s each`;
      await play(samples);
      if (i < repeats) await new Promise((r) => setTimeout(r, 700));
    }
    $('status').textContent = `Done · ${wire.length} chars · ${seconds.toFixed(1)} s per chirp`;
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
}
