type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function assertMailRateLimit(
  key: string,
  max: number,
  windowMs: number,
): void {
  assertRateLimit(key, max, windowMs, 'Too many mail requests. Try again in a minute.');
}

export function assertRateLimit(
  key: string,
  max: number,
  windowMs: number,
  message = 'Too many requests. Try again in a minute.',
): void {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > max) {
    throw new Error(message);
  }
}

export function mailRateKey(
  workspaceId: string,
  userId: string,
  action: string,
): string {
  return `${workspaceId}:${userId}:${action}`;
}
