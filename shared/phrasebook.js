// Loads phrasebook.json and zones.json and turns alert codes into text.
let book, zones;

export async function loadPhrasebook() {
  const base = new URL('./', import.meta.url);
  [book, zones] = await Promise.all([
    fetch(new URL('phrasebook.json', base)).then((r) => r.json()),
    fetch(new URL('zones.json', base)).then((r) => r.json()),
  ]);
  return { book, zones };
}

export const languages = () => book.languages;

export function pickDefaultLanguage() {
  for (const tag of navigator.languages || [navigator.language]) {
    const code = tag.slice(0, 2).toLowerCase();
    if (book.languages[code]) return code;
  }
  return 'en';
}

// Falls back to English if a phrase is missing in this language.
const pick = (texts, lang) => (texts && (texts[lang] ?? texts.en)) || '';

export const ui = (key, lang) => pick(book.ui[key], lang);

export function describe(alert, lang) {
  const type = book.types[alert.type];
  const detail = book.details[alert.detail];
  const zone = zones[alert.zone];
  return {
    known: Boolean(type),
    key: type ? type.key : `UNKNOWN_${alert.type}`,
    severity: type ? type.severity : 'moderate',
    icon: type ? type.icon : '❔',
    title: type ? pick(type.text, lang) : `Unknown alert (${alert.type})`,
    detail: detail ? pick(detail.text, lang) : '',
    zone: zone ? zone.name : `Zone ${alert.zone}`,
  };
}

export const types = () => book.types;
export const details = () => book.details;
export const allZones = () => zones;
