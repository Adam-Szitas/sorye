/**
 * Optional server-side upload throughput limit and per-member upload
 * concurrency. Both protect the Hub process, its storage and the services
 * behind it; neither trusts anything the browser says about its own speed.
 *
 * Throughput is off unless one of these is a positive number of bytes per second:
 *   FILE_UPLOAD_THROTTLE_USER_BPS       each member
 *   FILE_UPLOAD_THROTTLE_WORKSPACE_BPS  all members of one workspace together
 *   FILE_UPLOAD_THROTTLE_GLOBAL_BPS     all uploads on this Hub process
 * Every limit that applies is enforced at once, so the lowest one wins.
 * Limits are per Hub process: with N replicas the platform total is N × global.
 *
 * Throttling reads the request body more slowly, which gives the client TCP
 * back-pressure instead of buffering extra bytes in memory.
 */

import { FILE_UPLOAD_BATCH_MAX } from '@sorye/types';

export interface UploadThrottleConfig {
  userBytesPerSecond: number | null;
  workspaceBytesPerSecond: number | null;
  globalBytesPerSecond: number | null;
  /** Uploads one member may run at the same time on this process. */
  maxInflightPerUser: number;
}

/** Bytes a bucket may send without waiting: one second of throughput, at least 64 KiB. */
const MIN_BURST_BYTES = 64 * 1024;
const DEFAULT_INFLIGHT_PER_USER = 2;
/** The process-wide upload slot count in `bounded-upload.ts`. */
export const PROCESS_UPLOAD_SLOTS = 2;

function positiveNumber(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function readUploadThrottleConfig(env: NodeJS.ProcessEnv = process.env): UploadThrottleConfig {
  const inflight = positiveNumber(env.FILE_UPLOAD_MAX_INFLIGHT_PER_USER);
  return {
    userBytesPerSecond: positiveNumber(env.FILE_UPLOAD_THROTTLE_USER_BPS),
    workspaceBytesPerSecond: positiveNumber(env.FILE_UPLOAD_THROTTLE_WORKSPACE_BPS),
    globalBytesPerSecond: positiveNumber(env.FILE_UPLOAD_THROTTLE_GLOBAL_BPS),
    maxInflightPerUser: Math.min(inflight ?? DEFAULT_INFLIGHT_PER_USER, 16),
  };
}

export function throttleEnabled(config: UploadThrottleConfig): boolean {
  return Boolean(config.userBytesPerSecond || config.workspaceBytesPerSecond || config.globalBytesPerSecond);
}

/** The lowest limit that applies to one upload, or null when uploads are not throttled. */
export function effectiveBytesPerSecond(config: UploadThrottleConfig): number | null {
  const limits = [config.userBytesPerSecond, config.workspaceBytesPerSecond, config.globalBytesPerSecond]
    .filter((value): value is number => typeof value === 'number' && value > 0);
  return limits.length ? Math.min(...limits) : null;
}

/**
 * Leaky bucket on a virtual clock (GCRA). `reserve` books `bytes` and returns
 * how long the caller must wait before sending them. Single-threaded JS makes
 * the booking atomic, so concurrent uploads share the rate fairly in order.
 */
export class ThroughputBucket {
  private nextFreeAt = 0;
  readonly burstMs: number;

  constructor(readonly bytesPerSecond: number, private readonly now: () => number = Date.now) {
    this.burstMs = (Math.max(bytesPerSecond, MIN_BURST_BYTES) / bytesPerSecond) * 1000;
  }

  reserve(bytes: number): number {
    const now = this.now();
    // An idle bucket starts at `now`; the burst tolerance below lets one burst through without waiting.
    const start = Math.max(this.nextFreeAt, now);
    this.nextFreeAt = start + (bytes / this.bytesPerSecond) * 1000;
    return Math.max(0, this.nextFreeAt - this.burstMs - now);
  }

  idle(): boolean {
    return this.nextFreeAt < this.now() - this.burstMs;
  }
}

type BucketMap = Map<string, ThroughputBucket>;
const stateKey = Symbol.for('sorye.upload.throttle');
const globalState = globalThis as typeof globalThis & {
  [stateKey]?: { buckets: BucketMap; inflight: Map<string, number> };
};
const state = (globalState[stateKey] ??= { buckets: new Map(), inflight: new Map() });

function bucketFor(key: string, bytesPerSecond: number): ThroughputBucket {
  const existing = state.buckets.get(key);
  if (existing && existing.bytesPerSecond === bytesPerSecond) return existing;
  if (state.buckets.size > 2_000) {
    for (const [name, bucket] of state.buckets) if (bucket.idle()) state.buckets.delete(name);
  }
  const bucket = new ThroughputBucket(bytesPerSecond);
  state.buckets.set(key, bucket);
  return bucket;
}

export interface ThrottleScope {
  userId: string;
  workspaceId: string;
}

/** Buckets that apply to one upload, or an empty list when throttling is off. */
export function uploadBuckets(scope: ThrottleScope, config = readUploadThrottleConfig()): ThroughputBucket[] {
  const buckets: ThroughputBucket[] = [];
  if (config.userBytesPerSecond) buckets.push(bucketFor(`u:${scope.userId}`, config.userBytesPerSecond));
  if (config.workspaceBytesPerSecond) buckets.push(bucketFor(`w:${scope.workspaceId}`, config.workspaceBytesPerSecond));
  if (config.globalBytesPerSecond) buckets.push(bucketFor('g', config.globalBytesPerSecond));
  return buckets;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

/** Pass chunks through no faster than every bucket allows. Identity when `buckets` is empty. */
export function throttleTransform(buckets: ThroughputBucket[], signal?: AbortSignal): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      if (buckets.length) {
        // Book on every bucket, then wait for the slowest one.
        const wait = Math.max(...buckets.map((bucket) => bucket.reserve(chunk.byteLength)));
        if (wait > 0) await sleep(wait, signal);
      }
      controller.enqueue(chunk);
    },
  });
}

export class UserUploadBusyError extends Error {
  readonly status = 429;
  constructor() { super('You already have the maximum number of uploads running. Please retry shortly.'); }
}

/** Limit concurrent uploads per member on this process so one member cannot hold every upload slot. */
export async function withUserUploadSlot<T>(userId: string, run: () => Promise<T>, config = readUploadThrottleConfig()): Promise<T> {
  const current = state.inflight.get(userId) ?? 0;
  if (current >= config.maxInflightPerUser) throw new UserUploadBusyError();
  state.inflight.set(userId, current + 1);
  try {
    return await run();
  } finally {
    const left = (state.inflight.get(userId) ?? 1) - 1;
    if (left <= 0) state.inflight.delete(userId);
    else state.inflight.set(userId, left);
  }
}

/** Time a throttled body may take: the normal 2 minutes plus the time the limit needs, at most 30 minutes. */
export function uploadTimeoutMs(bytes: number, bytesPerSecond: number | null): number {
  const base = 120_000;
  if (!bytesPerSecond) return base;
  return Math.min(30 * 60_000, base + Math.ceil((bytes / bytesPerSecond) * 1000));
}

/** Limits reported to the browser in the Drive quota. The same config enforces them on upload. */
export function quotaLimits(config: UploadThrottleConfig) {
  return {
    maxBatchFiles: FILE_UPLOAD_BATCH_MAX,
    maxConcurrentUploads: Math.min(config.maxInflightPerUser, PROCESS_UPLOAD_SLOTS),
    throttleBytesPerSecond: effectiveBytesPerSecond(config),
  };
}
