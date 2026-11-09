import { jsonDataFile } from '@/lib/store/json-file';
import {
  hydrateOperatorState,
  setOperatorPersist,
  type PersistedOperatorMetrics,
} from '@/lib/operator/sink';

const empty = (): PersistedOperatorMetrics => ({
  hours: {},
  days: {},
  activity: [],
  errors: [],
});

const file = jsonDataFile<PersistedOperatorMetrics>('operator-metrics.json', empty);

let installed = false;

/** Load bounded aggregates once, then persist later writes without blocking callers. */
export async function installOperatorPersistence(): Promise<void> {
  if (installed) return;
  installed = true;
  try {
    hydrateOperatorState(await file.read());
  } catch {
    hydrateOperatorState(null);
  }
  setOperatorPersist(async (state) => {
    await file.update((current) => {
      current.hours = state.hours;
      current.days = state.days;
      current.activity = state.activity;
      current.errors = state.errors;
    });
  });
}
