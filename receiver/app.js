// CHIRP receiver: listens for chirps, verifies them, shows them in the
// phone's language. Works fully offline once loaded.
import { initAudio, listen } from '../shared/audio.js';
import { nowMinutes } from '../shared/payload.js';
import { loadPhrasebook, languages, pickDefaultLanguage, ui, describe } from '../shared/phrasebook.js';
import { RETELL_PHONE } from '../shared/config.js';
import { verifiedDemoWire } from '../shared/demo-policy.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

await loadPhrasebook();
let lang = store.get('chirp.lang', null) || pickDefaultLanguage();
if (!['en', 'es'].includes(lang)) lang = 'en';
const restore = (h) => {
  if (typeof h?.wire !== 'string') return null;
  const valid = verifiedDemoWire(h.wire, nowMinutes());
  return valid && { ...valid, at: Number.isFinite(h.at) ? h.at : Date.now() };
};
let history = (Array.isArray(store.get('chirp.history', [])) ? store.get('chirp.history', []) : [])
  .map(restore).filter(Boolean).slice(0, 30);
store.set('chirp.history', history);
const seen = new Set(history.map((h) => h.wire));

// ---- Language ----
for (const [code, info] of Object.entries(languages())) {
  if (!['en', 'es'].includes(code)) continue;
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
  const valid = verifiedDemoWire(text, nowMinutes());
  if (!valid) {
    console.warn('ignored untrusted, expired or out-of-scope demo chirp');
    return;
  }
  seen.add(text);
  history.unshift({ ...valid, at: Date.now() });
  history = history.slice(0, 30);
  store.set('chirp.history', history);
  if (navigator.vibrate) navigator.vibrate([400, 150, 400]);
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
    lang === 'es' ? `✔ Firma de prueba: ${entry.sender.name}` : `✔ Demo signature: ${entry.sender.name}`,
  ].filter(Boolean).join(' · ');
  el.querySelector('.warn').textContent = lang === 'es'
    ? 'SOLO PRUEBA. No actúe según esta demostración; consulte al personal del lugar. Traducción sin revisión profesional.'
    : 'TEST ONLY. Do not act on this demo; ask venue staff.';
  if (!large) el.querySelector('.detail').style.fontSize = '1rem';
  return el;
}

function render() {
  $('start').textContent = ui('start', lang);
  $('listening-text').textContent = ui('listening', lang);
  $('help').textContent = lang === 'es' ? 'Guardar nota de ayuda aquí' : 'Save help note on this phone';
  $('call').querySelector('button').textContent = `📞 ${ui('callHelp', lang)}`;
  $('earlier').textContent = ui('earlier', lang);

  history = history.map(restore).filter(Boolean);
  store.set('chirp.history', history);
  const [latest, ...rest] = history;
  $('current').replaceChildren(latest ? alertCard(latest, { large: true }) : '');
  $('actions').classList.toggle('hidden', !latest || !latest.sender);

  $('history').replaceChildren(
    ...(rest.length ? rest.map((e) => alertCard(e, { large: false })) : [Object.assign(document.createElement('div'), { className: 'muted', textContent: ui('noAlerts', lang) })]),
  );
  renderHelpStatus();
}

// ---- "I need help": local draft only; no dispatch channel is configured ----
let outbox = store.get('chirp.outbox', []);

$('help').onclick = () => {
  const latest = history[0];
  outbox.push({ msgId: latest.alert.msgId, type: latest.alert.type, zone: latest.alert.zone, lang, at: Date.now() });
  store.set('chirp.outbox', outbox);
  renderHelpStatus();
};

function renderHelpStatus() {
  $('help-status').textContent = outbox.length
    ? (lang === 'es' ? `Guardado solo en este teléfono — NO ENTREGADO (${outbox.length})` : `Saved on this phone only — NOT DELIVERED (${outbox.length})`)
    : '';
}

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
setInterval(render, 30000);
