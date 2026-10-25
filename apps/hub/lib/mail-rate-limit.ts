type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function assertMailRateLimit(
  key: string,
  max: number,
  windowMs: number,
): void {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > max) {
    throw new Error('Too many mail requests. Try again in a minute.');
  }
}

export function mailRateKey(
  workspaceId: string,
  userId: string,
  action: string,
): string {
  return `${workspaceId}:${userId}:${action}`;
}
