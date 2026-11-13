/**
 * Incremental multipart/form-data parser for upload routes: text fields are collected
 * (bounded), and the single file part is exposed as a byte stream as it arrives, so Hub
 * never holds a whole file. Fields that follow the file are available once the file
 * stream has been consumed (`fieldsAfterFile`).
 */
export class MultipartError extends Error {
  constructor(readonly reason: 'not_multipart' | 'malformed' | 'too_many_fields' | 'field_too_large' | 'no_file' | 'second_file') {
    super(reason);
    this.name = 'MultipartError';
  }
}

export interface MultipartUpload {
  /** Fields seen before the file part. */
  fields: Map<string, string>;
  fileName: string;
  fileField: string;
  /** The file's bytes, chunk by chunk. Must be consumed (or abandoned via `cancel`). */
  file: AsyncIterable<Uint8Array>;
  /** Fields after the file; resolves once `file` has been fully consumed. */
  fieldsAfterFile: () => Promise<Map<string, string>>;
  cancel: () => Promise<void>;
}

const MAX_FIELDS = 32;
const MAX_FIELD_BYTES = 8192;
const MAX_HEADER_BYTES = 4096;

function boundaryOf(contentType: string | null): string {
  const match = contentType && /^multipart\/form-data\s*;.*boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(contentType);
  if (!match) throw new MultipartError('not_multipart');
  return match[1] ?? match[2]!;
}

function parseDisposition(headers: string): { name: string; filename: string | null } {
  const line = headers.split('\r\n').find((h) => /^content-disposition:/i.test(h));
  if (!line) throw new MultipartError('malformed');
  const name = /\bname="([^"]*)"/i.exec(line)?.[1];
  const filename = /\bfilename="([^"]*)"/i.exec(line)?.[1] ?? null;
  if (name === undefined) throw new MultipartError('malformed');
  return { name, filename };
}

export async function parseMultipartUpload(body: ReadableStream<Uint8Array>, contentType: string | null): Promise<MultipartUpload> {
  const boundary = Buffer.from(`\r\n--${boundaryOf(contentType)}`);
  const reader = body.getReader();
  // Prepend CRLF so the first boundary looks like every other one.
  let buffer: Buffer = Buffer.from('\r\n');
  let done = false;
  const fill = async (): Promise<boolean> => {
    if (done) return false;
    const next = await reader.read();
    if (next.done) { done = true; return false; }
    buffer = buffer.length ? Buffer.concat([buffer, Buffer.from(next.value)]) : Buffer.from(next.value);
    return true;
  };
  const readUntil = async (marker: Buffer, limit: number): Promise<Buffer> => {
    for (;;) {
      const at = buffer.indexOf(marker);
      if (at >= 0) {
        const head = buffer.subarray(0, at);
        buffer = buffer.subarray(at + marker.length);
        return head;
      }
      if (buffer.length > limit + marker.length) throw new MultipartError('field_too_large');
      if (!(await fill())) throw new MultipartError('malformed');
    }
  };
  const ensure = async (bytes: number) => {
    while (buffer.length < bytes) if (!(await fill())) throw new MultipartError('malformed');
  };

  // Position after the first boundary.
  await readUntil(boundary, MAX_HEADER_BYTES);
  const fields = new Map<string, string>();

  // Returns the next part's headers, or null at the closing boundary.
  const nextPart = async (): Promise<{ name: string; filename: string | null } | null> => {
    await ensure(2);
    const tail = buffer.subarray(0, 2).toString('latin1');
    if (tail === '--') return null;
    if (tail !== '\r\n') throw new MultipartError('malformed');
    buffer = buffer.subarray(2);
    const headers = (await readUntil(Buffer.from('\r\n\r\n'), MAX_HEADER_BYTES)).toString('utf8');
    return parseDisposition(headers);
  };

  for (;;) {
    const part = await nextPart();
    if (!part) throw new MultipartError('no_file');
    if (part.filename === null) {
      if (fields.size >= MAX_FIELDS) throw new MultipartError('too_many_fields');
      fields.set(part.name, (await readUntil(boundary, MAX_FIELD_BYTES)).toString('utf8'));
      continue;
    }
    let fileDone = false;
    let resolveAfter!: (value: Map<string, string>) => void;
    let rejectAfter!: (error: unknown) => void;
    const after = new Promise<Map<string, string>>((resolve, reject) => { resolveAfter = resolve; rejectAfter = reject; });
    after.catch(() => undefined);
    const readRest = async () => {
      const rest = new Map<string, string>();
      for (;;) {
        const next = await nextPart();
        if (!next) return rest;
        if (next.filename !== null) throw new MultipartError('second_file');
        if (rest.size + fields.size >= MAX_FIELDS) throw new MultipartError('too_many_fields');
        rest.set(next.name, (await readUntil(boundary, MAX_FIELD_BYTES)).toString('utf8'));
      }
    };
    async function* stream(): AsyncIterable<Uint8Array> {
      try {
        for (;;) {
          const at = buffer.indexOf(boundary);
          if (at >= 0) {
            if (at > 0) yield buffer.subarray(0, at);
            buffer = buffer.subarray(at + boundary.length);
            fileDone = true;
            break;
          }
          // Everything except a possible partial boundary at the end can be released.
          const safe = buffer.length - boundary.length;
          if (safe > 0) {
            const out = buffer.subarray(0, safe);
            buffer = Buffer.from(buffer.subarray(safe));
            yield out;
          }
          if (!(await fill())) throw new MultipartError('malformed');
        }
        resolveAfter(await readRest());
      } catch (error) {
        rejectAfter(error);
        throw error;
      }
    }
    return {
      fields, fileName: part.filename, fileField: part.name, file: stream(),
      fieldsAfterFile: () => (fileDone ? after : Promise.reject(new MultipartError('malformed'))),
      cancel: async () => { await reader.cancel().catch(() => undefined); },
    };
  }
}
