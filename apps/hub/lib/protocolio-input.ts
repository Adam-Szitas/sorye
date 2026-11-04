/** Bound template uploads before parsing JSON (including chunked requests). */
export async function readProtocolioTemplate(req: Request): Promise<unknown> {
  if (!req.body) throw new Error('Missing template');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new Error('Template exceeds 2 MB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
