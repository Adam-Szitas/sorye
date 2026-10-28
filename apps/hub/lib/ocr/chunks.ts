import type { OcrAiPage } from '@sorye/types';
import { formatRowForModel, OCR_PATTERN_SYSTEM_PROMPT } from './pattern';

// UTF-8 bytes conservatively bound token usage, including non-Latin text.
// Leaves room for instructions and output in the explicit 8K context.
// Keep the complete system + user prompt under the LLM's byte budget.
export const MAX_TRANSCRIPT_BYTES = 6_000 - Buffer.byteLength(OCR_PATTERN_SYSTEM_PROMPT) - 1;

/** Split only model input; the stored rows stay whole and unchanged. */
export function chunkRowPages(pages: OcrAiPage[]): string[] {
  const chunks: string[] = [];
  let chunk = '';
  const flush = () => {
    if (chunk) chunks.push(chunk);
    chunk = '';
  };
  for (const page of pages) {
    for (let row = 0; row < page.rows.length; row += 1) {
      const prefix = `PAGE ${page.page}\n${row}|`;
      let fragment = prefix;
      let bytes = Buffer.byteLength(prefix);
      const append = () => {
        if (Buffer.byteLength(chunk) + bytes + 1 > MAX_TRANSCRIPT_BYTES) flush();
        chunk += fragment + '\n';
      };
      for (const char of formatRowForModel(page.rows[row]!)) {
        const width = Buffer.byteLength(char);
        if (bytes + width + 1 > MAX_TRANSCRIPT_BYTES) {
          append();
          flush();
          // Repeat the original page/row reference for continuation fragments.
          fragment = prefix;
          bytes = Buffer.byteLength(prefix);
        }
        fragment += char;
        bytes += width;
      }
      append();
    }
  }
  flush();
  return chunks;
}

/** Split one model slice on row boundaries so a truncated reply can be retried in halves. */
export function splitChunk(text: string): [string, string] | null {
  const lines = text.replace(/\n$/, '').split('\n');
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('PAGE ') && i + 1 < lines.length) {
      blocks.push(`${line}\n${lines[i + 1]}\n`);
      i += 1;
    } else if (line) {
      blocks.push(`${line}\n`);
    }
  }
  if (blocks.length < 2) return null;
  const mid = Math.ceil(blocks.length / 2);
  return [blocks.slice(0, mid).join(''), blocks.slice(mid).join('')];
}
