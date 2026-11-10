const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Reads a request body as UTF-8 text, refusing anything over `maxBytes`. */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('too_large');
  if (!request.body) throw new Error('invalid');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('too_large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface ParsedPublicSubmission {
  submissionId: string;
  answers: unknown;
  /** True when the hidden trap field was filled in. */
  trap: boolean;
}

/**
 * Accepts exactly `{ submissionId, answers, website? }`. `website` is the hidden
 * trap input: people never see it, so any value means an automated sender.
 */
export function parsePublicSubmission(text: string): ParsedPublicSubmission | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'submissionId' && key !== 'answers' && key !== 'website')) return null;
  const submissionId = typeof record.submissionId === 'string' ? record.submissionId.toLowerCase() : '';
  if (!UUID.test(submissionId)) return null;
  if (!record.answers || typeof record.answers !== 'object' || Array.isArray(record.answers)) return null;
  const website = record.website;
  if (website !== undefined && typeof website !== 'string') return null;
  return { submissionId, answers: record.answers, trap: typeof website === 'string' && website.length > 0 };
}
