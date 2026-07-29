import {
  TemplateBuilder,
  type PdfTemplate,
  type Block,
  type PageSettings,
  type FontStyle,
  type PdfMetadata,
  type GridBlock,
  type TableBlock,
  type MergedTableBlock,
} from '@protocolio/sdk';
import { DEFAULT_PAGE_SETTINGS, mergePageSettings } from '../defaults';
import { normalizeGridBlock } from '../lib/gridUtils';
import { normalizeTableBlock } from '../lib/tableUtils';
import { normalizeMergedTableBlock } from '../lib/mergedTableUtils';

function normalizeBlock(block: Block): Block {
  if (block.type === 'grid') return normalizeGridBlock(block as GridBlock);
  if (block.type === 'table') return normalizeTableBlock(block as TableBlock);
  if (block.type === 'mergedTable') return normalizeMergedTableBlock(block as MergedTableBlock);
  return block;
}

let blocks: Block[] = [];
let pageSettings: PageSettings | undefined = {
  ...DEFAULT_PAGE_SETTINGS,
  margins: { ...DEFAULT_PAGE_SETTINGS.margins },
};
let metadata: PdfMetadata | undefined;
let defaultFontStyle: FontStyle | undefined;

export function getBlocks(): readonly Block[] {
  return blocks;
}

export function getPageSettings(): PageSettings | undefined {
  return pageSettings;
}

export function getMetadata(): PdfMetadata | undefined {
  return metadata;
}

export function getDefaultFont(): FontStyle | undefined {
  return defaultFontStyle;
}

export function addBlock(block: Block): void {
  blocks = [...blocks, block];
}

export function removeBlock(index: number): void {
  if (index < 0 || index >= blocks.length) return;
  blocks = blocks.filter((_, i) => i !== index);
}

export function replaceBlock(index: number, block: Block): void {
  if (index < 0 || index >= blocks.length) return;
  blocks = blocks.map((b, i) => (i === index ? block : b));
}

export function moveBlock(fromIndex: number, toIndex: number): void {
  if (
    fromIndex < 0 || fromIndex >= blocks.length ||
    toIndex < 0 || toIndex >= blocks.length ||
    fromIndex === toIndex
  ) return;

  const updated = [...blocks];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved!);
  blocks = updated;
}

export function setPageSettings(settings: PageSettings | undefined): void {
  pageSettings = settings;
}

export function setMetadata(meta: PdfMetadata | undefined): void {
  metadata = meta;
}

export function setDefaultFont(font: FontStyle | undefined): void {
  defaultFontStyle = font;
}

export function build(): PdfTemplate {
  const builder = new TemplateBuilder();

  if (pageSettings) {
    builder.page(mergePageSettings(pageSettings));
  }
  if (defaultFontStyle) builder.defaultFont(defaultFontStyle);
  if (metadata) builder.metadata(metadata);

  for (const block of blocks) {
    builder.addBlock(normalizeBlock(block));
  }

  return builder.build();
}

export function loadTemplate(template: PdfTemplate): void {
  blocks = [...template.blocks];
  pageSettings = mergePageSettings(template.page);
  metadata = template.metadata;
  defaultFontStyle = template.defaultFont;
}

export function reset(): void {
  blocks = [];
  pageSettings = {
    ...DEFAULT_PAGE_SETTINGS,
    margins: { ...DEFAULT_PAGE_SETTINGS.margins },
  };
  metadata = undefined;
  defaultFontStyle = undefined;
}
