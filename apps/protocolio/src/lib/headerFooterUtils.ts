import type { Block, HeaderFooterBlock, HeaderFooterPageContent, TextBlock } from '@protocolio/sdk';

export type HeaderFooterSlots = {
  left: string;
  center: string;
  right: string;
};

const emptySlots = (): HeaderFooterSlots => ({ left: '', center: '', right: '' });
const emptyText = (): TextBlock => ({ type: 'text', content: '' });

export function isHeaderFooterRepeating(block: HeaderFooterBlock): boolean {
  return block.repeat !== false;
}

export function slotsFromBlocks(blocks: Block[]): HeaderFooterSlots {
  if (blocks.length === 1 && blocks[0]?.type === 'text') {
    const t = blocks[0] as TextBlock;
    const align = t.font?.align ?? 'center';
    if (align === 'left') return { left: t.content, center: '', right: '' };
    if (align === 'right') return { left: '', center: '', right: t.content };
    return { left: '', center: t.content, right: '' };
  }

  return {
    left: blocks[0]?.type === 'text' ? (blocks[0] as TextBlock).content : '',
    center: blocks[1]?.type === 'text' ? (blocks[1] as TextBlock).content : '',
    right: blocks[2]?.type === 'text' ? (blocks[2] as TextBlock).content : '',
  };
}

export function blocksFromSlots(slots: HeaderFooterSlots): TextBlock[] {
  return [
    { type: 'text', content: slots.left },
    { type: 'text', content: slots.center },
    { type: 'text', content: slots.right },
  ];
}

function pageContentToBlocks(page: HeaderFooterPageContent): TextBlock[] {
  if (page.blocks?.length) {
    return blocksFromSlots(slotsFromBlocks(page.blocks));
  }
  const font = page.font;
  return [
    { type: 'text', content: page.left ?? '', font },
    { type: 'text', content: page.center ?? '', font },
    { type: 'text', content: page.right ?? '', font },
  ];
}

export function readHeaderFooterSlots(block: HeaderFooterBlock): HeaderFooterSlots {
  return slotsFromBlocks(block.blocks);
}

export function writeHeaderFooterSlot(
  block: HeaderFooterBlock,
  slot: 'left' | 'center' | 'right',
  content: string,
): HeaderFooterBlock {
  const current = readHeaderFooterSlots(block);
  const next = { ...current, [slot]: content };
  return { ...block, blocks: blocksFromSlots(next) };
}

export function readHeaderFooterPages(block: HeaderFooterBlock): HeaderFooterSlots[] {
  if (block.pages?.length) {
    return block.pages.map(page => slotsFromBlocks(pageContentToBlocks(page)));
  }
  return [readHeaderFooterSlots(block)];
}

export function writeHeaderFooterPages(
  block: HeaderFooterBlock,
  pages: HeaderFooterSlots[],
): HeaderFooterBlock {
  return {
    ...block,
    repeat: false,
    pages: pages.map(slots => ({ blocks: blocksFromSlots(slots) })),
  };
}

export function updateHeaderFooterPageSlot(
  block: HeaderFooterBlock,
  pageIndex: number,
  slot: 'left' | 'center' | 'right',
  content: string,
): HeaderFooterBlock {
  const pages = readHeaderFooterPages(block);
  while (pages.length <= pageIndex) pages.push(emptySlots());
  pages[pageIndex] = { ...pages[pageIndex]!, [slot]: content };
  return writeHeaderFooterPages(block, pages);
}

export function addHeaderFooterPage(block: HeaderFooterBlock): HeaderFooterBlock {
  const pages = readHeaderFooterPages(block);
  pages.push(emptySlots());
  return writeHeaderFooterPages(block, pages);
}

export function removeHeaderFooterPage(block: HeaderFooterBlock, pageIndex: number): HeaderFooterBlock {
  const pages = readHeaderFooterPages(block).filter((_, i) => i !== pageIndex);
  return writeHeaderFooterPages(block, pages.length > 0 ? pages : [emptySlots()]);
}

export function setHeaderFooterRepeating(block: HeaderFooterBlock, repeat: boolean): HeaderFooterBlock {
  if (repeat) {
    const firstPage = readHeaderFooterPages(block)[0] ?? readHeaderFooterSlots(block);
    return {
      ...block,
      repeat: undefined,
      pages: undefined,
      page: undefined,
      blocks: blocksFromSlots(firstPage),
    };
  }

  return writeHeaderFooterPages(block, [readHeaderFooterSlots(block)]);
}

export function defaultHeaderFooterBlock(
  position: 'header' | 'footer',
  options?: { page?: number; repeat?: boolean },
): HeaderFooterBlock {
  const block: HeaderFooterBlock = {
    type: 'headerFooter',
    position,
    blocks: [
      emptyText(),
      { type: 'text', content: position === 'header' ? 'Header' : 'Page {{pageNumber}} of {{totalPages}}' },
      emptyText(),
    ],
  };
  if (options?.page != null) block.page = options.page;
  if (options?.repeat === false) block.repeat = false;
  return block;
}

export function countHeaderFootersSamePosition(blocks: readonly Block[], hf: HeaderFooterBlock): number {
  return blocks.filter(
    b => b.type === 'headerFooter' && (b as HeaderFooterBlock).position === hf.position,
  ).length;
}

export function ordinalPageAmongSamePosition(blocks: readonly Block[], hf: HeaderFooterBlock, index: number): number {
  let n = 0;
  for (let i = 0; i <= index; i++) {
    const b = blocks[i];
    if (b?.type === 'headerFooter' && (b as HeaderFooterBlock).position === hf.position) n++;
  }
  return n;
}
