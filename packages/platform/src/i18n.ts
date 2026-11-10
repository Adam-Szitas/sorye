import { messages, type MessageKey } from './messages';
export const LOCALES = ['en', 'de', 'sk', 'hu', 'es'] as const;
export type Locale = typeof LOCALES[number];
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', de: 'Deutsch', sk: 'Slovenčina', hu: 'Magyar', es: 'Español' };
export function normalizeLocale(value: string | null | undefined): Locale {
  const code = value?.toLowerCase().split(/[-_]/)[0];
  return code === 'esp' ? 'es' : LOCALES.includes(code as Locale) ? code as Locale : 'en';
}
export type { MessageKey } from './messages';
export type MessageParams = Record<string, string | number>;
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const text = messages[locale]?.[key] ?? messages.en[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text;
}
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
