// CHIRP receiver: listens for chirps, verifies them, shows them in the
// phone's language. Works fully offline once loaded.
import { initAudio, listen } from '../shared/audio.js';
import { fromWire, unpackBody, nowMinutes } from '../shared/payload.js';
import { verify } from '../shared/trust.js';
import { loadPhrasebook, languages, pickDefaultLanguage, ui, describe } from '../shared/phrasebook.js';
import { RETELL_PHONE, HELP_ENDPOINT } from '../shared/config.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

await loadPhrasebook();
let lang = store.get('chirp.lang', null) || pickDefaultLanguage();
let history = store.get('chirp.history', []); // newest first; each { alert, sender, wire, at }
const seen = new Set(history.map((h) => h.wire));

// ---- Language ----
for (const [code, info] of Object.entries(languages())) {
  $('lang').add(new Option(info.name, code, false, code === lang));
}
$('lang').onchange = () => {
  lang = $('lang').value;
  store.set('chirp.lang', lang);
  document.documentElement.lang = lang;
  render();
};

// ---- Listening ----
$('start').onclick = async () => {
  $('start').disabled = true;
  try {
    await initAudio();
    await listen(onChirp, (level) => ($('level').style.width = `${Math.round(level * 100)}%`));
    $('start').classList.add('hidden');
    $('listening').classList.remove('hidden');
    keepScreenOn();
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
  let parsed;
  try {
    parsed = fromWire(text);
  } catch (err) {
    console.warn('ignored malformed chirp', err.message);
    return;
  }
  seen.add(text);
  const sender = verify(parsed.body, parsed.sig);
  const alert = unpackBody(parsed.body);
  history.unshift({ alert, sender: sender && { id: sender.id, name: sender.name }, wire: text, at: Date.now() });
  history = history.slice(0, 30);
  store.set('chirp.history', history);
  // Only verified alerts may buzz the phone.
  if (sender && navigator.vibrate) navigator.vibrate([400, 150, 400]);
  render();
}

// ---- Rendering ----
function alertCard(entry, { large }) {
  const d = describe(entry.alert, lang);
  const expired = entry.alert.expiresMin < nowMinutes();
  const until = new Date(entry.alert.expiresMin * 60000).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' });
  const cls = ['alert', entry.sender ? d.severity : 'unverified', expired ? 'expired' : ''].join(' ');
  const el = document.createElement('div');
  el.className = cls;
  if (!large) el.style.padding = '12px';
  el.innerHTML = `
    <div class="title" ${large ? '' : 'style="font-size:1.1rem"'}></div>
    <div class="detail"></div>
    <div class="meta"></div>
    <div class="warn"></div>`;
  el.querySelector('.title').textContent = `${d.icon} ${d.title}`;
  el.querySelector('.detail').textContent = d.detail;
  el.querySelector('.meta').textContent = [
    `📍 ${ui('area', lang)}: ${d.zone}`,
    expired ? ui('expired', lang) : `${ui('validUntil', lang)} ${until}`,
    entry.sender ? `✔ ${ui('verified', lang)}: ${entry.sender.name}` : '',
  ].filter(Boolean).join(' · ');
  el.querySelector('.warn').textContent = entry.sender ? '' : `⚠ ${ui('unverified', lang)}`;
  if (!large) el.querySelector('.detail').style.fontSize = '1rem';
  return el;
}

function render() {
  $('start').textContent = ui('start', lang);
  $('listening-text').textContent = ui('listening', lang);
  $('help').textContent = ui('needHelp', lang);
  $('call').querySelector('button').textContent = `📞 ${ui('callHelp', lang)}`;
  $('earlier').textContent = ui('earlier', lang);

  const [latest, ...rest] = history;
  $('current').replaceChildren(latest ? alertCard(latest, { large: true }) : '');
  $('actions').classList.toggle('hidden', !latest || !latest.sender);

  $('history').replaceChildren(
    ...(rest.length ? rest.map((e) => alertCard(e, { large: false })) : [Object.assign(document.createElement('div'), { className: 'muted', textContent: ui('noAlerts', lang) })]),
  );
  renderHelpStatus();
}

// ---- "I need help": queue on the phone, send when any connection returns ----
let outbox = store.get('chirp.outbox', []);

$('help').onclick = () => {
  const latest = history[0];
  outbox.push({ msgId: latest.alert.msgId, type: latest.alert.type, zone: latest.alert.zone, lang, at: Date.now() });
  store.set('chirp.outbox', outbox);
  renderHelpStatus();
  flushOutbox();
};

async function flushOutbox() {
  if (!HELP_ENDPOINT || !navigator.onLine || !outbox.length) return;
  const pending = [...outbox];
  for (const req of pending) {
    try {
      const res = await fetch(HELP_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
      if (!res.ok) break;
      outbox = outbox.filter((r) => r !== req);
      store.set('chirp.outbox', outbox);
      $('help-status').textContent = ui('helpSent', lang);
    } catch {
      break;
    }
  }
  renderHelpStatus();
}

function renderHelpStatus() {
  if (outbox.length) $('help-status').textContent = `${ui('helpQueued', lang)} (${outbox.length})`;
}

window.addEventListener('online', flushOutbox);

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
