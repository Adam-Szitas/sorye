import type { PageSettings, PageMargins, PageSize } from '@protocolio/sdk';

const DEFAULT_MARGINS: PageMargins = { top: 8, bottom: 8, right: 20, left: 20 };

const PAGE_SIZES: Record<string, [number, number]> = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  LETTER: [612, 792],
  LEGAL: [612, 1008],
};

function resolvePageDimensions(page: PageSettings): [number, number] {
  const size: PageSize = page.size ?? 'A4';
  const base: [number, number] = Array.isArray(size) ? size : (PAGE_SIZES[size] ?? PAGE_SIZES.A4)!;
  let [w, h] = base;
  if (page.orientation === 'landscape') [w, h] = [h, w];
  return [w, h];
}

/** Printable content width (pt) from page settings. */
export function resolveContentWidth(page?: PageSettings): number {
  const merged = mergePageSettings(page);
  const [pageWidth] = resolvePageDimensions(merged);
  const m = sanitizeMargins(merged.margins);
  return pageWidth - m.left - m.right;
}

export { DEFAULT_MARGINS };

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  margins: { ...DEFAULT_MARGINS },
  defaultRowGap: 12,
};

function sanitizeMargins(margins?: Partial<PageMargins>): PageMargins {
  if (!margins) return { ...DEFAULT_MARGINS };
  return {
    top: margins.top ?? DEFAULT_MARGINS.top,
    right: margins.right ?? DEFAULT_MARGINS.right,
    bottom: margins.bottom ?? DEFAULT_MARGINS.bottom,
    left: margins.left ?? DEFAULT_MARGINS.left,
  };
}

export function mergePageSettings(page?: PageSettings): PageSettings {
  return {
    ...DEFAULT_PAGE_SETTINGS,
    ...page,
    margins: sanitizeMargins({
      ...DEFAULT_MARGINS,
      ...page?.margins,
    }),
  };
}
