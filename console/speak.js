// Spoken fallback for people without the app: reads the alert aloud from the
// fixed phrasebook text with the OS voices. Only on-device (localService)
// voices are used, so it keeps working offline; languages without one are
// reported as skipped, and synthesis errors are reported as failed.
import { describe } from '../shared/phrasebook.js';

const synth = globalThis.speechSynthesis;
synth?.getVoices(); // Chrome loads voices lazily; warm up before the first tap.

const PREFIXES = { tl: ['tl', 'fil'] };

const voiceFor = (lang) => (synth?.getVoices() || []).find((v) =>
  v.localService && (PREFIXES[lang] || [lang]).some((p) => v.lang.toLowerCase().startsWith(p))) || null;

// Resolves to { seconds, spoken, skipped (no local voice), failed (synthesis error) }.
export async function speakAlert(alert, langs) {
  const start = performance.now();
  const spoken = [], skipped = [], failed = [];
  for (const lang of langs) {
    const voice = voiceFor(lang);
    if (!voice) { skipped.push(lang); continue; }
    const d = describe(alert, lang);
    const u = new SpeechSynthesisUtterance([d.title, d.detail, d.zone].filter(Boolean).join('. '));
    u.voice = voice;
    u.lang = voice.lang;
    const ok = await new Promise((resolve) => { u.onend = () => resolve(true); u.onerror = () => resolve(false); synth.speak(u); });
    (ok ? spoken : failed).push(lang);
  }
  return { seconds: (performance.now() - start) / 1000, spoken, skipped, failed };
}
