import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHubEnv } from '../lib/workers/load-hub-env';

loadHubEnv();

const hubRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgres = process.env.STORE_DRIVER === 'postgres';
let stopping = false;
let workerTimer: ReturnType<typeof setTimeout> | null = null;

function start(command: string, args: string[]): ChildProcess {
  return spawn(command, args, {
    cwd: hubRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}

function stopChild(child: ChildProcess | null) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', shell: true });
    return;
  }
  child.kill('SIGTERM');
}

const next = start('next', ['dev', '--turbopack', '--port', '3000']);
let worker: ChildProcess | null = null;

function startWorker() {
  if (stopping || !postgres) return;
  worker = start('tsx', ['lib/workers/start-ocr-worker.ts']);
  worker.on('exit', (code, signal) => {
    worker = null;
    if (stopping || signal) return;
    console.error(`[ocr-worker] exited (${code ?? 'unknown'}). Restarting shortly.`);
    workerTimer = setTimeout(startWorker, 3_000);
  });
}

if (postgres) startWorker();

function stop(code: number) {
  if (stopping) return;
  stopping = true;
  if (workerTimer) clearTimeout(workerTimer);
  stopChild(worker);
  stopChild(next);
  setTimeout(() => process.exit(code), 400);
}

next.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
