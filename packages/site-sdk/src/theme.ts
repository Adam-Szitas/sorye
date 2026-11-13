/** Design tokens as CSS custom properties. Presets plus owner overrides; WCAG AA checked on save. */

export const THEME_COLOR_TOKENS = ['background', 'surface', 'text', 'muted', 'primary', 'onPrimary'] as const;
export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number];

export const THEME_FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  humanist: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif',
  mono: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
} as const;
export type ThemeFont = keyof typeof THEME_FONTS;

export const THEME_SCALES = { compact: 1.125, normal: 1.2, large: 1.25 } as const;
export type ThemeScale = keyof typeof THEME_SCALES;
export const THEME_RADII = { none: '0', small: '4px', medium: '10px', large: '20px' } as const;
export type ThemeRadius = keyof typeof THEME_RADII;
export const THEME_SPACING = { compact: '0.8', normal: '1', airy: '1.3' } as const;
export type ThemeSpacing = keyof typeof THEME_SPACING;

export interface ThemeTokens {
  colors: Record<ThemeColorToken, string>;
  font: ThemeFont;
  headingFont: ThemeFont;
  scale: ThemeScale;
  radius: ThemeRadius;
  spacing: ThemeSpacing;
}

export const THEME_PRESET_IDS = ['paper', 'midnight', 'forest', 'sunset', 'slate'] as const;
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

export const THEME_PRESETS: Record<ThemePresetId, ThemeTokens> = {
  paper: { colors: { background: '#ffffff', surface: '#f4f5f7', text: '#16181d', muted: '#4b5260', primary: '#1d4ed8', onPrimary: '#ffffff' }, font: 'sans', headingFont: 'sans', scale: 'normal', radius: 'medium', spacing: 'normal' },
  midnight: { colors: { background: '#0f1218', surface: '#1a1f29', text: '#eef1f6', muted: '#aab3c2', primary: '#8ab4ff', onPrimary: '#0b1020' }, font: 'sans', headingFont: 'sans', scale: 'normal', radius: 'large', spacing: 'airy' },
  forest: { colors: { background: '#f6f8f4', surface: '#e7eee2', text: '#1b2a1f', muted: '#465a4b', primary: '#1f6b3a', onPrimary: '#ffffff' }, font: 'humanist', headingFont: 'serif', scale: 'normal', radius: 'small', spacing: 'normal' },
  sunset: { colors: { background: '#fffaf5', surface: '#fbeee2', text: '#2b1d14', muted: '#5f4a3c', primary: '#b4410c', onPrimary: '#ffffff' }, font: 'sans', headingFont: 'serif', scale: 'large', radius: 'large', spacing: 'airy' },
  slate: { colors: { background: '#f8fafc', surface: '#e2e8f0', text: '#0f172a', muted: '#475569', primary: '#0f172a', onPrimary: '#f8fafc' }, font: 'mono', headingFont: 'sans', scale: 'compact', radius: 'none', spacing: 'compact' },
};

export interface ThemeOverrides {
  colors?: Partial<Record<ThemeColorToken, string>>;
  font?: ThemeFont;
  headingFont?: ThemeFont;
  scale?: ThemeScale;
  radius?: ThemeRadius;
  spacing?: ThemeSpacing;
}

export interface SiteTheme {
  preset: ThemePresetId;
  overrides: ThemeOverrides;
}

export const DEFAULT_THEME: SiteTheme = { preset: 'paper', overrides: {} };

const HEX = /^#[0-9a-f]{6}$/;

export function resolveTheme(theme: SiteTheme): ThemeTokens {
  const base = THEME_PRESETS[theme.preset] ?? THEME_PRESETS.paper;
  const o = theme.overrides ?? {};
  return {
    colors: { ...base.colors, ...Object.fromEntries(Object.entries(o.colors ?? {}).filter(([, v]) => typeof v === 'string' && HEX.test(v))) } as ThemeTokens['colors'],
    font: o.font ?? base.font,
    headingFont: o.headingFont ?? base.headingFont,
    scale: o.scale ?? base.scale,
    radius: o.radius ?? base.radius,
    spacing: o.spacing ?? base.spacing,
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pairs that must meet WCAG AA. Rodrigo checks the same pairs and minimums. */
export const CONTRAST_PAIRS: ReadonlyArray<{ fg: ThemeColorToken; bg: ThemeColorToken; min: number }> = [
  { fg: 'text', bg: 'background', min: 4.5 },
  { fg: 'text', bg: 'surface', min: 4.5 },
  { fg: 'muted', bg: 'background', min: 4.5 },
  { fg: 'onPrimary', bg: 'primary', min: 4.5 },
  { fg: 'primary', bg: 'background', min: 3 },
];

export interface ContrastIssue { fg: ThemeColorToken; bg: ThemeColorToken; ratio: number; min: number }

export function themeContrastIssues(tokens: ThemeTokens): ContrastIssue[] {
  return CONTRAST_PAIRS.map(({ fg, bg, min }) => ({ fg, bg, min, ratio: Math.round(contrastRatio(tokens.colors[fg], tokens.colors[bg]) * 100) / 100 }))
    .filter((pair) => pair.ratio < pair.min);
}

const OVERRIDE_KEYS = ['colors', 'font', 'headingFont', 'scale', 'radius', 'spacing'];

/** Shape and contrast validation for a stored theme. */
export function validateTheme(value: unknown): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['expected_theme'];
  const theme = value as Record<string, unknown>;
  if (Object.keys(theme).some((k) => k !== 'preset' && k !== 'overrides') || !('preset' in theme) || !('overrides' in theme)) issues.push('theme_shape');
  if (!(THEME_PRESET_IDS as readonly string[]).includes(String(theme.preset))) issues.push('unknown_preset');
  const o = theme.overrides as Record<string, unknown> | undefined;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return [...issues, 'overrides_shape'];
  for (const key of Object.keys(o)) if (!OVERRIDE_KEYS.includes(key)) issues.push(`unknown_override:${key}`);
  if (o.colors !== undefined) {
    if (!o.colors || typeof o.colors !== 'object' || Array.isArray(o.colors)) issues.push('colors_shape');
    else for (const [k, v] of Object.entries(o.colors)) {
      if (!(THEME_COLOR_TOKENS as readonly string[]).includes(k)) issues.push(`unknown_color:${k}`);
      else if (typeof v !== 'string' || !HEX.test(v)) issues.push(`invalid_color:${k}`);
    }
  }
  const enums: Array<[string, object]> = [['font', THEME_FONTS], ['headingFont', THEME_FONTS], ['scale', THEME_SCALES], ['radius', THEME_RADII], ['spacing', THEME_SPACING]];
  for (const [key, options] of enums) if (o[key] !== undefined && !(String(o[key]) in options)) issues.push(`invalid_${key}`);
  if (issues.length) return issues;
  return themeContrastIssues(resolveTheme(theme as unknown as SiteTheme)).map((i) => `contrast:${i.fg}/${i.bg}`);
}

/** `:root` custom properties for a theme. Values are allow-listed, never owner free text. */
export function themeCss(tokens: ThemeTokens): string {
  const c = tokens.colors;
  const s = THEME_SCALES[tokens.scale];
  const vars = [
    `--s-bg:${c.background}`, `--s-surface:${c.surface}`, `--s-text:${c.text}`, `--s-muted:${c.muted}`,
    `--s-primary:${c.primary}`, `--s-on-primary:${c.onPrimary}`,
    `--s-font:${THEME_FONTS[tokens.font]}`, `--s-heading-font:${THEME_FONTS[tokens.headingFont]}`,
    `--s-h1:${(s ** 4).toFixed(3)}rem`, `--s-h2:${(s ** 3).toFixed(3)}rem`, `--s-h3:${(s ** 2).toFixed(3)}rem`, `--s-h4:${s.toFixed(3)}rem`,
    `--s-radius:${THEME_RADII[tokens.radius]}`, `--s-space:${THEME_SPACING[tokens.spacing]}`,
  ];
  return `:root{${vars.join(';')}}`;
}
