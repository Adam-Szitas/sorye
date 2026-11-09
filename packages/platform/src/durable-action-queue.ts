/**
 * Browser-owned durable queue for actions sent through an authenticated Hub API.
 * Scope must be an opaque value derived by the server for the current user and
 * workspace. Credentials and assertions are deliberately not part of this API.
 */

export type DurableActionOutcome = {
  actionId: string;
  status: 'committed' | 'duplicate' | 'conflict' | 'rejected';
  error?: { code: string; message?: string };
  commitId?: string;
  revision?: number;
};

export type DurableQueuedAction<TAction extends { actionId: string }> = {
  appId: string;
  scope: string;
  action: TAction;
  createdAt: number;
  attempts: number;
  status: 'pending' | 'failed' | 'conflict' | 'rejected';
  lastError?: { code: string; message?: string };
};

type StoredRow = DurableQueuedAction<{ actionId: string }> & { key: string; partition: string };

export type DurableActionQueue<TAction extends { actionId: string }> = {
  /** Resolves only after the IndexedDB read/write transaction completes. */
  enqueue(action: TAction): Promise<DurableQueuedAction<TAction>>;
  list(): Promise<DurableQueuedAction<TAction>[]>;
  /** Increment attempts without changing the stored action or its identity. */
  markAttempt(actionId: string): Promise<void>;
  markTransportFailure(actionId: string, error: { code: string; message?: string }): Promise<void>;
  /** Deletes only on committed/duplicate. Other outcomes remain inspectable. */
  settle(outcome: DurableActionOutcome): Promise<void>;
  /** Explicit user reconciliation/discard operation. */
  discard(actionId: string): Promise<void>;
  close(): void;
};

const DB_NAME = 'sorye-durable-action-queue-v1';
const STORE = 'actions';
const DEFAULT_MAX_ROWS = 500;
const ABSOLUTE_MAX_ROWS = 2_000;
const MAX_ACTION_BYTES = 128 * 1024;
const SAFE_ERROR = /^[a-zA-Z0-9_.:-]{1,96}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  throw new TypeError('Action must contain only JSON values');
}

function containsCredentialKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialKey);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /^(authorization|token|access.?token|refresh.?token|password|secret|credential)$/i.test(key) || containsCredentialKey(child));
}

function validateAction(action: { actionId: string }): string {
  if (!action || typeof action !== 'object' || typeof action.actionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(action.actionId)) {
    throw new TypeError('actionId must be a UUID');
  }
  const serialized = canonical(action);
  if (new TextEncoder().encode(serialized).byteLength > MAX_ACTION_BYTES) throw new RangeError('Action exceeds local queue size limit');
  if (containsCredentialKey(action)) {
    throw new TypeError('Credentials and secret values must not be queued');
  }
  return serialized;
}

function validateError(error: { code: string; message?: string } | undefined) {
  if (!error) return undefined;
  return {
    code: SAFE_ERROR.test(error.code) ? error.code : 'unknown_error',
    ...(typeof error.message === 'string' ? { message: error.message.slice(0, 240) } : {}),
  };
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function createDurableActionQueue<TAction extends { actionId: string }>(options: {
  appId: string;
  /** Opaque server-derived user/workspace partition; never an auth token. */
  scope: string;
  maxRows?: number;
  indexedDB?: IDBFactory;
}): DurableActionQueue<TAction> {
  const { appId, scope } = options;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(appId)) throw new TypeError('Invalid appId');
  if (typeof scope !== 'string' || scope.length < 1 || scope.length > 256) throw new TypeError('Invalid opaque queue scope');
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > ABSOLUTE_MAX_ROWS) throw new RangeError('maxRows must be between 1 and 2000');
  if (!factory) throw new Error('IndexedDB is unavailable');

  const partition = JSON.stringify([appId, scope]);
  let dbPromise: Promise<IDBDatabase> | undefined;
  const db = () => dbPromise ??= new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('partition', 'partition', { unique: false });
        store.createIndex('partition_created', ['partition', 'createdAt'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open action queue'));
    request.onblocked = () => reject(new Error('Action queue upgrade is blocked'));
  });
  const rowKey = (actionId: string) => `${partition}\u0000${actionId}`;

  return {
    async enqueue(action) {
      const encoded = validateAction(action);
      const database = await db();
      const tx = database.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const key = rowKey(action.actionId);
      let answer: StoredRow | undefined;
      let failure: Error | undefined;
      const existingRequest = store.get(key);
      existingRequest.onsuccess = () => {
        const existing = existingRequest.result as StoredRow | undefined;
        if (existing) {
          if (canonical(existing.action) !== encoded) failure = new Error('actionId already exists with a different payload');
          else answer = existing;
          return;
        }
        const countRequest = store.index('partition').count(partition);
        countRequest.onsuccess = () => {
          if (countRequest.result >= maxRows) {
            failure = new RangeError('Durable action queue is full');
            tx.abort();
            return;
          }
          const row: StoredRow = { key, partition, appId, scope, action: structuredClone(action), createdAt: Date.now(), attempts: 0, status: 'pending' };
          answer = row;
          store.add(row);
        };
        countRequest.onerror = () => { failure = countRequest.error ?? new Error('Unable to count queued actions'); tx.abort(); };
      };
      existingRequest.onerror = () => { failure = existingRequest.error ?? new Error('Unable to read queued action'); tx.abort(); };
      try { await transactionDone(tx); } catch (error) { throw failure ?? error; }
      if (failure) throw failure;
      return structuredClone(answer!.action ? { appId, scope, action: answer!.action as TAction, createdAt: answer!.createdAt, attempts: answer!.attempts, status: answer!.status, ...(answer!.lastError ? { lastError: answer!.lastError } : {}) } : answer!) as DurableQueuedAction<TAction>;
    },
    async list() {
      const database = await db();
      const tx = database.transaction(STORE, 'readonly');
      const rows = await requestResult(tx.objectStore(STORE).index('partition').getAll(partition)) as StoredRow[];
      await transactionDone(tx);
      return rows.sort((a, b) => a.createdAt - b.createdAt).map(({ appId: rowApp, scope: rowScope, action, createdAt, attempts, status, lastError }) => ({ appId: rowApp, scope: rowScope, action: action as TAction, createdAt, attempts, status, ...(lastError ? { lastError } : {}) }));
    },
    async markAttempt(actionId) {
      await updateRow(actionId, (row) => { row.attempts += 1; if (row.status === 'failed') row.status = 'pending'; delete row.lastError; });
    },
    async markTransportFailure(actionId, error) {
      await updateRow(actionId, (row) => { row.status = 'failed'; row.lastError = validateError(error); });
    },
    async settle(outcome) {
      const database = await db();
      const tx = database.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(rowKey(outcome.actionId));
      request.onsuccess = () => {
        const row = request.result as StoredRow | undefined;
        if (!row) return;
        if (outcome.status === 'committed' || outcome.status === 'duplicate') store.delete(row.key);
        else {
          row.status = outcome.status === 'conflict' ? 'conflict' : outcome.error?.code === 'provider_unavailable' ? 'failed' : 'rejected';
          row.lastError = validateError(outcome.error ?? { code: outcome.status });
          store.put(row);
        }
      };
      await transactionDone(tx);
    },
    async discard(actionId) {
      const database = await db();
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(rowKey(actionId));
      await transactionDone(tx);
    },
    close() { void dbPromise?.then((database) => database.close()); dbPromise = undefined; },
  };

  async function updateRow(actionId: string, update: (row: StoredRow) => void) {
    const database = await db();
    const tx = database.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(rowKey(actionId));
    request.onsuccess = () => { const row = request.result as StoredRow | undefined; if (row) { update(row); store.put(row); } };
    await transactionDone(tx);
  }
}
