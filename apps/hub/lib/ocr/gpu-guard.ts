import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function checkGpuSample(csv: string): void {
  const values = csv.trim().split(',').map(Number);
  const [free, total, temperature] = values;
  if (values.length !== 3 || !values.every(Number.isFinite) || total <= 0 || free < 0 || free > total || temperature < 0) {
    throw new Error('GPU status could not be verified. Try again after checking NVIDIA drivers.');
  }
  if (free < 1536 || temperature >= 85) {
    throw new Error('GPU is under memory or thermal pressure. Close other GPU workloads and retry.');
  }
}

/** Local NVIDIA host only. Opt in; fail closed if telemetry is unavailable. */
export async function assertGpuHeadroom(): Promise<void> {
  if (process.env.OCR_GPU_GUARD !== 'true') return;
  let stdout: string;
  try {
    ({ stdout } = await execute('nvidia-smi', [
      '--id=0', '--query-gpu=memory.free,memory.total,temperature.gpu',
      '--format=csv,noheader,nounits',
    ], { timeout: 3000, maxBuffer: 4096, windowsHide: true }));
  } catch {
    throw new Error('GPU status is unavailable. Check NVIDIA drivers before retrying OCR.');
  }
  checkGpuSample(stdout);
}
