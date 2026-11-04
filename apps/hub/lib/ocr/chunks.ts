import type { OcrAiPage } from '@sorye/types';
import { formatRowForModel, OCR_PATTERN_SYSTEM_PROMPT } from './pattern';

/** Configured Ollama context. Kept stable so a later slice does not reload weights. */
export const MODEL_CONTEXT_TOKENS = 8192;
/**
 * UTF-8 bytes per token. Two bytes overestimates CJK and matches this
 * workstation's German listing (about 2.2 bytes per token).
 */
const BYTES_PER_TOKEN = 2;
const CONTEXT_MARGIN_TOKENS = 384;
const MIN_OUTPUT_TOKENS = 256;

// Long documents stay in small slices so a 1,800-token reply can finish.
// A transcript that fits the context, including its pattern, is not pre-sliced.
export const MAX_TRANSCRIPT_BYTES = 6_000 - Buffer.byteLength(OCR_PATTERN_SYSTEM_PROMPT) - 1;
export const MAX_MODEL_INPUT_BYTES = (MODEL_CONTEXT_TOKENS - MIN_OUTPUT_TOKENS - CONTEXT_MARGIN_TOKENS) * BYTES_PER_TOKEN;

export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/** Output tokens for one pattern: each source line copied into JSON, not a second transcript. */
export function patternOutputTokens(transcriptBytes: number, rowCount: number): number {
  const outputBytes = transcriptBytes + Math.max(1, rowCount) * 80 + 400;
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(estimateTokens(outputBytes), 4_096));
}

export function transcriptFitsContext(transcriptBytes: number, rowCount: number): boolean {
  const inputBytes = transcriptBytes + Buffer.byteLength(OCR_PATTERN_SYSTEM_PROMPT);
  if (inputBytes > MAX_MODEL_INPUT_BYTES) return false;
  const output = patternOutputTokens(transcriptBytes, rowCount);
  return estimateTokens(inputBytes) + output + CONTEXT_MARGIN_TOKENS <= MODEL_CONTEXT_TOKENS;
}

/** Cap for a slice that already fits. Still low enough that an overrun can be split. */
export function outputTokenCap(transcriptBytes: number, rowCount: number): number {
  const inputTokens = estimateTokens(transcriptBytes + Buffer.byteLength(OCR_PATTERN_SYSTEM_PROMPT));
  const room = MODEL_CONTEXT_TOKENS - inputTokens - CONTEXT_MARGIN_TOKENS;
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(patternOutputTokens(transcriptBytes, rowCount), Math.max(MIN_OUTPUT_TOKENS, room)));
}

/**
 * One rendering of each stored line. Tab-separated cells become " | " cells.
 * The raw line is not written again next to that rendering.
 */
function splitRowPages(pages: OcrAiPage[], limit: number): string[] {
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
        if (Buffer.byteLength(chunk) + bytes + 1 > limit) flush();
        chunk += fragment + '\n';
      };
      for (const char of formatRowForModel(page.rows[row]!)) {
        const width = Buffer.byteLength(char);
        if (bytes + width + 1 > limit) {
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

/** Split only model input; the stored rows stay whole and unchanged. */
export function chunkRowPages(pages: OcrAiPage[]): string[] {
  const rowCount = pages.reduce((count, page) => count + page.rows.length, 0);
  if (rowCount === 0) return [];
  const whole = splitRowPages(pages, Number.POSITIVE_INFINITY);
  const transcript = whole.join('');
  if (whole.length === 1 && transcriptFitsContext(Buffer.byteLength(transcript), rowCount)) return whole;
  return splitRowPages(pages, MAX_TRANSCRIPT_BYTES);
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
