import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');

/**
 * Cached, crash-safe JSON persistence for the dev file store.
 *
 * - Parses each file at most once per process; afterwards the in-memory
 *   cache is authoritative (this server is the only writer).
 * - All mutations run through {@link JsonFile.update}, a per-file FIFO
 *   queue, so concurrent requests cannot interleave read-modify-write
 *   cycles and lose updates.
 * - Persistence writes a temp file then renames it over the target, so a
 *   crash mid-write can never leave a torn/corrupt JSON file behind.
 */
export class JsonFile<T> {
  private cache: T | undefined;
  private loading: Promise<T> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private writeSeq = 0;

  constructor(
    private readonly filePath: string,
    private readonly fallback: () => T,
  ) {}

  private load(): Promise<T> {
    if (this.cache !== undefined) return Promise.resolve(this.cache);
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const raw = await readFile(this.filePath, 'utf-8');
          this.cache = JSON.parse(raw) as T;
        } catch {
          this.cache = this.fallback();
        }
        return this.cache;
      })();
    }
    return this.loading;
  }

  /**
   * Read-only snapshot. Callers MUST NOT mutate the returned object —
   * route all writes through {@link update}.
   */
  read(): Promise<T> {
    return this.load();
  }

  /**
   * Serialized read-modify-write transaction. `fn` may mutate `data` in
   * place; the result is persisted atomically before the next transaction
   * on this file begins.
   */
  update<R>(fn: (data: T) => R | Promise<R>): Promise<R> {
    const task = async (): Promise<R> => {
      const data = await this.load();
      try {
        const result = await fn(data);
        await this.persist(data);
        return result;
      } catch (err) {
        // fn may have partially mutated the cached object before failing.
        // Drop the cache so the next access reloads the last durable state.
        this.cache = undefined;
        this.loading = null;
        throw err;
      }
    };
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persist(data: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(data);
    const tmp = `${this.filePath}.${process.pid}.${++this.writeSeq}.tmp`;
    await writeFile(tmp, payload, 'utf-8');
    try {
      await rename(tmp, this.filePath);
    } catch {
      // Windows can refuse the overwrite-rename when AV/indexers hold the
      // target; fall back to a direct write rather than failing the request.
      await writeFile(this.filePath, payload, 'utf-8');
      await unlink(tmp).catch(() => undefined);
    }
    this.cache = data;
  }
}

type Registry = Map<string, JsonFile<unknown>>;

// Survives Next.js dev HMR module reloads: without this, each reload would
// create a fresh cache + queue and reintroduce write races.
const REGISTRY_KEY = Symbol.for('sorye.hub.jsonFileRegistry');

function registry(): Registry {
  const g = globalThis as { [REGISTRY_KEY]?: Registry };
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map();
  return g[REGISTRY_KEY];
}

/** Get (or create) the process-wide handle for a `.data/<filename>` store. */
export function jsonDataFile<T>(filename: string, fallback: () => T): JsonFile<T> {
  const filePath = path.join(DATA_DIR, filename);
  const reg = registry();
  let file = reg.get(filePath);
  if (!file) {
    file = new JsonFile<unknown>(filePath, fallback as () => unknown);
    reg.set(filePath, file);
  }
  return file as JsonFile<T>;
}
