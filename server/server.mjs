// CHIRP help server: help queue + active alerts + Retell webhook/functions.
//   RETELL_API_KEY=... node server/server.mjs      (no key = MOCK mode, unsigned requests accepted)
// Endpoints (CORS open, JSON):
//   GET  /help                  ranked queue        POST /help        receiver "I need help"
//   POST /help/handled          {key, by}           GET  /alerts?lang=es   text the phone agent reads
//   POST /alerts                {wire}  console publishes the signed alert it chirped
//   POST /retell/function       Retell custom functions: get_active_alerts, report_need
//   POST /retell/webhook        Retell call events
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createState, publishAlert, activeAlertsText, reportNeed, handleRetellWebhook, markHandled, rankedHelp, verifyRetell } from './core.mjs';

const PORT = Number(process.env.PORT) || 8787;
const KEY = process.env.RETELL_API_KEY || '';
const FILE = new URL('./queue.json', import.meta.url);
const state = createState();
try { Object.assign(state, JSON.parse(readFileSync(FILE, 'utf8'))); } catch {}
// Help requests must survive a restart: write-then-rename on every change.
const save = () => { writeFileSync(`${FILE.pathname}.tmp`, JSON.stringify(state)); renameSync(`${FILE.pathname}.tmp`, FILE); };

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

createServer(async (req, res) => {
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
    if (route === 'GET /help') return send(res, 200, rankedHelp(state));
    if (route === 'POST /help') { const r = reportNeed(state, body, { source: 'app' }); save(); return send(res, 200, r); }
    if (route === 'POST /help/handled') return markHandled(state, body.key, body.by) ? (save(), send(res, 200, { ok: true })) : send(res, 400, 'need key and a person\'s name');
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
    if (route === 'POST /retell/webhook') { const r = handleRetellWebhook(state, body); if (r.queued) save(); return send(res, 204, ''); }
    send(res, 404, 'not found');
  } catch (err) {
    send(res, 400, err.message);
  }
}).listen(PORT, () => console.log(`CHIRP help server on :${PORT} (${KEY ? 'Retell signatures enforced' : 'MOCK mode: no RETELL_API_KEY, unsigned Retell requests accepted'})`));
