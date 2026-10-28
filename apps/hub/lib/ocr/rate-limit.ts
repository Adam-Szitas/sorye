type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function assertOcrAnalyzeRateLimit(workspaceId: string, userId: string): void {
  const key = `${workspaceId}:${userId}:ocr-analyze`;
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 6;
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(bucketKey);
  }
  // Bound process memory if identifiers are churned or an attacker creates
  // many short-lived authenticated accounts/workspaces.
  if (!buckets.has(key) && buckets.size >= 10_000) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > max) {
    throw new Error('Too many OCR analyses. Try again in a few minutes.');
  }
}
