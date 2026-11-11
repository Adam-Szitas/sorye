/**
 * Startup configuration report for `docker logs`. Lists missing or invalid
 * settings by NAME with what each one breaks. Never prints values and never
 * throws: a bad setting must not take the whole Hub down at startup.
 */

type Finding = { level: 'error' | 'warn'; setting: string; effect: string };

export function configFindings(env: NodeJS.ProcessEnv = process.env): Finding[] {
  const has = (name: string) => Boolean(env[name]?.trim());
  const production = env.NODE_ENV === 'production';
  const findings: Finding[] = [];
  const need = (setting: string, effect: string, level: Finding['level'] = 'error') => {
    if (!env[setting]?.trim()) findings.push({ level, setting, effect });
  };

  need('AUTH_SECRET', 'sessions cannot be signed: nobody can sign in');
  need('ADMIN_SECRET', 'settings validation fails: pages that read settings return errors');
  if (env.AUTH_DEV_BYPASS !== 'true' || production) {
    need('AUTH_GOOGLE_ID', 'Google sign-in is not configured: sign-in and pages that read settings fail');
    need('AUTH_GOOGLE_SECRET', 'Google sign-in is not configured: sign-in and pages that read settings fail');
  }
  if ((env.STORE_DRIVER ?? 'json') === 'postgres') need('DATABASE_URL', 'STORE_DRIVER=postgres without a database: nothing can be stored');
  if (production && (env.STORE_DRIVER ?? 'json') !== 'postgres') {
    findings.push({ level: 'error', setting: 'STORE_DRIVER', effect: 'production requires STORE_DRIVER=postgres' });
  }
  if (production) {
    need('AUTH_TRUST_HOST', 'behind a reverse proxy Auth.js does not trust the host: set AUTH_TRUST_HOST=true (leave AUTH_URL unset)', 'warn');
    need('SORYE_PUBLIC_HOST', 'public host defaults to sorye.app; other domains get 421 Misdirected request', 'warn');
    need('ADMIN_EMAILS', 'no platform administrators: the administration console is closed', 'warn');
    if ((env.FILE_STORE_DRIVER ?? 'local') !== 's3') {
      findings.push({ level: 'error', setting: 'FILE_STORE_DRIVER', effect: 'production file storage needs FILE_STORE_DRIVER=s3 and FILE_S3_BUCKET: uploads and downloads fail' });
    } else {
      need('FILE_S3_BUCKET', 'file uploads and downloads fail');
    }
    for (const forbidden of ['AUTH_URL', 'AUTH_DEV_BYPASS', 'BILLING_SIMULATOR', 'OWN_STORAGE_DEV_INSECURE']) {
      if (has(forbidden) && env[forbidden] !== 'false') {
        findings.push({ level: 'error', setting: forbidden, effect: 'must not be set in production: settings validation fails' });
      }
    }
  }
  need('STORAGE_SECRET_KEY', 'customer storage credentials cannot be encrypted: Relay storage and "Your storage" stay disabled', 'warn');
  const rodrigo = ['RODRIGO_BASE_URL', 'RODRIGO_KEY_ID', 'RODRIGO_PRIVATE_KEY_FILE'].filter((name) => !env[name]?.trim());
  if (rodrigo.length > 0) {
    findings.push({
      level: 'warn',
      setting: rodrigo.join(', '),
      effect: 'Rodrigo is not configured: the Hub, sign-in and Drive work; Tasks, Notes, Calendar, Canvas, Forms, Site, Storefront and Messenger text report that their backend is unavailable',
    });
  }
  return findings;
}

/** Log the report once at startup. */
export async function logConfigReport(): Promise<void> {
  try {
    const findings = configFindings();
    try {
      const { getEnv } = await import('@/lib/env');
      getEnv();
    } catch (error) {
      // Zod messages name the setting and the rule; they never contain values.
      const text = error instanceof Error ? error.message : 'settings validation failed';
      console.error(`[sorye] configuration INVALID — pages that read settings will fail:\n${text.split('\n').slice(0, 20).map((line) => `  ${line}`).join('\n')}`);
    }
    if (findings.length === 0) {
      console.log('[sorye] configuration OK');
      return;
    }
    for (const finding of findings) {
      const log = finding.level === 'error' ? console.error : console.warn;
      log(`[sorye] configuration ${finding.level === 'error' ? 'ERROR' : 'warning'}: ${finding.setting} — ${finding.effect}`);
    }
  } catch {
    console.error('[sorye] configuration report could not run');
  }
}
