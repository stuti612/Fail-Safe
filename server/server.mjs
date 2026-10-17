// CHIRP help server: help queue + active alerts + Retell webhook/functions.
//   RETELL_API_KEY=... node server/server.mjs      (no key = MOCK mode, unsigned requests accepted)
// Endpoints (CORS open, JSON):
//   GET  /help                  ranked queue (Bearer CHIRP_SUPERVISOR_TOKEN if set)        POST /help        receiver "I need help"
//   POST /help/handled          {key, by}           POST /help/callback  {key}  call -> retry -> sms -> door knock           GET  /alerts?lang=es   text the phone agent reads
//   POST /alerts                {wire}  console publishes the signed alert it chirped (supervisor)
//   POST /retell/function       Retell custom functions: get_active_alerts, report_need
//   POST /retell/webhook        Retell call events
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createState, publishAlert, activeAlertsText, reportNeed, handleRetellWebhook, markHandled, rankedHelp, verifyRetell, pruneHelp, startCallback, callbackOutcome } from './core.mjs';
import { helpKey } from '../shared/help.js';

// ponytail: local demo server. Plain-JSON queue file, no auth on /help. Do not
// expose beyond the demo tunnel until it has auth + encrypted storage.
const PORT = Number(process.env.PORT) || 8787;
const KEY = process.env.RETELL_API_KEY || '';
// Supervisor routes (read queue, close requests) need this bearer token when set.
// Residents' POST /help and Retell's routes stay open (Retell is checked by signature).
const TOKEN = process.env.CHIRP_SUPERVISOR_TOKEN || '';
// Outbound callbacks need a Retell number; without one, MOCK callbacks never answer (shows the ladder).
const FROM = process.env.RETELL_FROM_NUMBER || '';
const RETRY_MS = KEY && FROM ? 60_000 : 3_000;
const FILE = new URL('./queue.json', import.meta.url);
const state = createState();
if (existsSync(FILE)) {
  // A corrupt queue must stop the server, not be silently replaced with an empty one.
  try { Object.assign(state, JSON.parse(readFileSync(FILE, 'utf8'))); } catch (err) {
    console.error(`server/queue.json is unreadable (${err.message}). Fix or move it; refusing to start so no help requests are lost.`);
    process.exit(1);
  }
}
// Help requests must survive a restart: write-then-rename on every change.
const save = () => { pruneHelp(state); writeFileSync(`${FILE.pathname}.tmp`, JSON.stringify(state)); renameSync(`${FILE.pathname}.tmp`, FILE); };
setInterval(() => { pruneHelp(state); save(); }, 10 * 60_000).unref();

let origin = '*';
const send = (res, code, body) => {
  const h = { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  res.writeHead(code, h);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const supervisor = (req) => !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`;

async function runCallback(h) {
  const step = h.callback?.step;
  if (step === 'sms') { // ponytail: no SMS provider wired; logged and skipped, never silently treated as reached
    h.callback.log.push(`${new Date().toISOString()} sms: no provider configured, skipped -> door knock`);
    h.callback.step = 'door knock';
    return save();
  }
  if (step !== 'call 1' && step !== 'call 2') return save();
  if (!(KEY && FROM)) {
    return setTimeout(() => { callbackOutcome(h, { disconnection_reason: 'dial_no_answer' }); runCallback(h); }, RETRY_MS);
  }
  try {
    const r = await fetch('https://api.retellai.com/v2/create-phone-call', {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_number: FROM, to_number: h.from, metadata: { helpKey: helpKey(h) } }),
    });
    if (!r.ok) throw new Error(`Retell ${r.status}`);
    save(); // outcome arrives on /retell/webhook
  } catch (err) {
    callbackOutcome(h, { disconnection_reason: 'dial_failed' });
    h.callback.log.push(`${new Date().toISOString()} ${err.message}`);
    setTimeout(() => runCallback(h), RETRY_MS);
  }
}

createServer(async (req, res) => {
  // With a token set, never wildcard CORS: echo the caller's origin (the token is the gate).
  origin = TOKEN ? (req.headers.origin || '') : '*';
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://x');
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return send(res, 413, 'too large'); }
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, 'bad json'); }
  const retell = url.pathname.startsWith('/retell/');
  if (retell && KEY && !verifyRetell(raw, req.headers['x-retell-signature'], KEY)) return send(res, 401, 'bad signature');
  try {
    const route = `${req.method} ${url.pathname}`;
    if (['GET /help', 'POST /help/handled', 'POST /help/callback', 'POST /alerts'].includes(route) && !supervisor(req)) return send(res, 401, 'supervisor token required');
    if (route === 'GET /help') return send(res, 200, rankedHelp(state));
    if (route === 'POST /help') { const r = reportNeed(state, body, { source: 'app' }); save(); return send(res, 200, r); }
    if (route === 'POST /help/handled') return markHandled(state, body.key, body.by) ? (save(), send(res, 200, { ok: true })) : send(res, 400, 'need key and a person\'s name');
    if (route === 'POST /help/callback') {
      const h = state.help.find((x) => helpKey(x) === body.key);
      if (!h) return send(res, 404, 'no such request');
      const step = startCallback(h);
      runCallback(h);
      return send(res, 200, { step, mock: !(KEY && FROM) });
    }
    if (route === 'GET /alerts') return send(res, 200, activeAlertsText(state, url.searchParams.get('lang') || 'en'));
    if (route === 'POST /alerts') { const a = publishAlert(state, String(body.wire || '')); save(); return send(res, 200, a); }
    if (route === 'POST /retell/function') {
      const args = body.args || {};
      if (body.name === 'get_active_alerts') return send(res, 200, activeAlertsText(state, args.language));
      if (body.name === 'report_need') {
        const r = reportNeed(state, args, { source: KEY ? 'phone' : 'phone (mock)', callId: body.call?.call_id, from: body.call?.from_number });
        save();
        return send(res, 200, r.reply);
      }
      return send(res, 404, `unknown function ${body.name}`);
    }
    if (route === 'POST /retell/webhook') {
      const r = handleRetellWebhook(state, body);
      if (r.help) setTimeout(() => runCallback(r.help), r.step === 'call 2' ? RETRY_MS : 0);
      else save();
      return send(res, 204, '');
    }
    send(res, 404, 'not found');
  } catch (err) {
    send(res, 400, err.message);
  }
}).listen(PORT, () => console.log(`CHIRP help server on :${PORT} (${KEY ? 'Retell signatures enforced' : 'MOCK mode: no RETELL_API_KEY, unsigned Retell requests accepted'})`));
