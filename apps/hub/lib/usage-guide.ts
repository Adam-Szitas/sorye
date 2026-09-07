/** Presentational try-out remotes opened from Contact. */
export const PRESENTATIONAL_TRYOUT_APP_IDS = new Set([
  'protocolio',
  'canvas',
]);

/** Presentational try-out apps + Contact — no first-run “how to use” overlay. */
export const HIDE_USAGE_GUIDE_APP_IDS = new Set([
  'contact',
  'site',
  ...PRESENTATIONAL_TRYOUT_APP_IDS,
]);

export function shouldShowUsageGuide(appId: string): boolean {
  return !HIDE_USAGE_GUIDE_APP_IDS.has(appId);
}

export function isPresentationalTryoutApp(appId: string): boolean {
  return PRESENTATIONAL_TRYOUT_APP_IDS.has(appId);
}
