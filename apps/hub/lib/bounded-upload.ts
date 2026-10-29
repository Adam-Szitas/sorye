export class UploadLimitError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const key = Symbol.for('sorye.upload.slots');
const globalState = globalThis as typeof globalThis & { [key]?: { active: number } };
const state = globalState[key] ??= { active: 0 };

/** Limit aggregate upload memory per API process, including post-parse processing. */
export async function withUploadSlot<T>(run: () => Promise<T>): Promise<T> {
  if (state.active >= 2) throw new UploadLimitError('Uploads are busy. Please retry shortly.', 429);
  state.active++;
  try { return await run(); } finally { state.active--; }
}

/** Count bytes as they arrive, even when Content-Length is absent or false. */
export async function readBoundedFormData(req: Request, maxBytes: number): Promise<FormData> {
  if (Number(req.headers.get('content-length')) > maxBytes) throw new UploadLimitError('Upload is too large', 413);
  if (!req.body) throw new UploadLimitError('Upload body is required', 400);
  let size = 0;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(120_000)]);
  const body = req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new UploadLimitError('Upload is too large', 413);
      controller.enqueue(chunk);
    },
  }), { signal });
  const bounded = new Request(req.url, { method: 'POST', headers: req.headers, body,
    signal, duplex: 'half' } as RequestInit);
  return bounded.formData();
}
