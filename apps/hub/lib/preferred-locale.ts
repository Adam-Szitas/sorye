/** Select the first supported browser preference, respecting HTTP quality weights. */
export function preferredLocale(header: string | null): 'en' | 'de' | 'sk' | 'hu' | 'es' {
  const supported = ['en', 'de', 'sk', 'hu', 'es'] as const;
  const candidates = (header ?? '').slice(0, 4096).split(',').map((part, index) => {
    const [tag, ...parameters] = part.trim().split(';');
    const quality = parameters.find(value => value.trim().startsWith('q='));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    const language = tag.toLowerCase().split('-')[0];
    return { language: language === 'esp' ? 'es' : language, q, index };
  }).filter(item => Number.isFinite(item.q) && item.q > 0 && item.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const candidate of candidates) {
    const locale = supported.find(value => value === candidate.language);
    if (locale) return locale;
  }
  return 'en';
}
