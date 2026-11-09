/**
 * Yearly electricity floor for one running Sorye stack.
 *
 * This is a cost-recovery model, not a measured bill and not a markup.
 * Production shape: one app VM (Hub reserved at 2 GB, one 128 MB gateway
 * per app) plus Postgres on a data VM, and the local 12 GB GPU service
 * kept up for OCR (`docker-compose.yml` profile `qwen-local`).
 *
 * Rate: CBS, electricity, households using 2.5–5 MWh, total price including
 * VAT and tax, first half of 2026 (provisional): €0.244/kWh. That per-kWh
 * total already averages network charges for the band, so a second
 * connection's standing charge is not added.
 *
 * Draw is a planning assumption, not a meter reading: 25 W average for the
 * dedicated app and database machine, 15 W idle for the 12 GB GPU left in
 * the machine, and 120 W above idle for half an hour a day of single-sequence
 * OCR. Studio WebGPU, and the SUSM / ESPM sites, burn power outside this bill.
 * Fly Managed Postgres is not included; that would be a separate invoice.
 */

export const ELECTRICITY_EUR_PER_KWH = 0.244;

/** Average draw of the dedicated Hub, gateway, and Postgres machine. */
export const APP_HOST_AVERAGE_WATTS = 25;

/** Idle draw of the 12 GB GPU while the OCR model service stays up. */
export const GPU_IDLE_WATTS = 15;

/** Extra draw above idle during one OCR inference. */
export const GPU_INFERENCE_EXTRA_WATTS = 120;

/** Hours in a non-leap year. */
export const HOURS_PER_YEAR = 8760;

/**
 * Euro cents for a constant load.
 * `cents = watts * hours * 0.244 * 100 / 1000`, evaluated in integers.
 * Pass `hourDenominator` when the duty cycle is a fraction of an hour.
 */
export function electricityCents(
  watts: number,
  hourNumerator: number,
  hourDenominator = 1,
): number {
  return Math.round(
    (watts * hourNumerator * 244) / (10_000 * hourDenominator),
  );
}

export interface RunningCostApp {
  id: string;
  /** 0 = not sold on its own. Its host electricity stays in the shared pool. */
  costWeight: 0 | 1 | 2 | 3 | 4;
  serverGpu?: boolean;
}

export interface RunningCostQuote {
  hostCents: number;
  gpuIdleCents: number;
  gpuInferenceCents: number;
  gpuCents: number;
  /** Host plus GPU. Sum of `byAppId` equals this when a server-GPU app exists. */
  yearlyCents: number;
  byAppId: Record<string, number>;
}

function splitCents(
  total: number,
  parts: ReadonlyArray<{ id: string; weight: number }>,
): Record<string, number> {
  const weightSum = parts.reduce((sum, part) => sum + part.weight, 0);
  const shares: Record<string, number> = {};
  if (weightSum <= 0 || total <= 0) {
    for (const part of parts) shares[part.id] = 0;
    return shares;
  }
  let assigned = 0;
  for (const part of parts) {
    const share = Math.floor((total * part.weight) / weightSum);
    shares[part.id] = share;
    assigned += share;
  }
  let remainder = total - assigned;
  for (const part of parts) {
    if (remainder <= 0) break;
    shares[part.id] = (shares[part.id] ?? 0) + 1;
    remainder -= 1;
  }
  return shares;
}

/** Allocate the stack bill across apps. Catalog order decides leftover cents. */
export function quoteRunningCost(
  apps: readonly RunningCostApp[],
): RunningCostQuote {
  const hostCents = electricityCents(APP_HOST_AVERAGE_WATTS, HOURS_PER_YEAR);
  const gpuIdleCents = electricityCents(GPU_IDLE_WATTS, HOURS_PER_YEAR);
  const gpuInferenceCents = electricityCents(
    GPU_INFERENCE_EXTRA_WATTS,
    365,
    2,
  );
  const gpuCents = gpuIdleCents + gpuInferenceCents;

  const sold = apps.filter((app) => app.costWeight > 0);
  const hostShares = splitCents(
    hostCents,
    sold.map((app) => ({ id: app.id, weight: app.costWeight })),
  );
  const gpuApps = apps.filter((app) => app.serverGpu === true);
  const gpuShares = splitCents(
    gpuCents,
    gpuApps.map((app) => ({ id: app.id, weight: 1 })),
  );

  const byAppId: Record<string, number> = {};
  for (const app of apps) {
    byAppId[app.id] = (hostShares[app.id] ?? 0) + (gpuShares[app.id] ?? 0);
  }

  return {
    hostCents,
    gpuIdleCents,
    gpuInferenceCents,
    gpuCents,
    yearlyCents: hostCents + gpuCents,
    byAppId,
  };
}

/** Stable euro display. Avoids runtime locale differences. */
export function formatEur(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}€${euros}.${String(rem).padStart(2, '0')}`;
}
