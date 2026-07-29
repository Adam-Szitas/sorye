export type FeatureFlags = {
  /** Log hub session + UI state on user interactions (browser console). */
  showLogs: boolean;
};

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/** Server-side feature flags (env). */
export function getFeatureFlags(): FeatureFlags {
  return {
    showLogs:
      parseBool(process.env.FEATURE_SHOW_LOGS) ||
      parseBool(process.env.NEXT_PUBLIC_FEATURE_SHOW_LOGS),
  };
}

/** Client-safe flags (only NEXT_PUBLIC_* are available in the browser). */
export function getClientFeatureFlags(): FeatureFlags {
  return {
    showLogs: parseBool(process.env.NEXT_PUBLIC_FEATURE_SHOW_LOGS),
  };
}
