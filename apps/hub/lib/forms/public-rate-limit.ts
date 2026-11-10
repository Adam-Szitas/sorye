/**
 * Fixed-window limiter for the anonymous Forms routes.
 *
 * State is per Hub process: with several replicas the effective limit is the
 * per-replica limit times the replica count. It bounds abuse and memory; it is
 * not a quota. Rodrigo's own admission control still applies behind it.
 */
type Bucket = { count: number; resetAt: number };

const MAX_BUCKETS = 20_000;

export interface PublicRateLimiter {
  /** Returns seconds to wait when the key is over its limit, otherwise 0. */
  hit(key: string, max: number, windowMs: number, now?: number): number;
  size(): number;
}

export function createPublicRateLimiter(maxBuckets = MAX_BUCKETS): PublicRateLimiter {
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;
  return {
    hit(key, max, windowMs, now = Date.now()) {
      if (now - lastSweep > 30_000) {
        lastSweep = now;
        for (const [name, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(name);
      }
      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        // Map keeps insertion order, so the first key is the oldest window.
        if (!current && buckets.size >= maxBuckets) {
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) buckets.delete(oldest);
        }
        buckets.delete(key);
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return 0;
      }
      current.count += 1;
      if (current.count <= max) return 0;
      return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    },
    size: () => buckets.size,
  };
}

export const formsPublicLimiter = createPublicRateLimiter();

/**
 * Client address as reported by the trusted ingress. Every proxy in front of Hub
 * overwrites X-Forwarded-For, so its first hop is the browser. Falls back to one
 * shared bucket when it is missing, which is the conservative choice.
 */
export function publicClientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  return /^[0-9a-fA-F:.]{3,45}$/.test(forwarded) ? forwarded.toLowerCase() : 'unknown';
}

export const FORMS_PUBLIC_LIMITS = {
  /** Reads of one form definition per client. */
  read: { max: 120, windowMs: 60_000 },
  /** Submissions per client across all forms. */
  submitPerClient: { max: 10, windowMs: 60_000 },
  /** Submissions per form from everyone, so one form cannot be flooded. */
  submitPerForm: { max: 300, windowMs: 60_000 },
} as const;

export const FORMS_PUBLIC_MAX_BODY_BYTES = 65_536;
