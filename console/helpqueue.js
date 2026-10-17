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
    const res = await fetch(`${SERVER}/alerts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wire }) });
    return res.ok ? 'phone line: ✔ acknowledged' : `phone line: ✖ refused (${await res.text()})`;
  } catch {
    return 'phone line: ✖ unreachable';
  }
}

export function startHelpQueue({ listEl, statusEl, listenBtn, store }) {
  const queue = store.get('chirp.console.help', []);
  const save = () => store.set('chirp.console.help', queue);

  function add(req, source) {
    const existing = queue.find((q) => helpKey(q) === helpKey(req));
    if (existing) {
      if (req.status === 'handled' && existing.status !== 'handled') Object.assign(existing, { status: 'handled', handledBy: req.handledBy });
      else return;
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
      const where = q.lat != null ? `${q.lat.toFixed(2)}, ${q.lon.toFixed(2)}` : (q.note || q.from || '—');
      const cells = [
        q.lifeThreat ? '🔴 LIFE THREAT' : q.vulnerable ? '🟠 VULNERABLE' : '⚪',
        `${NEEDS[q.need] || 'other'} · ${q.people || 1} people · ${q.lang || '?'}`,
        `${Math.max(0, nowMinutes() - (q.createdMin || nowMinutes()))} min ago`,
        where,
        `${q.source} · ${q.label}`,
      ];
      for (const text of cells) tr.appendChild(Object.assign(document.createElement('td'), { textContent: text }));
      const td = document.createElement('td');
      if (q.status === 'open') {
        const b = Object.assign(document.createElement('button'), { className: 'secondary', textContent: 'Handled by…' });
        b.onclick = () => handled(q);
        td.appendChild(b);
      } else td.textContent = `✔ ${q.handledBy || ''}`;
      tr.appendChild(td);
      return tr;
    }));
  }

  function handled(q) {
    const by = prompt('Your name (a person must close every help request):')?.trim();
    if (!by) return;
    Object.assign(q, { status: 'handled', handledBy: by });
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
