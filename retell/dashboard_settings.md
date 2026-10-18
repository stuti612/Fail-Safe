# Retell dashboard settings: "CHIRP Help Line"

The live agent's settings, as configured in the Retell dashboard on Sat Oct 17. The prompt and the function schemas are in [`agent_prompt.md`](agent_prompt.md).

| Setting | Value |
|---|---|
| Agent type | Voice agent, Single Prompt |
| Prompt | The "Prompt" section of `agent_prompt.md`, unchanged |
| Languages | Multiselect: English (US), Spanish (Latin America) |
| Voice | Cimo (Retell platform voice) |
| Welcome message | AI speaks first, custom: `CHIRP help line. Is anyone in danger right now? ¿Habla español?` |
| Boosted keywords | Coliseum, SoFi, Altadena, Palisades, Metro, Union Station, Gate C, Gate D, CHIRP |
| Agent webhook | `<tunnel>/retell/webhook`, default events (call_started, call_ended, call_analyzed) |
| Phone number | +1 213-802-0730 (Twilio via Retell), inbound and outbound agent = CHIRP Help Line |

## Functions

| Name | Type | Settings |
|---|---|---|
| `get_active_alerts` | Custom function | POST `<tunnel>/retell/function`, timeout 10 s, 0 retries, wait for completion, "Payload: args only" off. Schema in `agent_prompt.md` |
| `report_need` | Custom function | Same as above. Schema in `agent_prompt.md` |
| `transfer_call` | Call Transfer | Static destination: a teammate's phone. Cold transfer, caller ID = the agent's number, 30 s ring. "Talk while waiting" in **Prompt** mode: `In the caller's language, say in one short sentence that you are connecting them to a person and they should stay on the line. Do not say help is coming.` |

`<tunnel>` is the cloudflared URL of `server/server.mjs`. It changes whenever cloudflared restarts, so update both function URLs and the webhook each time.

## How it was tested
- Browser test calls (Test Audio) in English and Spanish: the agent called `get_active_alerts` and `report_need`, and each request landed in the help queue with Retell's signature verified (`source: phone`, language `en` / `es`).
- Call transfer can't run in browser test calls (Retell limitation), so it needs a real call to the number.
- Dashboard "Test" button for a custom function sends the name `test_tool`, which our server rejects as unknown. That's expected; real calls send the real name.
