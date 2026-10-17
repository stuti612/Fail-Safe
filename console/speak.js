// Spoken fallback for people without the app: reads the alert aloud from the
// fixed phrasebook text with the OS voices. speechSynthesis works offline where
// local voices are installed; languages with no voice are skipped and reported.
import { describe } from '../shared/phrasebook.js';

const synth = globalThis.speechSynthesis;
synth?.getVoices(); // Chrome loads voices lazily; warm up before the first tap.

const PREFIXES = { tl: ['tl', 'fil'] };

function voiceFor(lang) {
  const ok = (synth?.getVoices() || []).filter((v) =>
    (PREFIXES[lang] || [lang]).some((p) => v.lang.toLowerCase().startsWith(p)));
  return ok.find((v) => v.localService) || ok[0] || null;
}

// Resolves to { seconds, spoken: [langs], skipped: [langs with no voice] }.
export async function speakAlert(alert, langs) {
  const start = performance.now();
  const spoken = [], skipped = [];
  for (const lang of langs) {
    const voice = voiceFor(lang);
    if (!voice) { skipped.push(lang); continue; }
    const d = describe(alert, lang);
    const u = new SpeechSynthesisUtterance([d.title, d.detail, d.zone].filter(Boolean).join('. '));
    u.voice = voice;
    u.lang = voice.lang;
    await new Promise((resolve) => { u.onend = u.onerror = resolve; synth.speak(u); });
    spoken.push(lang);
  }
  return { seconds: (performance.now() - start) / 1000, spoken, skipped };
}
