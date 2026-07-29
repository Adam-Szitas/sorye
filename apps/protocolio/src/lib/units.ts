/**
 * Protocolio measures layout in PDF points (pt). 72 pt = 1 inch ≈ 25.4 mm.
 * These are not CSS pixels.
 */
export const LAYOUT_UNIT = 'pt';

export function ptLabel(name: string): string {
  return `${name} (${LAYOUT_UNIT})`;
}

export function ptOrPercentLabel(name: string): string {
  return `${name} (% or ${LAYOUT_UNIT})`;
}

export function ratioLabel(name: string): string {
  return `${name} (0–1)`;
}

export const LAYOUT_UNIT_HINT = `Distances and sizes use PDF points (${LAYOUT_UNIT}). 72 ${LAYOUT_UNIT} = 1 inch.`;

/** Example value for color text inputs */
export const COLOR_PLACEHOLDER = '#333333';

export function colorLabel(name: string): string {
  return `${name} (hex)`;
}

export const COLOR_FORMAT_HINT =
  'Hex (#333333), rgb(51, 51, 51), or named colors (red, blue). Prefer hex with #.';
