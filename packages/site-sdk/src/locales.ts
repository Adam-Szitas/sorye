/** Site locales follow docs/I18N.md. `esp` is accepted as an alias of `es`. */
export const SITE_LOCALES = ['en', 'de', 'sk', 'hu', 'es'] as const;
export type SiteLocale = (typeof SITE_LOCALES)[number];

/** Per-locale text. Missing locales fall back to the site's default locale. */
export type LText = Partial<Record<SiteLocale, string>>;

export function isSiteLocale(value: unknown): value is SiteLocale {
  return typeof value === 'string' && (SITE_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string): SiteLocale | null {
  const base = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (base === 'esp') return 'es';
  return isSiteLocale(base) ? base : null;
}

/** Resolves a value for `locale`, falling back to `fallback`, then to ''. */
export function textFor(value: LText | undefined | null, locale: SiteLocale, fallback: SiteLocale): string {
  if (!value) return '';
  const own = value[locale];
  if (own && own.trim()) return own;
  const base = value[fallback];
  return base && base.trim() ? base : '';
}

/** Locales in `enabled` with no non-empty value. Empty values everywhere report nothing. */
export function missingLocales(value: LText | undefined | null, enabled: readonly SiteLocale[]): SiteLocale[] {
  if (!value) return [];
  const filled = enabled.filter((locale) => (value[locale] ?? '').trim() !== '');
  if (filled.length === 0) return [];
  return enabled.filter((locale) => !filled.includes(locale));
}

/**
 * Best match for an Accept-Language header among `enabled`, honouring quality
 * weights and regional tags. Falls back to `fallback`.
 */
export function negotiateLocale(header: string | null | undefined, enabled: readonly SiteLocale[], fallback: SiteLocale): SiteLocale {
  if (!header) return fallback;
  const ranked = header
    .slice(0, 512)
    .split(',')
    .slice(0, 24)
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.weight > 0 && entry.tag)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of ranked) {
    const locale = normalizeLocale(entry.tag);
    if (locale && enabled.includes(locale)) return locale;
  }
  return fallback;
}
