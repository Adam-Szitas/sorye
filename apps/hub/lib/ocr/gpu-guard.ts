import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HostGpuDescriptor } from '@sorye/types';
import { getLlmControlSettings, logLlmActivity } from '../llm-control';

const execute = promisify(execFile);

export class GpuCapacityError extends Error {}

export interface GpuSnapshot {
  index?: number;
  name: string;
  usedMiB: number;
  totalMiB: number;
  freeMiB: number;
  temperatureC: number;
}

export function checkGpuSample(csv: string, minFreeMiB = 1536): void {
  const values = csv.trim().split(',').map(Number);
  const [free, total, temperature] = values;
  if (values.length !== 3 || !values.every(Number.isFinite) || total <= 0 || free < 0 || free > total || temperature < 0) {
    throw new Error('GPU status could not be verified. Try again after checking NVIDIA drivers.');
  }
  if (free < minFreeMiB || temperature >= 85) {
    throw new Error('GPU is under memory or thermal pressure. Close other GPU workloads and retry.');
  }
}

export function parseGpuListCsv(stdout: string): HostGpuDescriptor[] {
  const lines = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const gpus: HostGpuDescriptor[] = [];
  for (const line of lines) {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length !== 6) continue;
    const [indexStr, name, usedStr, totalStr, freeStr, tempStr] = parts;
    const index = Number(indexStr);
    const usedMiB = Number(usedStr);
    const totalMiB = Number(totalStr);
    const freeMiB = Number(freeStr);
    const temperatureC = Number(tempStr);
    if (
      !name ||
      !Number.isInteger(index) ||
      index < 0 ||
      ![usedMiB, totalMiB, freeMiB, temperatureC].every(Number.isFinite) ||
      totalMiB <= 0 ||
      usedMiB < 0 ||
      freeMiB < 0 ||
      freeMiB > totalMiB ||
      temperatureC < 0
    ) {
      continue;
    }
    gpus.push({ index, name, usedMiB, totalMiB, freeMiB, temperatureC });
  }
  return gpus;
}

export async function listHostGpus(): Promise<HostGpuDescriptor[]> {
  try {
    const { stdout } = await execute(
      'nvidia-smi',
      [
        '--query-gpu=index,name,memory.used,memory.total,memory.free,temperature.gpu',
        '--format=csv,noheader,nounits',
      ],
      { timeout: 3000, maxBuffer: 8192, windowsHide: true },
    );
    return parseGpuListCsv(stdout);
  } catch {
    return [];
  }
}

export async function readGpuSnapshot(gpuIndex?: number): Promise<GpuSnapshot> {
  const targetIndex =
    typeof gpuIndex === 'number' && Number.isInteger(gpuIndex) && gpuIndex >= 0
      ? gpuIndex
      : getLlmControlSettings().gpuIndex ?? 0;
  const { stdout } = await execute('nvidia-smi', [
    `--id=${targetIndex}`, '--query-gpu=name,memory.used,memory.total,memory.free,temperature.gpu',
    '--format=csv,noheader,nounits',
  ], { timeout: 3000, maxBuffer: 4096, windowsHide: true });
  const values = stdout.trim().split(',').map((value) => value.trim());
  const [name, used, total, free, temperature] = values;
  const numbers = [used, total, free, temperature].map(Number);
  if (values.length !== 5 || !name || !numbers.every(Number.isFinite)) {
    throw new Error('GPU status could not be verified. Check NVIDIA drivers.');
  }
  const [usedMiB, totalMiB, freeMiB, temperatureC] = numbers;
  if (totalMiB! <= 0 || usedMiB! < 0 || freeMiB! < 0 || freeMiB! > totalMiB! || temperatureC! < 0) {
    throw new Error('GPU returned invalid memory or temperature values.');
  }
  return { index: targetIndex, name, usedMiB: usedMiB!, totalMiB: totalMiB!, freeMiB: freeMiB!, temperatureC: temperatureC! };
}

/** Local NVIDIA host only. Enabled by default; fail closed if telemetry is unavailable. */
export async function assertGpuHeadroom(gpuIndex?: number): Promise<void> {
  if (process.env.OCR_GPU_GUARD === 'false') {
    logLlmActivity({ type: 'gpu_check', status: 'ok', detail: 'GPU guard disabled by environment.' });
    return;
  }
  let snapshot: GpuSnapshot;
  try {
    snapshot = await readGpuSnapshot(gpuIndex);
  } catch (err) {
    logLlmActivity({ type: 'gpu_rejected', status: 'error', detail: 'GPU telemetry is unavailable.' });
    throw new GpuCapacityError(err instanceof Error ? err.message : 'GPU status is unavailable.');
  }
  try {
    checkGpuSample(`${snapshot.freeMiB},${snapshot.totalMiB},${snapshot.temperatureC}`, getLlmControlSettings().minFreeVramMiB);
    logLlmActivity({
      type: 'gpu_check', status: 'ok', gpuUsedMiB: snapshot.usedMiB, gpuFreeMiB: snapshot.freeMiB,
      gpuTotalMiB: snapshot.totalMiB, temperatureC: snapshot.temperatureC,
    });
  } catch (err) {
    logLlmActivity({
      type: 'gpu_rejected', status: 'blocked', gpuUsedMiB: snapshot.usedMiB,
      gpuFreeMiB: snapshot.freeMiB, gpuTotalMiB: snapshot.totalMiB,
      temperatureC: snapshot.temperatureC, detail: err instanceof Error ? err.message : 'GPU pressure.',
    });
    throw new GpuCapacityError(err instanceof Error ? err.message : 'GPU capacity is unavailable.');
  }
}
