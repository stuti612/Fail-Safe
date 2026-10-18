// Deployment settings. Fill these in once the services exist.

// Retell AI phone number for "Call for help in my language" (E.164, e.g. +12135550100).
export const RETELL_PHONE = '+12138020730';

// Where "I need help" requests are POSTed (server/server.mjs, e.g. https://<tunnel>/help).
// Empty = keep them on the phone and say NOT DELIVERED.
export const HELP_ENDPOINT = 'https://exception-tons-operating-scout.trycloudflare.com/help';

// STRICT_DEMO: Codex's TEST-only scope (one signed Coliseum Gate C TEST code,
// 1-minute validity, en/es only, CAP preview-only). Default off per user decision;
// turn on for a page with ?strict=1.
export const STRICT_DEMO = new URLSearchParams(globalThis.location?.search || '').has('strict');
