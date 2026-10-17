// CHIRP receiver: listens for chirps, verifies them, shows them in the
// phone's language. Works fully offline once loaded.
import { initAudio, listen, encode, play } from '../shared/audio.js';
import { nowMinutes } from '../shared/payload.js';
import { loadPhrasebook, languages, pickDefaultLanguage, ui, describe, allZones } from '../shared/phrasebook.js';
import { RETELL_PHONE, HELP_ENDPOINT, STRICT_DEMO } from '../shared/config.js';
import { verifiedDemoWire } from '../shared/demo-policy.js';
import { receiveChirp, outsideZone } from '../shared/receive.js';
import { encodeHelp, NEEDS } from '../shared/help.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

await loadPhrasebook();
const MAX_VALID_MIN = 12 * 60; // Keep in sync with the console's CAP validity cap.
const LANGS = Object.keys(languages()).filter((c) => !STRICT_DEMO || ['en', 'es'].includes(c));
let lang = store.get('chirp.lang', null) || pickDefaultLanguage();
if (!LANGS.includes(lang)) lang = 'en';
if (STRICT_DEMO) $('strict-banner').classList.remove('hidden');

// Stored history is re-verified on load, so a tampered localStorage can't fake a signer.
const restore = (h) => {
  if (typeof h?.wire !== 'string') return null;
  const at = Number.isFinite(h.at) ? h.at : Date.now();
  if (STRICT_DEMO) { const v = verifiedDemoWire(h.wire, nowMinutes()); return v && { ...v, at }; }
  const r = receiveChirp(h.wire, 0); // 0: keep expired ones in history (shown as expired)
  return r.status === 'ok' && r.entry.alert.expiresMin <= nowMinutes() + MAX_VALID_MIN ? { ...r.entry, key: r.key, at } : null;
};
const saved = store.get('chirp.history', []);
let history = (Array.isArray(saved) ? saved : []).map(restore).filter(Boolean).slice(0, 30);
store.set('chirp.history', history);
const seen = new Set(history.flatMap((h) => [h.wire, h.key].filter(Boolean)));

// ---- Language ----
for (const code of LANGS) $('lang').add(new Option(languages()[code].name, code, false, code === lang));
$('lang').onchange = () => {
  lang = $('lang').value;
  store.set('chirp.lang', lang);
  document.documentElement.lang = lang;
  render();
};

// ---- Position (optional; GPS works offline on most phones) ----
let pos = null;
function locate() {
  navigator.geolocation?.getCurrentPosition(
    (p) => { pos = { lat: p.coords.latitude, lon: p.coords.longitude }; render(); },
    () => {}, { maximumAge: 600000, timeout: 10000, enableHighAccuracy: false });
}
if (!STRICT_DEMO) navigator.permissions?.query({ name: 'geolocation' }).then((s) => s.state === 'granted' && locate()).catch(() => {});

// ---- Listening ----
$('start').onclick = async () => {
  $('start').disabled = true;
  try {
    await initAudio();
    await listen(onChirp, (level) => ($('level').style.width = `${Math.round(level * 100)}%`));
    $('start').classList.add('hidden');
    $('listening').classList.remove('hidden');
    keepScreenOn();
    if (!STRICT_DEMO) locate();
  } catch (err) {
    $('start').disabled = false;
    alert(`Could not start the microphone: ${err.message}`);
  }
};

async function keepScreenOn() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && lock?.released) keepScreenOn();
    }, { once: true });
  } catch {}
}

function onChirp(text) {
  // Chirps are repeated for reliability; act on each one once.
  if (seen.has(text)) return;
  let entry;
  if (STRICT_DEMO) {
    entry = verifiedDemoWire(text, nowMinutes());
    if (!entry) return console.warn('strict mode: ignored untrusted, expired or out-of-scope chirp');
  } else {
    const r = receiveChirp(text, nowMinutes(), seen);
    if (r.status !== 'ok') return console.warn(`ignored ${r.status} chirp`);
    entry = { ...r.entry, key: r.key };
  }
  if (entry.alert.expiresMin > nowMinutes() + MAX_VALID_MIN) return console.warn('ignored excessive alert validity');
  if (entry.key) seen.add(entry.key);
  seen.add(text);
  history.unshift({ ...entry, at: Date.now() });
  history = history.slice(0, 30);
  store.set('chirp.history', history);
  // HOLD rung: only verified alerts may buzz the phone.
  // Hearing the chirp is local evidence. Suppress vibration only when GPS
  // positively places the phone outside the target area; no fix is common indoors.
  const away = outsideZone(allZones()[entry.alert.zone], pos) === true;
  if (!STRICT_DEMO && entry.sender && !away && navigator.vibrate) navigator.vibrate([400, 150, 400]);
  render();
}

// ---- Rendering ----
function alertCard(entry, { large }) {
  const d = describe(entry.alert, lang);
  const expired = entry.alert.expiresMin < nowMinutes();
  const until = new Date(entry.alert.expiresMin * 60000).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' });
  const away = !STRICT_DEMO && outsideZone(allZones()[entry.alert.zone], pos);
  const cls = ['alert', entry.sender ? d.severity : 'unverified', expired || away ? 'expired' : ''].join(' ');
  const el = document.createElement('div');
  el.className = cls;
  if (!large) el.style.padding = '12px';
  el.innerHTML = `
    <div class="zone" style="font-size:${large ? '1.3rem' : '1rem'};font-weight:700"></div>
    <div class="title" ${large ? '' : 'style="font-size:1.1rem"'}></div>
    <div class="detail"></div>
    <div class="meta"></div>
    <div class="warn"></div>`;
  el.querySelector('.zone').textContent = `📍 ${d.zone}${away ? ` · ⚠ ${ui('otherArea', lang)}` : ''}`;
  el.querySelector('.title').textContent = `${d.icon} ${d.title}`;
  el.querySelector('.detail').textContent = d.detail;
  const signer = STRICT_DEMO
    ? (lang === 'es' ? `✔ Firma de prueba: ${entry.sender.name}` : `✔ Demo signature: ${entry.sender.name}`)
    : entry.sender ? `✔ ${ui('verified', lang)}: ${entry.sender.name}` : '';
  el.querySelector('.meta').textContent = [expired ? ui('expired', lang) : `${ui('validUntil', lang)} ${until}`, signer].filter(Boolean).join(' · ');
  el.querySelector('.warn').textContent = STRICT_DEMO
    ? (lang === 'es' ? 'SOLO PRUEBA. No actúe según esta demostración; consulte al personal del lugar.' : 'TEST ONLY. Do not act on this demo; ask venue staff.')
    : entry.sender ? ui('testWarning', lang) : `⚠ ${ui('unverified', lang)}`;
  if (!large) el.querySelector('.detail').style.fontSize = '1rem';
  return el;
}

function render() {
  $('start').textContent = ui('start', lang);
  $('listening-text').textContent = ui('listening', lang);
  $('help').textContent = ui('needHelp', lang);
  $('call').querySelector('button').textContent = `📞 ${ui('callHelp', lang)}`;
  $('earlier').textContent = ui('earlier', lang);
  $('need-label').textContent = ui('needHelp', lang);
  $('people-label').textContent = ui('people', lang);
  $('life-label').textContent = ui('lifeThreat', lang);
  $('vuln-label').textContent = ui('vulnerable', lang);
  $('call911').textContent = `🚑 ${ui('call911', lang)}`;
  $('help-send').textContent = ui('sendHelp', lang);
  const keys = { 1: 'needMedical', 2: 'needMobility', 3: 'needTrapped', 4: 'needOther' };
  const needVal = $('need').value || '1';
  $('need').replaceChildren(...Object.keys(NEEDS).map((n) => new Option(ui(keys[n], lang), n, false, n === needVal)));

  const [latest, ...rest] = history;
  $('current').replaceChildren(latest ? alertCard(latest, { large: true }) : '');
  // Anyone can ask for help, alert or not. Strict mode keeps Codex's narrower rule.
  $('actions').classList.toggle('hidden', STRICT_DEMO && !latest?.sender);

  $('history').replaceChildren(
    ...(rest.length ? rest.map((e) => alertCard(e, { large: false })) : [Object.assign(document.createElement('div'), { className: 'muted', textContent: ui('noAlerts', lang) })]),
  );
  renderHelpStatus();
}

// ---- "I need help" (ASK): reply chirp to any console in earshot + POST when online ----
let outbox = store.get('chirp.outbox', []).filter((r) => typeof r === 'object');
let lastHelp = '';
let flushing = false;

$('help').onclick = () => {
  if (STRICT_DEMO) { // local note only
    const latest = history[0];
    outbox.push({ msgId: latest.alert.msgId, lang, createdMin: nowMinutes() });
    store.set('chirp.outbox', outbox);
    return renderHelpStatus();
  }
  $('help-form').classList.toggle('hidden');
  if (!pos) locate();
};
$('life').onchange = () => $('call911').classList.toggle('hidden', !$('life').checked);

$('help-send').onclick = async () => {
  const req = {
    need: Number($('need').value) || 4,
    lifeThreat: $('life').checked,
    vulnerable: $('vuln').checked,
    people: Number($('people').value) || 1,
    lang,
    msgId: history.find((h) => h.sender)?.alert.msgId || 0,
    reqId: Math.floor(Math.random() * 65536),
    lat: pos ? Math.round(pos.lat * 100) / 100 : null, // coarse on purpose (~1 km)
    lon: pos ? Math.round(pos.lon * 100) / 100 : null,
    createdMin: nowMinutes(),
  };
  outbox.push(req);
  store.set('chirp.outbox', outbox);
  $('help-form').classList.add('hidden');
  $('help-send').disabled = true;
  try {
    await initAudio();
    const samples = encode(encodeHelp(req), 'fastest', 50);
    for (let i = 0; i < 2; i++) await play(samples);
    lastHelp = ui('helpPlayed', lang);
  } catch (err) {
    console.warn('help chirp failed', err);
  } finally {
    $('help-send').disabled = false;
  }
  renderHelpStatus();
  flushOutbox();
};

async function flushOutbox() {
  if (flushing || STRICT_DEMO || !HELP_ENDPOINT || !navigator.onLine || !outbox.length) return;
  flushing = true;
  try {
    for (const req of [...outbox]) {
      try {
        const res = await fetch(HELP_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
        if (!res.ok) break;
        outbox = outbox.filter((r) => r !== req);
        store.set('chirp.outbox', outbox);
        lastHelp = ui('helpDelivered', lang);
      } catch {
        break;
      }
    }
  } finally {
    flushing = false;
    renderHelpStatus();
  }
}

function renderHelpStatus() {
  const pending = outbox.length ? `${ui('helpNotDelivered', lang)} (${outbox.length})` : '';
  $('help-status').textContent = [lastHelp, pending].filter(Boolean).join(' ');
}

window.addEventListener('online', flushOutbox);
document.addEventListener('visibilitychange', () => { if (!document.hidden) flushOutbox(); });
setInterval(flushOutbox, 30000);
flushOutbox();

if (RETELL_PHONE) {
  $('call').href = `tel:${RETELL_PHONE}`;
  $('call').classList.remove('hidden');
}

// ---- Network status (shows the app is working offline) ----
const showNet = () => ($('net').textContent = navigator.onLine ? 'Online' : 'Offline: still listening');
window.addEventListener('online', showNet);
window.addEventListener('offline', showNet);
showNet();

// ---- Debug: ?debug=1 lets you paste a wire string instead of using audio ----
if (new URLSearchParams(location.search).has('debug')) {
  $('debug').classList.remove('hidden');
  $('paste-go').onclick = () => onChirp($('paste').value.trim());
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});

document.documentElement.lang = lang;
render();
flushOutbox();
setInterval(render, 30000);
