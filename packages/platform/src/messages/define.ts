export type Locale = 'en' | 'de' | 'sk' | 'hu' | 'es';
export type TranslatedLocale = Exclude<Locale, 'en'>;

/**
 * One namespace of UI strings. English is the source of truth; every other
 * locale must define exactly the same keys, so a missing or extra translation
 * is a compile error instead of a silent English fallback.
 *
 * Placeholders use `{name}` and are filled by `t(key, { name })`.
 */
export function defineMessages<const En extends Record<string, string>>(
  en: En,
  others: Record<TranslatedLocale, { [Key in keyof En]: string }>,
): Record<Locale, { [Key in keyof En]: string }> {
  return { en, ...others };
}
