// CHIRP help server: help queue + active alerts + Retell webhook/functions.
//   RETELL_API_KEY=... node server/server.mjs      (no key = MOCK mode, unsigned requests accepted)
// Endpoints (JSON; browser origin must be explicitly configured):
//   GET  /help                  ranked queue (Bearer CHIRP_SUPERVISOR_TOKEN required)       POST /help        receiver "I need help"
//   POST /help/handled          {key, by}           POST /help/callback  {key}  call -> retry -> sms -> door knock           GET  /alerts?lang=es   text the phone agent reads
//   POST /alerts                {wire}  console publishes the signed alert it chirped (supervisor)
//   POST /retell/function       Retell custom functions: get_active_alerts, report_need
//   POST /retell/webhook        Retell call events
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createState, publishAlert, activeAlertsText, reportNeed, handleRetellWebhook, markHandled, rankedHelp, verifyRetell, pruneHelp, startCallback, callbackOutcome } from './core.mjs';
import { helpKey } from '../shared/help.js';

// Local demo server with a plain-JSON queue. Do not expose beyond localhost:
// the queue is not encrypted or staffed, even when a supervisor token is set.
const PORT = Number(process.env.PORT) || 8787;
const KEY = process.env.RETELL_API_KEY || '';
// Supervisor routes require this bearer token; without it they are unavailable.
// Residents' POST /help and Retell's routes stay open (Retell is checked by signature when configured).
const TOKEN = process.env.CHIRP_SUPERVISOR_TOKEN || '';
const APP_ORIGIN = process.env.CHIRP_APP_ORIGIN || '';
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

const send = (req, res, code, body) => {
  const h = { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (APP_ORIGIN && req.headers.origin === APP_ORIGIN) h['Access-Control-Allow-Origin'] = APP_ORIGIN;
  res.writeHead(code, h);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const supervisor = (req) => TOKEN && req.headers.authorization === `Bearer ${TOKEN}`;

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
  if (req.method === 'OPTIONS') return send(req, res, req.headers.origin === APP_ORIGIN && APP_ORIGIN ? 204 : 403, '');
  if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(req, res, 415, 'application/json required');
  const url = new URL(req.url, 'http://x');
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return send(req, res, 413, 'too large'); }
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { return send(req, res, 400, 'bad json'); }
  const retell = url.pathname.startsWith('/retell/');
  if (retell && KEY && !verifyRetell(raw, req.headers['x-retell-signature'], KEY)) return send(req, res, 401, 'bad signature');
  try {
    const route = `${req.method} ${url.pathname}`;
    if (['GET /help', 'POST /help/handled', 'POST /help/callback', 'POST /alerts'].includes(route) && !TOKEN) return send(req, res, 503, 'supervisor token not configured');
    if (['GET /help', 'POST /help/handled', 'POST /help/callback', 'POST /alerts'].includes(route) && !supervisor(req)) return send(req, res, 401, 'supervisor token required');
    if (route === 'GET /help') return send(req, res, 200, rankedHelp(state));
    if (route === 'POST /help') { const r = reportNeed(state, body, { source: 'app' }); save(); return send(req, res, 200, r); }
    if (route === 'POST /help/handled') return markHandled(state, body.key, body.by) ? (save(), send(req, res, 200, { ok: true })) : send(req, res, 400, 'need key and a person\'s name');
    if (route === 'POST /help/callback') {
      const h = state.help.find((x) => helpKey(x) === body.key);
      if (!h) return send(req, res, 404, 'no such request');
      const step = startCallback(h);
      runCallback(h);
      return send(req, res, 200, { step, mock: !(KEY && FROM) });
    }
    if (route === 'GET /alerts') return send(req, res, 200, activeAlertsText(state, url.searchParams.get('lang') || 'en'));
    if (route === 'POST /alerts') { const a = publishAlert(state, String(body.wire || '')); save(); return send(req, res, 200, a); }
    if (route === 'POST /retell/function') {
      const args = body.args || {};
      if (body.name === 'get_active_alerts') return send(req, res, 200, activeAlertsText(state, args.language));
      if (body.name === 'report_need') {
        const r = reportNeed(state, args, { source: KEY ? 'phone' : 'phone (mock)', callId: body.call?.call_id, from: body.call?.from_number });
        save();
        return send(req, res, 200, r.reply);
      }
      return send(req, res, 404, `unknown function ${body.name}`);
    }
    if (route === 'POST /retell/webhook') {
      const r = handleRetellWebhook(state, body);
      if (r.help) setTimeout(() => runCallback(r.help), r.step === 'call 2' ? RETRY_MS : 0);
      else save();
      return send(req, res, 204, '');
    }
    send(req, res, 404, 'not found');
  } catch (err) {
    send(req, res, 400, err.message);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`CHIRP local help server on 127.0.0.1:${PORT} (${KEY ? 'Retell signatures enforced' : 'MOCK mode: no RETELL_API_KEY, unsigned Retell requests accepted'})`));
