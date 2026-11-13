/**
 * Machine-readable component contract interpreted by Rodrigo (`contracts/site-components.json`).
 * Sorye keeps the reviewed snapshot in `packages/types/contracts/site-components.json`;
 * `pnpm --filter @sorye/site-sdk contract:export` regenerates it.
 */
import { SITE_LOCALES } from './locales';
import { COLLECTION_FIELD_KINDS, RESERVED_PAGE_SLUGS, SITE_MODEL_LIMITS } from './model';
import { COMPONENTS } from './registry';
import { contractSpec, FORM_FIELD_KINDS, LIMITS } from './schema';
import { CONTRAST_PAIRS, THEME_COLOR_TOKENS, THEME_FONTS, THEME_PRESETS, THEME_RADII, THEME_SCALES, THEME_SPACING } from './theme';

export const SITE_CONTRACT_VERSION = 1;

export function siteComponentContract() {
  return {
    version: SITE_CONTRACT_VERSION,
    locales: [...SITE_LOCALES],
    limits: { ...SITE_MODEL_LIMITS, ...LIMITS },
    reservedSlugs: [...RESERVED_PAGE_SLUGS],
    collectionFieldKinds: [...COLLECTION_FIELD_KINDS],
    formFieldKinds: [...FORM_FIELD_KINDS],
    theme: {
      colorTokens: [...THEME_COLOR_TOKENS],
      fonts: Object.keys(THEME_FONTS),
      scales: Object.keys(THEME_SCALES),
      radii: Object.keys(THEME_RADII),
      spacing: Object.keys(THEME_SPACING),
      presets: Object.fromEntries(Object.entries(THEME_PRESETS).map(([id, p]) => [id, p.colors])),
      contrast: CONTRAST_PAIRS.map((p) => ({ ...p })),
    },
    components: Object.fromEntries(COMPONENTS.map((c) => [c.type, { version: c.version, props: contractSpec(c.props) }])),
  };
}

export function siteComponentContractJson(): string {
  return `${JSON.stringify(siteComponentContract(), null, 2)}\n`;
}
