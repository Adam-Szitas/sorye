/**
 * Upload throughput estimate for sizing the Drive upload queue. Advisory only:
 * it decides how many files the browser offers to queue, while the server
 * enforces every real limit.
 *
 * Order of evidence:
 * 1. Measured: an exponentially weighted average of recent uploads in this
 *    browser (only files large enough that request latency does not dominate),
 *    timed from the first byte sent to the server's answer.
 * 2. `navigator.connection.downlink`: a download figure (Chrome caps it at
 *    10 Mbit/s), so it is halved as a cautious uplink guess.
 * 3. Unknown: the queue uses a fixed conservative batch size.
 * A server throttle, when set, caps the estimate.
 */

/** Uploads smaller than this are not used as samples; latency would dominate them. */
export const MIN_SAMPLE_BYTES = 256 * 1024;
/** Weight of the newest sample in the moving average. */
export const SAMPLE_WEIGHT = 0.35;
/** Measured speeds older than this are ignored (the user may be on another network). */
export const SAMPLE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'sorye.drive.uploadSpeed.v1';

export interface MeasuredSpeed {
  bytesPerSecond: number;
  at: number;
  samples: number;
}

export type SpeedSource = 'measured' | 'connection' | 'unknown';

export interface SpeedEstimate {
  bytesPerSecond: number | null;
  source: SpeedSource;
  /** True when the server throttle is lower than the connection estimate. */
  limitedByServer: boolean;
}

/** Fold one finished upload into the moving average. Returns `previous` unchanged for unusable samples. */
export function addSpeedSample(previous: MeasuredSpeed | null, bytes: number, ms: number, now = Date.now()): MeasuredSpeed | null {
  if (!(bytes >= MIN_SAMPLE_BYTES) || !(ms > 0)) return previous;
  const sample = bytes / (ms / 1000);
  if (!Number.isFinite(sample) || sample <= 0) return previous;
  const usable = previous && now - previous.at <= SAMPLE_MAX_AGE_MS ? previous : null;
  if (!usable) return { bytesPerSecond: sample, at: now, samples: 1 };
  return {
    bytesPerSecond: usable.bytesPerSecond * (1 - SAMPLE_WEIGHT) + sample * SAMPLE_WEIGHT,
    at: now,
    samples: usable.samples + 1,
  };
}

export function estimateUploadSpeed(input: {
  measured: MeasuredSpeed | null;
  downlinkMbps?: number | null;
  throttleBytesPerSecond?: number | null;
  now?: number;
}): SpeedEstimate {
  const now = input.now ?? Date.now();
  let bytesPerSecond: number | null = null;
  let source: SpeedSource = 'unknown';
  if (input.measured && now - input.measured.at <= SAMPLE_MAX_AGE_MS && input.measured.bytesPerSecond > 0) {
    bytesPerSecond = input.measured.bytesPerSecond;
    source = 'measured';
  } else if (typeof input.downlinkMbps === 'number' && input.downlinkMbps > 0) {
    bytesPerSecond = (input.downlinkMbps * 1_000_000) / 8 / 2;
    source = 'connection';
  }
  const throttle = input.throttleBytesPerSecond ?? null;
  let limitedByServer = false;
  if (throttle && throttle > 0 && (bytesPerSecond === null || throttle < bytesPerSecond)) {
    // A known server cap is better evidence than no measurement at all.
    limitedByServer = bytesPerSecond !== null;
    bytesPerSecond = throttle;
    if (source === 'unknown') source = 'connection';
  }
  return { bytesPerSecond, source, limitedByServer };
}

export function readMeasuredSpeed(): MeasuredSpeed | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<MeasuredSpeed>;
    if (typeof value.bytesPerSecond !== 'number' || typeof value.at !== 'number') return null;
    return { bytesPerSecond: value.bytesPerSecond, at: value.at, samples: typeof value.samples === 'number' ? value.samples : 1 };
  } catch {
    return null;
  }
}

export function writeMeasuredSpeed(value: MeasuredSpeed | null): void {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage is a convenience; the estimate falls back to the connection hint.
  }
}

export function connectionDownlinkMbps(): number | null {
  if (typeof navigator === 'undefined') return null;
  const connection = (navigator as Navigator & { connection?: { downlink?: number } }).connection;
  return typeof connection?.downlink === 'number' ? connection.downlink : null;
}

export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}
