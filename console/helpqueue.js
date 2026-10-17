// Console HELP QUEUE (ASK -> HAND TO A PERSON). Sources: reply chirps heard by
// this console's mic, plus the help server (app POSTs and Retell calls) when
// HELP_ENDPOINT is set. Every entry is an "unverified resident report"; only a
// named person can mark one handled. Nothing is auto-dismissed.
import { initAudio, listen } from '../shared/audio.js';
import { nowMinutes } from '../shared/payload.js';
import { decodeHelp, enqueueHelp, rankHelp, helpKey, NEEDS } from '../shared/help.js';
import { HELP_ENDPOINT } from '../shared/config.js';

const SERVER = HELP_ENDPOINT.replace(/\/help\/?$/, '');
// Supervisor token (server CHIRP_SUPERVISOR_TOKEN), asked once, kept for this tab only.
const auth = () => { try { return { Authorization: `Bearer ${sessionStorage.getItem('chirp.token') || ''}` }; } catch { return {}; } };
let asked = false;
async function supervisorFetch(url, opts = {}) {
  let res = await fetch(url, { ...opts, headers: { ...opts.headers, ...auth() } });
  if (res.status === 401 && !asked) {
    asked = true; // ask once; reload the page to retry
    const t = prompt('Supervisor token for the help server:');
    if (!t) return res;
    try { sessionStorage.setItem('chirp.token', t.trim()); } catch {}
    res = await fetch(url, { ...opts, headers: { ...opts.headers, ...auth() } });
  }
  return res;
}

// Lets the phone line (Retell) read out the alert we just chirped.
// Resolves to a short status for the operator: acknowledged, refused, or unreachable.
export async function publishToServer(wire) {
  if (!SERVER) return 'phone line: not configured';
  try {
    const res = await supervisorFetch(`${SERVER}/alerts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wire }) });
    return res.ok ? 'phone line: ✔ acknowledged' : `phone line: ✖ refused (${await res.text()})`;
  } catch {
    return 'phone line: ✖ unreachable';
  }
}

export function startHelpQueue({ listEl, statusEl, listenBtn, store }) {
  // Same retention as the server: handled entries lose personal details after 1 h, all go after 24 h.
  const prune = (q) => q.filter((h) => h && Date.now() - (h.heardAt || 0) < 24 * 3600_000).map((h) =>
    h.status !== 'open' && Date.now() - (h.handledAt || h.heardAt || 0) > 3600_000 ? { ...h, note: '', from: null, lat: null, lon: null } : h);
  const loaded = store.get('chirp.console.help', []);
  const queue = prune(Array.isArray(loaded) ? loaded : []);
  const save = () => { queue.splice(0, queue.length, ...prune(queue)); store.set('chirp.console.help', queue); };

  function add(req, source) {
    const existing = queue.find((q) => helpKey(q) === helpKey(req));
    if (existing) {
      const changed = JSON.stringify([existing.status, existing.callback, existing.lifeThreat]) !== JSON.stringify([req.status ?? existing.status, req.callback ?? existing.callback, req.lifeThreat || existing.lifeThreat]);
      if (!changed) return;
      Object.assign(existing, { status: req.status ?? existing.status, handledBy: req.handledBy ?? existing.handledBy, callback: req.callback ?? existing.callback, lifeThreat: req.lifeThreat || existing.lifeThreat });
    } else {
      enqueueHelp(queue, { label: 'unverified resident report', status: 'open', heardAt: Date.now(), ...req, source: req.source || source });
    }
    save();
    render();
  }

  function render() {
    const open = rankHelp(queue.filter((q) => q.status === 'open'));
    const done = queue.filter((q) => q.status !== 'open');
    statusEl.textContent = `${open.length} open · ${done.length} handled`;
    listEl.replaceChildren(...[...open, ...done].map((q) => {
      const tr = document.createElement('tr');
      if (q.status !== 'open') tr.style.opacity = '0.5';
      const lat = Number(q.lat), lon = Number(q.lon);
      const where = q.lat != null && Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(2)}, ${lon.toFixed(2)}` : (q.note || q.from || '—');
      const cells = [
        q.lifeThreat ? '🔴 LIFE THREAT' : q.vulnerable ? '🟠 VULNERABLE' : '⚪',
        `${NEEDS[q.need] || 'other'} · ${q.people || 1} people · ${q.lang || '?'}`,
        `${Math.max(0, nowMinutes() - (q.createdMin || nowMinutes()))} min ago`,
        where,
        `${q.source} · ${q.label}${q.callback ? ` · 📞 ${q.callback.step === 'door knock' ? '🚪 DOOR KNOCK NEEDED' : q.callback.step}` : ''}`,
      ];
      for (const text of cells) tr.appendChild(Object.assign(document.createElement('td'), { textContent: text }));
      const td = document.createElement('td');
      if (q.status === 'open') {
        const b = Object.assign(document.createElement('button'), { className: 'secondary', textContent: 'Handled by…' });
        b.onclick = () => handled(q);
        td.appendChild(b);
        if (SERVER && q.source !== 'sound' && !q.callback) {
          const c = Object.assign(document.createElement('button'), { className: 'secondary', textContent: q.from ? 'Call back' : 'Escalate' });
          c.title = 'Call -> retry -> SMS -> door knock. No answer is never treated as OK.';
          c.onclick = () => supervisorFetch(`${SERVER}/help/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: helpKey(q) }) })
            .then((r) => r.json()).then((r) => { q.callback = { step: r.step, log: [] }; save(); render(); }).catch(() => (statusEl.textContent = 'Callback failed: server unreachable'));
          td.appendChild(c);
        }
      } else td.textContent = `✔ ${q.handledBy || ''}`;
      tr.appendChild(td);
      return tr;
    }));
  }

  function handled(q) {
    const by = prompt('Your name (a person must close every help request):')?.trim();
    if (!by) return;
    Object.assign(q, { status: 'handled', handledBy: by, handledAt: Date.now() });
    save();
    render();
    if (SERVER) supervisorFetch(`${SERVER}/help/handled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: helpKey(q), by }) }).catch(() => {});
  }

  listenBtn.onclick = async () => {
    listenBtn.disabled = true;
    try {
      await initAudio();
      await listen((text) => { const r = decodeHelp(text); if (r) add(r, 'sound'); });
      listenBtn.textContent = '👂 Listening for help chirps';
    } catch (err) {
      listenBtn.disabled = false;
      statusEl.textContent = `Mic error: ${err.message}`;
    }
  };

  if (SERVER) {
    const poll = () => supervisorFetch(`${SERVER}/help`).then((r) => (r.ok ? r.json() : [])).then((items) => items.forEach((i) => add(i, 'server'))).catch(() => {});
    poll();
    setInterval(poll, 5000);
  }
  render();
  setInterval(render, 60000); // keep "min ago" fresh
}
