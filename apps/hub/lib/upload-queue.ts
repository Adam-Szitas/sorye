'use client';

/**
 * Hub-shell upload manager for Drive. The queue, the File objects and every
 * transfer belong to this module, which lives as long as the Hub page, so
 * uploads keep running while the member moves between Sorye apps. The top bar
 * shows its progress; Drive reads the same store. Apps never own transfers.
 *
 * Each file: SHA-256 in the browser → POST /api/files (XHR, for upload
 * progress) → the server recomputes the hash on the received and stored
 * bytes and refuses a mismatch. A refused or damaged file stays in the queue
 * with a retry while the browser still holds it.
 */

import {
  HUB_NOTIFY_EVENT,
  isCorruptUploadCode,
  planUploadBatch,
  type FileQuota,
  type FileUploadErrorBody,
  type UploadBatchPlan,
} from '@sorye/types';
import {
  addSpeedSample,
  connectionDownlinkMbps,
  estimateUploadSpeed,
  readMeasuredSpeed,
  writeMeasuredSpeed,
  type SpeedEstimate,
} from './upload-speed';

export const DRIVE_FILES_CHANGED_EVENT = 'sorye:drive:files-changed';

export type UploadStatus = 'queued' | 'hashing' | 'uploading' | 'processing' | 'done' | 'failed' | 'corrupted' | 'canceled';

export interface UploadItem {
  id: string;
  batchId: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** Bytes sent so far. */
  loaded: number;
  error: string | null;
  code: string | null;
  workspaceId: string;
  /** The browser still holds the File, so a retry needs no new selection. */
  canRetry: boolean;
  /** The browser computed a SHA-256 the server checked. False in an insecure context. */
  checksummed: boolean;
  queuedAt: number;
  finishedAt: number | null;
}

export interface UploadTotals {
  total: number;
  done: number;
  failed: number;
  active: number;
  bytes: number;
  loadedBytes: number;
}

export interface UploadSnapshot {
  items: UploadItem[];
  totals: UploadTotals;
  /** A notice asked to retry a file this page no longer holds; Drive asks the member to select it again. */
  reselect: { uploadId: string; fileName: string } | null;
}

export interface EnqueueResult {
  queued: number;
  skipped: { name: string; reason: string }[];
  plan: UploadBatchPlan;
  speed: SpeedEstimate;
}

/**
 * Where a queued file goes. Drive is the default; other Hub-native apps (Site media)
 * reuse the same queue, hashing, retries and top-bar progress with their own endpoint.
 * The endpoint accepts the same multipart fields as `/api/files`.
 */
export interface UploadTarget {
  endpoint: string;
  sourceAppId: string;
  /** Window event dispatched with the server's JSON body after a successful upload. */
  doneEvent: string;
}
const DRIVE_TARGET: UploadTarget = { endpoint: '/api/files', sourceAppId: 'files', doneEvent: DRIVE_FILES_CHANGED_EVENT };

interface Entry {
  item: UploadItem;
  file: File | null;
  xhr: XMLHttpRequest | null;
  busyRetries: number;
  notBefore: number;
  target: UploadTarget;
}

const ACTIVE: readonly UploadStatus[] = ['hashing', 'uploading', 'processing'];
const MAX_BUSY_RETRIES = 20;
/** Finished rows kept for the progress list. */
const KEEP_FINISHED = 50;

const entries: Entry[] = [];
const listeners = new Set<() => void>();
let snapshot: UploadSnapshot = { items: [], totals: emptyTotals(), reselect: null };
let reselect: UploadSnapshot['reselect'] = null;
let concurrency = 2;
let currentWorkspaceId: string | null = null;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let throttleBytesPerSecond: number | null = null;
let unloadGuard = false;

function emptyTotals(): UploadTotals {
  return { total: 0, done: 0, failed: 0, active: 0, bytes: 0, loadedBytes: 0 };
}

function computeSnapshot(): UploadSnapshot {
  const items = entries.map((entry) => entry.item);
  const totals = emptyTotals();
  for (const item of items) {
    if (item.status === 'canceled') continue;
    totals.total += 1;
    totals.bytes += item.size;
    if (item.status === 'done') { totals.done += 1; totals.loadedBytes += item.size; continue; }
    if (item.status === 'failed' || item.status === 'corrupted') { totals.failed += 1; continue; }
    totals.active += 1;
    totals.loadedBytes += Math.min(item.loaded, item.size);
  }
  return { items, totals, reselect };
}

function emitNow() {
  if (emitTimer) { clearTimeout(emitTimer); emitTimer = null; }
  snapshot = computeSnapshot();
  syncUnloadGuard();
  for (const listener of listeners) listener();
}

/** Progress events arrive many times a second; publish them at most ~8 times a second. */
function emitSoon() {
  if (emitTimer) return;
  emitTimer = setTimeout(emitNow, 120);
}

function update(entry: Entry, patch: Partial<UploadItem>, immediate = true) {
  entry.item = { ...entry.item, ...patch };
  if (immediate) emitNow(); else emitSoon();
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
}

function syncUnloadGuard() {
  if (typeof window === 'undefined') return;
  const active = snapshot.totals.active > 0;
  if (active && !unloadGuard) window.addEventListener('beforeunload', onBeforeUnload);
  if (!active && unloadGuard) window.removeEventListener('beforeunload', onBeforeUnload);
  unloadGuard = active;
}

export function subscribeUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUploadSnapshot(): UploadSnapshot {
  return snapshot;
}

const EMPTY_SNAPSHOT: UploadSnapshot = { items: [], totals: emptyTotals(), reselect: null };
export function getServerUploadSnapshot(): UploadSnapshot {
  return EMPTY_SNAPSHOT;
}

/** The shell reports the active workspace; queued files of another workspace are not sent. */
export function setUploadWorkspace(workspaceId: string) {
  currentWorkspaceId = workspaceId;
  schedulePump(0);
}

export function currentUploadSpeed(): SpeedEstimate {
  return estimateUploadSpeed({
    measured: readMeasuredSpeed(),
    downlinkMbps: connectionDownlinkMbps(),
    throttleBytesPerSecond,
  });
}

/**
 * Queue files for upload. Files above the server's per-file limit or beyond
 * the workspace file count are skipped with a reason; the rest are capped by
 * the connection estimate (see `planUploadBatch`). The server enforces all
 * limits again on every request.
 */
export function enqueueUploads(files: File[], context: { workspaceId: string; quota: FileQuota }, target: UploadTarget = DRIVE_TARGET): EnqueueResult {
  const { quota } = context;
  concurrency = Math.max(1, Math.min(4, quota.maxConcurrentUploads));
  throttleBytesPerSecond = quota.throttleBytesPerSecond;
  const speed = currentUploadSpeed();
  const skipped: EnqueueResult['skipped'] = [];
  const maxMb = Math.floor(quota.maxFileBytes / (1024 * 1024));

  const pending = entries.filter((entry) => entry.item.status === 'queued' || ACTIVE.includes(entry.item.status));
  let room = Math.max(0, quota.maxFiles - quota.fileCount - pending.length);
  const candidates: File[] = [];
  for (const file of files) {
    if (file.size === 0) { skipped.push({ name: file.name, reason: 'File is empty' }); continue; }
    if (file.size > quota.maxFileBytes) { skipped.push({ name: file.name, reason: `Larger than ${maxMb} MB` }); continue; }
    if (quota.limitBytes !== null && quota.usedBytes + file.size > quota.limitBytes) {
      skipped.push({ name: file.name, reason: 'Not enough space left in your storage' }); continue;
    }
    if (room <= 0) { skipped.push({ name: file.name, reason: `Workspace holds at most ${quota.maxFiles} files` }); continue; }
    room -= 1;
    candidates.push(file);
  }

  // Files already waiting count toward the batch, so repeated selections cannot grow the queue past the cap.
  const plan = planUploadBatch(
    [...pending.map((entry) => Math.max(0, entry.item.size - entry.item.loaded)), ...candidates.map((file) => file.size)],
    { bytesPerSecond: speed.bytesPerSecond, maxBatchFiles: quota.maxBatchFiles },
  );
  const accepted = Math.max(0, Math.min(candidates.length, plan.accepted - pending.length));
  for (const file of candidates.slice(accepted)) skipped.push({ name: file.name, reason: 'Batch limit for your connection' });

  const batchId = crypto.randomUUID();
  const now = Date.now();
  for (const file of candidates.slice(0, accepted)) {
    entries.push({
      item: {
        id: crypto.randomUUID(), batchId, name: file.name, size: file.size, status: 'queued', loaded: 0,
        error: null, code: null, workspaceId: context.workspaceId, canRetry: true, checksummed: false,
        queuedAt: now, finishedAt: null,
      },
      file, xhr: null, busyRetries: 0, notBefore: 0, target,
    });
  }
  if (reselect && candidates.slice(0, accepted).some((file) => file.name === reselect?.fileName)) reselect = null;
  prune();
  emitNow();
  schedulePump(0);
  return { queued: accepted, skipped, plan: { ...plan, accepted }, speed };
}

function prune() {
  const finished = entries.filter((entry) => entry.item.status === 'done' || entry.item.status === 'canceled');
  let excess = finished.length - KEEP_FINISHED;
  for (let i = 0; i < entries.length && excess > 0;) {
    const entry = entries[i]!;
    if (entry.item.status === 'done' || entry.item.status === 'canceled') { entries.splice(i, 1); excess -= 1; } else i += 1;
  }
}

function schedulePump(delay: number) {
  if (typeof window === 'undefined') return;
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, delay);
}

function pump() {
  const running = entries.filter((entry) => ACTIVE.includes(entry.item.status)).length;
  let free = concurrency - running;
  const now = Date.now();
  let nextWake = Infinity;
  for (const entry of entries) {
    if (free <= 0) break;
    if (entry.item.status !== 'queued') continue;
    if (entry.notBefore > now) { nextWake = Math.min(nextWake, entry.notBefore - now); continue; }
    if (currentWorkspaceId && entry.item.workspaceId !== currentWorkspaceId) {
      finishFailed(entry, 'You switched workspace before this file was uploaded. Switch back and retry.', 'workspace_changed', true);
      continue;
    }
    free -= 1;
    void run(entry);
  }
  if (nextWake !== Infinity) schedulePump(nextWake);
}

async function sha256Hex(file: File): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null; // Insecure context: the server still hashes what it stores.
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface SendResult {
  status: number;
  body: (FileUploadErrorBody & { file?: unknown }) | null;
  retryAfter: number | null;
  /**
   * Milliseconds from the first byte sent to the server's answer. The browser's
   * own "all sent" event fires when bytes reach the OS socket buffer, which can
   * be megabytes ahead of a throttled or slow server, so it overstates speed.
   */
  requestMs: number | null;
  network: boolean;
  aborted: boolean;
}

function send(entry: Entry, form: FormData): Promise<SendResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    entry.xhr = xhr;
    let startedAt = 0;
    xhr.open('POST', entry.target.endpoint);
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    xhr.upload.onloadstart = () => { startedAt = performance.now(); };
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) update(entry, { loaded: Math.min(entry.item.size, Math.round((event.loaded / event.total) * entry.item.size)) }, false);
    };
    xhr.upload.onload = () => {
      update(entry, { loaded: entry.item.size, status: 'processing' });
    };
    const finish = (partial: Partial<SendResult>) => {
      entry.xhr = null;
      const requestMs = startedAt ? performance.now() - startedAt : null;
      resolve({ status: 0, body: null, retryAfter: null, requestMs, network: false, aborted: false, ...partial });
    };
    xhr.onload = () => {
      let body: SendResult['body'] = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
      const retryAfter = Number(xhr.getResponseHeader('Retry-After'));
      finish({ status: xhr.status, body, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null });
    };
    xhr.onerror = () => finish({ network: true });
    xhr.ontimeout = () => finish({ network: true });
    xhr.onabort = () => finish({ aborted: true });
    xhr.send(form);
  });
}

async function run(entry: Entry) {
  const file = entry.file;
  if (!file) { finishFailed(entry, 'Select this file again to upload it.', 'rejected', false); return; }
  update(entry, { status: 'hashing', loaded: 0, error: null, code: null });
  let sha256: string | null;
  try {
    sha256 = await sha256Hex(file);
  } catch {
    finishFailed(entry, 'This file could not be read. It may have been moved or changed.', 'rejected', true);
    return;
  }
  if ((entry.item.status as UploadStatus) !== 'hashing') return; // Canceled while hashing.

  const form = new FormData();
  form.append('file', file, file.name);
  form.append('sourceAppId', entry.target.sourceAppId);
  form.append('uploadId', entry.item.id);
  form.append('batchId', entry.item.batchId);
  form.append('expectedWorkspaceId', entry.item.workspaceId);
  if (sha256) form.append('sha256', sha256);
  update(entry, { status: 'uploading', checksummed: Boolean(sha256) });

  const result = await send(entry, form);
  if (result.aborted) {
    if ((entry.item.status as UploadStatus) !== 'canceled') update(entry, { status: 'canceled', finishedAt: Date.now() });
    schedulePump(0);
    return;
  }
  if (result.network) {
    finishFailed(entry, 'The connection dropped during the upload.', 'network', true);
    if (entry.target === DRIVE_TARGET) reportClientFailure(entry, 'network');
    return;
  }
  if (result.status === 429 && entry.busyRetries < MAX_BUSY_RETRIES) {
    // Server slots are busy: wait as told and try again; this is not a failure.
    entry.busyRetries += 1;
    entry.notBefore = Date.now() + (result.retryAfter ?? 2) * 1000 + Math.random() * 500;
    update(entry, { status: 'queued', loaded: 0 });
    schedulePump(0);
    return;
  }
  if (result.status >= 200 && result.status < 300) {
    if (result.requestMs) writeMeasuredSpeed(addSpeedSample(readMeasuredSpeed(), file.size, result.requestMs));
    entry.file = null; // Release the bytes; nothing left to retry.
    update(entry, { status: 'done', loaded: entry.item.size, canRetry: false, finishedAt: Date.now() });
    if (entry.target !== DRIVE_TARGET) {
      try { window.dispatchEvent(new CustomEvent(entry.target.doneEvent, { detail: result.body })); } catch { /* ignore */ }
    }
    afterServerOutcome();
    schedulePump(0);
    return;
  }
  const code = result.body?.code ?? null;
  const message = result.body?.error ?? `Upload failed (${result.status})`;
  finishFailed(entry, message, code, true, result.body?.corrupted || isCorruptUploadCode(code));
  // The server already recorded a notice for failures it saw, except a workspace change.
  if (code === 'workspace_changed' && entry.target === DRIVE_TARGET) reportClientFailure(entry, 'workspace_changed');
  else afterServerOutcome();
}

function finishFailed(entry: Entry, error: string, code: string | null, canRetry: boolean, corrupted = false) {
  update(entry, {
    status: corrupted ? 'corrupted' : 'failed', error, code,
    canRetry: canRetry && Boolean(entry.file), finishedAt: Date.now(),
  });
  schedulePump(0);
}

function afterServerOutcome() {
  try {
    window.dispatchEvent(new CustomEvent(DRIVE_FILES_CHANGED_EVENT));
    window.dispatchEvent(new CustomEvent(HUB_NOTIFY_EVENT));
  } catch { /* ignore */ }
}

function reportClientFailure(entry: Entry, reason: 'network' | 'workspace_changed') {
  void fetch('/api/files/upload-failures', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId: entry.item.id, batchId: entry.item.batchId, fileName: entry.item.name, reason }),
  }).then(() => afterServerOutcome()).catch(() => undefined);
}

/** Retry one failed or damaged file. False when this page no longer holds it. */
export function retryUpload(id: string): boolean {
  const entry = entries.find((candidate) => candidate.item.id === id);
  if (!entry || !entry.file) return false;
  if (entry.item.status !== 'failed' && entry.item.status !== 'corrupted' && entry.item.status !== 'canceled') return true;
  entry.busyRetries = 0;
  entry.notBefore = 0;
  // Retry in the workspace that is active now; the server checks it again.
  update(entry, {
    status: 'queued', loaded: 0, error: null, code: null, finishedAt: null,
    workspaceId: currentWorkspaceId ?? entry.item.workspaceId,
  });
  schedulePump(0);
  return true;
}

/** Retry from a Hub notice. When the file is gone (page reloaded), Drive asks for it again. */
export function retryUploadFromNotice(uploadId: string, fileName: string): boolean {
  if (retryUpload(uploadId)) return true;
  reselect = { uploadId, fileName };
  emitNow();
  return false;
}

export function clearReselect() {
  reselect = null;
  emitNow();
}

export function cancelUpload(id: string) {
  const entry = entries.find((candidate) => candidate.item.id === id);
  if (!entry) return;
  if (entry.xhr) { entry.item = { ...entry.item, status: 'canceled', finishedAt: Date.now() }; entry.xhr.abort(); emitNow(); return; }
  if (entry.item.status === 'queued' || entry.item.status === 'hashing') update(entry, { status: 'canceled', finishedAt: Date.now() });
  schedulePump(0);
}

export function dismissUpload(id: string) {
  const index = entries.findIndex((candidate) => candidate.item.id === id);
  if (index < 0) return;
  const entry = entries[index]!;
  if (entry.item.status === 'queued' || ACTIVE.includes(entry.item.status)) return;
  entries.splice(index, 1);
  emitNow();
}

export function clearFinishedUploads() {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const status = entries[i]!.item.status;
    if (status === 'done' || status === 'canceled') entries.splice(i, 1);
  }
  emitNow();
}
