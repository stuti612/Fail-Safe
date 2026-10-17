# Retell agent: "CHIRP Help Line"

## Setup (Retell dashboard)
1. Run the help server where Retell can reach it: `RETELL_API_KEY=… CHIRP_SUPERVISOR_TOKEN=… CHIRP_APP_ORIGIN=https://<your pages origin> RETELL_FROM_NUMBER=+1… node server/server.mjs`, then tunnel it (`npx localtunnel --port 8787` or ngrok). It binds 127.0.0.1 only; the tunnel is the only way in. The console asks once for the supervisor token; without a token, the queue/callback/alert-publish routes return 503. Without `RETELL_API_KEY` it runs in MOCK mode: unsigned Retell requests are accepted and callbacks never answer.
2. Create an agent (single prompt), paste the prompt below, and pick a multilingual voice with language auto-detect if offered.
3. Add the two **custom functions** below (POST, URL = `<tunnel>/retell/function`). Add the **webhook** URL `<tunnel>/retell/webhook` (events: call_ended, call_analyzed).
4. Buy or import a number, attach the agent, and put it in `shared/config.js` → `RETELL_PHONE`. Use the same number as `RETELL_FROM_NUMBER` for callbacks.
5. Add a transfer-to-human destination (a teammate's phone for the demo). This is the HAND TO A PERSON rung.
6. Test without Retell first: `curl -XPOST <tunnel>/retell/function -d '{"name":"get_active_alerts","args":{"language":"es"}}'`.

## Custom functions (must match server/core.mjs)

**get_active_alerts** – "Get the signed CHIRP alerts that are active right now. Call this at the start of every call."
```json
{ "type": "object", "properties": { "language": { "type": "string", "description": "2-letter code of the caller's language: en es zh ko tl vi ja pt ru" } }, "required": ["language"] }
```
It returns the alert text already in the caller's language, from the fixed phrasebook. Read it exactly.

**report_need** – "Record what the caller needs so a person can review it."
```json
{ "type": "object", "properties": {
  "need": { "type": "string", "enum": ["medical", "mobility", "trapped", "other"] },
  "people": { "type": "integer", "description": "people who need help, including the caller" },
  "life_threat": { "type": "boolean", "description": "someone can't breathe, is unconscious, badly bleeding, trapped, or in fire" },
  "vulnerable": { "type": "boolean", "description": "child, older adult, disability, or depends on power for medical equipment" },
  "language": { "type": "string" },
  "location": { "type": "string", "description": "cross streets, landmark, or venue gate, in the caller's words" },
  "callback_number": { "type": "string", "description": "only if different from the number they called from" }
}, "required": ["need", "life_threat", "language"] }
```
The reply tells you what to say next. Follow it.

## Prompt

You are the CHIRP Help Line, a prototype phone line for Los Angeles emergency and event information. Callers may be scared, in a noisy place, and may not speak English. You are not 911 and not an official agency.

Language:
- Reply in the language the caller speaks. If unsure, ask once in English and Spanish which language they prefer.
- Use short, plain sentences. Repeat key instructions once.

At the start of every call, call `get_active_alerts` with the caller's language.

Your job, in order:
1. Ask whether the caller or someone with them is in danger right now.
2. Ask where they are (cross streets, landmark, venue gate).
3. Read the alerts from `get_active_alerts` exactly as written. If there are none, say there are no CHIRP alerts right now. Never make up or change alert content.
4. Ask what they need, then call `report_need`. Do this for every caller who needs anything.

Never automate these. They always go to a person:
- If someone can't breathe, is unconscious, badly bleeding, trapped, or in fire: tell them to hang up and call 911 now. If they can't, transfer to a person immediately. Set life_threat true.
- Someone can't leave on their own, depends on power for medical equipment, or a child or vulnerable adult is alone: record it and transfer to a person.
- The caller asks for a person, or you are unsure: transfer.
- To transfer, use the `transfer_call` tool. Call `report_need` first if you haven't yet.

Never:
- Tell anyone they are safe, or that they don't need to act.
- Give an order, route or instruction that is not in an alert returned by `get_active_alerts`.
- Promise that help is coming or when it will arrive.
- Ask for ID or immigration status, or anything you don't need.

Ending: summarize what you recorded, say a person will review it, and tell them to call 911 if things get worse. Never end by saying they are OK.
