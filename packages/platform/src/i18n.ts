export const LOCALES = ['en', 'de', 'sk', 'hu', 'es'] as const;
export type Locale = typeof LOCALES[number];
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', de: 'Deutsch', sk: 'Slovenčina', hu: 'Magyar', es: 'Español' };
export function normalizeLocale(value: string | null | undefined): Locale {
  const code = value?.toLowerCase().split(/[-_]/)[0];
  return code === 'esp' ? 'es' : LOCALES.includes(code as Locale) ? code as Locale : 'en';
}
const messages = {
  en: { save: 'Save', cancel: 'Cancel', delete: 'Delete', search: 'Search', loading: 'Loading…', retry: 'Try again', language: 'Language', close: 'Close', open: 'Open', next: 'Next', back: 'Back' },
  de: { save: 'Speichern', cancel: 'Abbrechen', delete: 'Löschen', search: 'Suchen', loading: 'Wird geladen…', retry: 'Erneut versuchen', language: 'Sprache', close: 'Schließen', open: 'Öffnen', next: 'Weiter', back: 'Zurück' },
  sk: { save: 'Uložiť', cancel: 'Zrušiť', delete: 'Odstrániť', search: 'Hľadať', loading: 'Načítava sa…', retry: 'Skúsiť znova', language: 'Jazyk', close: 'Zavrieť', open: 'Otvoriť', next: 'Ďalej', back: 'Späť' },
  hu: { save: 'Mentés', cancel: 'Mégse', delete: 'Törlés', search: 'Keresés', loading: 'Betöltés…', retry: 'Újrapróbálkozás', language: 'Nyelv', close: 'Bezárás', open: 'Megnyitás', next: 'Tovább', back: 'Vissza' },
  es: { save: 'Guardar', cancel: 'Cancelar', delete: 'Eliminar', search: 'Buscar', loading: 'Cargando…', retry: 'Reintentar', language: 'Idioma', close: 'Cerrar', open: 'Abrir', next: 'Siguiente', back: 'Atrás' },
} satisfies Record<Locale, Record<string, string>>;
export type MessageKey = keyof typeof messages.en;
export function translate(locale: Locale, key: MessageKey): string { return messages[locale][key]; }
const KEY = 'sorye:locale';
const EVENT = 'sorye:locale-change';
let selected: Locale | undefined;
export function getLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  if (selected) return selected;
  try { return normalizeLocale(localStorage.getItem(KEY) ?? navigator.language); } catch { return normalizeLocale(navigator.language); }
}
export function setLocale(locale: Locale): void {
  selected = normalizeLocale(locale);
  try { localStorage.setItem(KEY, selected); } catch { /* Still usable without storage. */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: selected }));
}
export function subscribeLocale(listener: () => void): () => void {
  const change = (event: Event) => { selected = normalizeLocale((event as CustomEvent<string>).detail); listener(); };
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { selected = undefined; listener(); } };
  window.addEventListener(EVENT, change);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, change); window.removeEventListener('storage', storage); };
}
