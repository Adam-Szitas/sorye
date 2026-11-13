import { PROCESS_UPLOAD_SLOTS, throttleTransform, type ThroughputBucket } from './upload-throttle';

export class UploadLimitError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const key = Symbol.for('sorye.upload.slots');
const globalState = globalThis as typeof globalThis & { [key]?: { active: number } };
const state = globalState[key] ??= { active: 0 };

/** Limit aggregate upload memory per API process, including post-parse processing. */
export async function withUploadSlot<T>(run: () => Promise<T>): Promise<T> {
  if (state.active >= PROCESS_UPLOAD_SLOTS) throw new UploadLimitError('Uploads are busy. Please retry shortly.', 429);
  state.active++;
  try { return await run(); } finally { state.active--; }
}

export interface BoundedReadOptions {
  /** Optional throughput limits (see `upload-throttle.ts`); empty or absent means unthrottled. */
  buckets?: ThroughputBucket[];
  /** Body read deadline. Defaults to 2 minutes. */
  timeoutMs?: number;
}

/** Count bytes as they arrive, even when Content-Length is absent or false. */
export async function readBoundedFormData(req: Request, maxBytes: number, options: BoundedReadOptions = {}): Promise<FormData> {
  if (Number(req.headers.get('content-length')) > maxBytes) throw new UploadLimitError('Upload is too large', 413);
  if (!req.body) throw new UploadLimitError('Upload body is required', 400);
  let size = 0;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(options.timeoutMs ?? 120_000)]);
  let body = req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new UploadLimitError('Upload is too large', 413);
      controller.enqueue(chunk);
    },
  }), { signal });
  if (options.buckets?.length) body = body.pipeThrough(throttleTransform(options.buckets, signal), { signal });
  const bounded = new Request(req.url, { method: 'POST', headers: req.headers, body,
    signal, duplex: 'half' } as RequestInit);
  return bounded.formData();
}

/**
 * The request body as a bounded, optionally throttled stream with a read deadline. Used by
 * streaming uploads: bytes pass through to Rodrigo and are never collected in Hub memory.
 */
export function boundedBodyStream(req: Request, maxBytes: number, options: BoundedReadOptions = {}): ReadableStream<Uint8Array> {
  if (Number(req.headers.get('content-length')) > maxBytes) throw new UploadLimitError('Upload is too large', 413);
  if (!req.body) throw new UploadLimitError('Upload body is required', 400);
  let size = 0;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(options.timeoutMs ?? 120_000)]);
  let body = req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new UploadLimitError('Upload is too large', 413);
      controller.enqueue(chunk);
    },
  }), { signal });
  if (options.buckets?.length) body = body.pipeThrough(throttleTransform(options.buckets, signal), { signal });
  return body;
}
