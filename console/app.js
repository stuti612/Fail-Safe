// CHIRP broadcaster console: compose -> sign -> encode -> play.
import { initAudio, encode, play, durationOf } from '../shared/audio.js';
import { packBody, toWire, nowMinutes, SIG_LEN } from '../shared/payload.js';
import { sign, publicKeyFromSecret, findTrustedKey } from '../shared/trust.js';
import { loadPhrasebook, languages, describe, types, details, allZones } from '../shared/phrasebook.js';
import { STRICT_DEMO } from '../shared/config.js';
import { DEMO, acceptsDemo } from '../shared/demo-policy.js';
import { parseCap, MAX_VALID_MIN } from './cap.js';
import { speakAlert } from './speak.js';
import { waitSeconds, isWide, slowKey } from './slow.js';
import { startHelpQueue, publishToServer } from './helpqueue.js';
import { makePattern } from '../range/pattern.js';

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
    expiresMin: nowMinutes() + (STRICT_DEMO ? 1 : Math.min(MAX_VALID_MIN, Math.max(1, Number($('valid').value) || 60))),
    msgId: nextMsgId(),
  };
}

function nextMsgId() {
  // Start at a random id so two consoles rarely collide.
  const id = (store.get('chirp.console.msgId', Math.floor(Math.random() * 65536)) + 1) % 65536;
  store.set('chirp.console.msgId', id);
  return id;
}

const languageRows = (alert) =>
  Object.entries(languages()).filter(([code]) => !STRICT_DEMO || ['en', 'es'].includes(code)).map(([code, info]) => {
    const d = describe(alert, code);
    const row = document.createElement('div');
    row.className = 'history-item';
    row.textContent = `${info.name}${info.reviewed ? '' : ' (unreviewed)'}: ${d.icon} ${d.title}${d.detail ? '. ' + d.detail : ''}`;
    return row;
  });

function renderPreview() {
  $('preview').replaceChildren(...languageRows({ type: Number($('type').value), detail: Number($('detail').value), zone: Number($('zone').value) }));
}
['type', 'detail', 'zone'].forEach((id) => $(id).addEventListener('change', renderPreview));
renderPreview();

// ---- Review: a person approves every alert on a full screen ----
// Measured airtime of a 100-char signed alert per protocol (scripts/selftest.mjs).
const CHIRP_SECONDS = { fastest: 3.75, fast: 6.83, normal: 9.9 };
const GAP_SECONDS = 0.7;
const SPEECH_SECONDS_EST = 5; // per language; an estimate, not measured
const MAX_SPOKEN = 3;

const repeatCount = () => Math.min(10, Math.max(1, Number($('repeats').value) || 1));
const spokenLangs = () => $('speak-langs').value.toLowerCase().split(/[\s,]+/).filter((l) => languages()[l]);

function airtimeText() {
  const chirp = CHIRP_SECONDS[$('protocol').value] ?? CHIRP_SECONDS.fast;
  const n = repeatCount();
  const langs = $('speak').checked ? spokenLangs() : [];
  const total = n * chirp + (n - 1) * GAP_SECONDS + langs.length * SPEECH_SECONDS_EST;
  const lines = [`App phones get it in ${chirp.toFixed(1)} s, in every language at once. Full broadcast ≈ ${Math.round(total)} s (chirp × ${n}${langs.length ? `, plus spoken ${langs.join(' ')}` : ''}).`];
  if (langs.length > MAX_SPOKEN) lines.push(`⚠ ${langs.length} spoken languages: the last one starts ≈ ${Math.round(total - SPEECH_SECONDS_EST)} s in. Keep it to ${MAX_SPOKEN} or fewer.`);
  return lines;
}

// Resolves true only if the operator pressed Approve (and typed SEND for a wide zone).
function review(alert, step) {
  const d = describe(alert, 'en');
  const wide = isWide(alert, allZones());
  const card = document.createElement('div');
  card.className = `alert ${d.severity}`;
  for (const [cls, text] of [['title', `${d.icon} ${d.title}`], ['detail', d.detail], ['meta', d.zone]]) {
    if (text) card.appendChild(Object.assign(document.createElement('div'), { className: cls, textContent: text }));
  }
  const until = new Date(alert.expiresMin * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('review-step').textContent = step;
  $('review-alert').replaceChildren(card);
  $('review-meta').textContent = `Valid until ${until} · signed as ${agency ? agency.name : 'an UNTRUSTED key (phones will show UNVERIFIED)'}`;
  const [time, warn] = airtimeText();
  $('review-time').replaceChildren(time, ...(warn ? [Object.assign(document.createElement('div'), { className: 'review-warn', textContent: warn })] : []));
  $('review-langs').replaceChildren(...languageRows(alert));
  const confirm = $('review-confirm');
  confirm.value = '';
  $('review-wide').classList.toggle('hidden', !wide);
  $('review-approve').disabled = wide;
  confirm.oninput = () => { $('review-approve').disabled = confirm.value.trim().toUpperCase() !== 'SEND'; };
  const dlg = $('review');
  dlg.returnValue = '';
  dlg.showModal();
  (wide ? confirm : $('review-cancel')).focus();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'approve'), { once: true }));
}

// ---- Broadcast ----
let busy = false;

$('send').onclick = () => signAndBroadcast(currentAlert());

async function signAndBroadcast(alert, step = '') {
  const secret = $('secret').value.trim();
  const stop = (msg) => { $('status').textContent = msg; return false; };
  if (!secret) return stop('Load a signing key first.');
  if (busy) return stop('A broadcast is already playing.');
  if (STRICT_DEMO && !acceptsDemo(alert, agency, nowMinutes())) return stop('Strict mode: only the signed TEST venue scenario can be broadcast.');
  const sentAt = store.get('chirp.console.sentAt', {});
  const wait = waitSeconds(alert, sentAt, Date.now());
  if (wait) return stop(`SLOW: this alert just went to this zone. Wait ${wait} s before repeating it.`);
  if (!(await review(alert, step))) return stop(isWide(alert, allZones()) ? 'Wide-area alert not confirmed. Nothing sent.' : 'Cancelled. Nothing sent.');
  if (alert.expiresMin <= nowMinutes()) return stop('The alert expired while in review. Nothing sent.');
  const body = packBody(alert);
  const wire = toWire(body, sign(body, secret));
  // Cooldown starts only once the chirp actually played.
  if (!(await broadcast(alert, wire, agency ? agency.name : 'Untrusted key', $('speak').checked))) return false;
  store.set('chirp.console.sentAt', { ...store.get('chirp.console.sentAt', {}), [slowKey(alert)]: Date.now() });
  if (agency) $('status').textContent += ` · ${await publishToServer(wire)}`;
  return true;
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
  for (const [i, a] of capAlerts.entries()) {
    const step = `CAP area ${i + 1} of ${capAlerts.length}: "${a.areaDesc || 'no area'}"`;
    if (!(await signAndBroadcast({ type: a.type, detail: a.detail, zone: a.zone, expiresMin: a.expiresMin, msgId: nextMsgId() }, step))) {
      $('status').textContent += ` · CAP batch stopped at area ${i + 1} of ${capAlerts.length}; later areas NOT sent.`;
      return;
    }
  }
  $('status').textContent += ` · all ${capAlerts.length} CAP area(s) sent.`;
};

// Resolves true if at least one repeat played (it is on air; cooldown must apply).
async function broadcast(alert, wire, senderLabel, speak) {
  if (busy) return false;
  busy = true;
  let played = 0;
  $('send').disabled = $('spoof').disabled = true;
  try {
    await initAudio();
    const samples = encode(wire, $('protocol').value, Number($('volume').value) || 25);
    const seconds = durationOf(samples);
    const repeats = repeatCount();
    const airtime = logRow(alert, senderLabel, `${seconds.toFixed(1)} s × ${repeats}`);
    const t0 = performance.now();
    // Interleave speech with the chirps (chirp, lang 1, chirp, lang 2, ...) so no
    // language waits behind every repeat; leftover languages follow the last chirp.
    const langs = speak ? spokenLangs() : [];
    const speech = { seconds: 0, spoken: [], skipped: [], failed: [] };
    const say = async (lang) => {
      $('status').textContent = `Speaking: ${lang}`;
      const s = await speakAlert(alert, [lang]);
      speech.seconds += s.seconds;
      for (const k of ['spoken', 'skipped', 'failed']) speech[k].push(...s[k]);
    };
    for (let i = 1; i <= repeats; i++) {
      $('status').textContent = `Playing ${i}/${repeats} · ${wire.length} chars · ${seconds.toFixed(1)} s each`;
      await play(samples);
      played++;
      if (langs[i - 1]) await say(langs[i - 1]);
      else if (i < repeats) await new Promise((r) => setTimeout(r, GAP_SECONDS * 1000));
    }
    for (const lang of langs.slice(repeats)) await say(lang);
    let done = `Done · ${wire.length} chars · ${seconds.toFixed(1)} s per chirp`;
    if (speak) {
      airtime.textContent += ` + speech ${speech.seconds.toFixed(1)} s (${speech.spoken.join(' ') || 'none'})`;
      if (speech.skipped.length) done += ` · no on-device voice for: ${speech.skipped.join(', ')}`;
      if (speech.failed.length) done += ` · speech failed for: ${speech.failed.join(', ')}`;
    }
    airtime.textContent += ` = ${((performance.now() - t0) / 1000).toFixed(1)} s total`;
    $('status').textContent = done;
    return true;
  } catch (err) {
    $('status').textContent = `Error after ${played} chirp(s): ${err.message}`;
    return played > 0;
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

// ---- Range test: N numbered patterns, 1 s apart ----
$('pattern-send').onclick = async () => {
  if (busy) return;
  busy = true;
  const run = (store.get('chirp.console.run', 0) + 1) % 256;
  store.set('chirp.console.run', run);
  const n = Math.min(50, Math.max(1, Number($('pattern-n').value) || 10));
  try {
    await initAudio();
    for (let seq = 1; seq <= n; seq++) {
      $('pattern-status').textContent = `Run ${run}: pattern ${seq}/${n} (${$('protocol').value})`;
      await play(encode(makePattern(run, seq), $('protocol').value, Number($('volume').value) || 25));
      await new Promise((r) => setTimeout(r, 1000));
    }
    $('pattern-status').textContent = `Run ${run} done: ${n} patterns sent. Set "Patterns sent per run" to ${n} on the phones.`;
  } catch (err) {
    $('pattern-status').textContent = `Error: ${err.message}`;
  } finally {
    busy = false;
  }
};

startHelpQueue({ listEl: $('help-list'), statusEl: $('help-count'), listenBtn: $('help-listen'), store });
