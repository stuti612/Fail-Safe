// Range logger: counts decoded test patterns per run, with distance/noise labels.
import { initAudio, listen } from '../shared/audio.js';
import { parsePattern, toCsv } from './pattern.js';

const $ = (id) => document.getElementById(id);
const load = () => { try { return JSON.parse(localStorage.getItem('chirp.range')) || []; } catch { return []; } };
const save = () => { try { localStorage.setItem('chirp.range', JSON.stringify(rows)); } catch {} };
let rows = load();
$('device').value = navigator.userAgent.match(/\(([^)]+)\)/)?.[1] || '';

function onText(text) {
  const p = parsePattern(text);
  if (!p) return;
  // A run is (run id) heard within 10 minutes; labels are frozen at its first pattern.
  let row = rows.find((r) => r.run === p.run && Date.now() - r.at < 600_000);
  if (!row) {
    row = { at: Date.now(), time: new Date().toLocaleTimeString(), run: p.run, protocol: $('protocol').value, distance: $('distance').value, noise: $('noise').value, device: $('device').value, sent: Number($('sent').value) || 10, seqs: [] };
    rows.unshift(row);
  }
  if (!row.seqs.includes(p.seq)) row.seqs.push(p.seq);
  row.received = row.seqs.length;
  $('live').textContent = `Run ${p.run}: pattern ${p.seq} decoded (${row.received}/${row.sent})`;
  save();
  render();
}

function render() {
  $('runs').replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    for (const v of [r.time, r.run, r.protocol, `${r.distance} m`, r.noise, `${r.received}/${r.sent} (${Math.round((100 * r.received) / r.sent)}%)`]) {
      tr.appendChild(Object.assign(document.createElement('td'), { textContent: v }));
    }
    return tr;
  }));
}

$('listen').onclick = async () => {
  $('listen').disabled = true;
  try {
    await initAudio();
    await listen(onText, (l) => ($('level').style.width = `${Math.round(l * 100)}%`));
    $('listen').textContent = '👂 Listening…';
    await navigator.wakeLock?.request('screen').catch(() => {});
  } catch (err) {
    $('listen').disabled = false;
    $('live').textContent = `Mic error: ${err.message}`;
  }
};

$('csv').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
  a.download = `chirp-range-${new Date().toISOString().slice(0, 16)}.csv`;
  a.click();
};
$('clear').onclick = () => { if (confirm('Delete all range results on this phone?')) { rows = []; save(); render(); } };

render();
