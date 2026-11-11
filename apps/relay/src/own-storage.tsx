import { useI18n } from '@sorye/platform/react';
import type { MessageKey } from '@sorye/platform';
import {
  DRIVE_PROVIDERS,
  OWN_STORAGE_DEFAULT_PORT,
  OWN_STORAGE_DEFAULT_PREFIX,
  OWN_STORAGE_DEFAULT_SCHEMA,
  type DatabaseConnectionPublic,
  type DatabaseTlsMode,
  type DriveConnectionPublic,
  type DriveProvider,
  type OwnStorageErrorCode,
  type OwnStorageResult,
  type OwnStorageSnapshot,
  type StorageSpace,
  type UploadTarget,
} from '@sorye/types';
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import './own-storage.css';

/**
 * Relay → Your storage. The owner of a Pro or Enterprise workspace connects an
 * S3-compatible drive or a PostgreSQL database and chooses where new uploads
 * go. Every check happens on the Hub (/api/own-storage); this view never sees
 * stored secrets.
 */

type Message = { tone: 'ok' | 'error'; text: string };
type FieldError = { section: 'drive' | 'database'; field: string } | null;
type FieldDoc = { key: string; label: MessageKey; desc: MessageKey; where?: MessageKey; example?: string; optional?: boolean };

const GIB = 1024 ** 3;

const DRIVE_DOCS: FieldDoc[] = [
  { key: 'provider', label: 'os.f.provider', desc: 'os.f.provider.desc' },
  { key: 'bucket', label: 'os.f.bucket', desc: 'os.f.bucket.desc', where: 'os.f.bucket.where', example: 'acme-sorye-files' },
  { key: 'region', label: 'os.f.region', desc: 'os.f.region.desc', where: 'os.f.region.where', example: 'eu-central-1' },
  { key: 'accountId', label: 'os.f.accountId', desc: 'os.f.accountId.desc', where: 'os.f.accountId.where', example: '0123456789abcdef0123456789abcdef' },
  { key: 'endpoint', label: 'os.f.endpoint', desc: 'os.f.endpoint.desc', where: 'os.f.endpoint.where', example: 'https://s3.eu-central-003.backblazeb2.com' },
  { key: 'pathStyle', label: 'os.f.pathStyle', desc: 'os.f.pathStyle.desc', optional: true },
  { key: 'prefix', label: 'os.f.prefix', desc: 'os.f.prefix.desc', example: OWN_STORAGE_DEFAULT_PREFIX, optional: true },
  { key: 'accessKeyId', label: 'os.f.accessKeyId', desc: 'os.f.accessKeyId.desc', where: 'os.f.accessKeyId.where', example: 'AKIAIOSFODNN7EXAMPLE' },
  { key: 'secretAccessKey', label: 'os.f.secretAccessKey', desc: 'os.f.secretAccessKey.desc' },
  { key: 'limitGb', label: 'os.f.limit', desc: 'os.f.limit.desc', example: '100' },
];

const DATABASE_DOCS: FieldDoc[] = [
  { key: 'host', label: 'os.f.host', desc: 'os.f.host.desc', where: 'os.f.host.where', example: 'db.acme.com' },
  { key: 'port', label: 'os.f.port', desc: 'os.f.port.desc', example: '5432', optional: true },
  { key: 'database', label: 'os.f.database', desc: 'os.f.database.desc', example: 'acme' },
  { key: 'user', label: 'os.f.user', desc: 'os.f.user.desc', example: 'sorye_uploader' },
  { key: 'password', label: 'os.f.password', desc: 'os.f.password.desc' },
  { key: 'schema', label: 'os.f.schema', desc: 'os.f.schema.desc', example: OWN_STORAGE_DEFAULT_SCHEMA, optional: true },
  { key: 'tls', label: 'os.f.tls', desc: 'os.f.tls.desc' },
  { key: 'caPem', label: 'os.f.caPem', desc: 'os.f.caPem.desc', optional: true },
  { key: 'limitGb', label: 'os.f.limit', desc: 'os.f.limit.desc', example: '100' },
];

/** Which drive fields apply to which provider. */
function driveFieldApplies(key: string, provider: DriveProvider): boolean {
  if (key === 'region') return provider !== 'cloudflare-r2';
  if (key === 'accountId') return provider === 'cloudflare-r2';
  if (key === 'endpoint' || key === 'pathStyle') return provider === 's3-compatible';
  return true;
}

function formatBytes(bytes: number, locale: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, { style: 'unit', unit: units[unit], unitDisplay: 'short', maximumFractionDigits: unit >= 3 ? 2 : 0 }).format(value);
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

async function request(method: string, url: string, body?: unknown): Promise<OwnStorageResult> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as OwnStorageResult | null;
    return data && typeof data === 'object' && 'ok' in data ? data : { ok: false, code: 'unknown' };
  } catch {
    return { ok: false, code: 'unreachable' };
  }
}

function CopyBlock({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="os-code">
      <pre>{text}</pre>
      <button
        type="button" className="btn-ghost btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }).catch(() => undefined);
        }}
      >
        <span aria-live="polite">{copied ? t('os.copied') : t('os.copy')}</span>
      </button>
    </div>
  );
}

function FieldDocs({ docs }: { docs: FieldDoc[] }) {
  const { t } = useI18n();
  return (
    <dl className="os-docs">
      {docs.map((doc) => (
        <div key={doc.key} className="os-doc">
          <dt>
            {t(doc.label)} <span className="os-doc-tag">{t(doc.optional ? 'os.optional' : 'os.required')}</span>
          </dt>
          <dd>
            <p>{t(doc.desc)}</p>
            {doc.where ? <p><strong>{t('os.whereToFind')}:</strong> {t(doc.where)}</p> : null}
            {doc.example ? <p><strong>{t('os.example')}:</strong> <code>{doc.example}</code></p> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className={`os-field${error ? ' os-field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="os-field-hint" id={`${id}-hint`}>{hint}</p> : null}
      {error ? <p className="os-field-error" id={`${id}-error`} role="alert">{error}</p> : null}
    </div>
  );
}

function SpaceMeter({ space, extra }: { space: StorageSpace; extra?: string | null }) {
  const { t, locale } = useI18n();
  const ratio = space.limitBytes > 0 ? Math.min(1, space.usedBytes / space.limitBytes) : 0;
  const tone = ratio >= 0.95 ? 'danger' : ratio >= 0.8 ? 'warn' : 'ok';
  return (
    <div className="os-space">
      <div className="os-space-bar" role="meter" aria-valuemin={0} aria-valuemax={space.limitBytes} aria-valuenow={space.usedBytes}
        aria-label={t('os.space.used')}>
        <span className={`os-space-fill os-space-${tone}`} style={{ width: `${Math.max(ratio * 100, space.usedBytes > 0 ? 1 : 0)}%` }} />
      </div>
      <dl className="os-space-stats">
        <div><dt>{t('os.space.used')}</dt><dd>{formatBytes(space.usedBytes, locale)}</dd></div>
        <div><dt>{t('os.space.free')}</dt><dd>{formatBytes(space.freeBytes, locale)}</dd></div>
        <div><dt>{t('os.space.total')}</dt><dd>{formatBytes(space.limitBytes, locale)}</dd></div>
        <div><dt>{t('os.space.files')}</dt><dd>{space.fileCount}</dd></div>
      </dl>
      {extra ? <p className="os-muted">{extra}</p> : null}
      <p className="os-muted os-small">{t('os.space.note')}</p>
    </div>
  );
}

function StatusLine({ status, verifiedAt, code }: { status: 'connected' | 'error'; verifiedAt: string; code: OwnStorageErrorCode | null }) {
  const { t, locale } = useI18n();
  return (
    <div className="os-status-line">
      <span className={`os-pill ${status === 'connected' ? 'os-pill-ok' : 'os-pill-error'}`}>{t(status === 'connected' ? 'os.status.connected' : 'os.status.error')}</span>
      <span className="os-muted">{t('os.lastChecked', { date: formatDate(verifiedAt, locale) })}</span>
      {status === 'error' && code ? <span className="os-error-text">{t(`os.err.${code}` as MessageKey)}</span> : null}
    </div>
  );
}

/** Connected-state actions shared by both sections: check, change limit, replace, disconnect. */
function ConnectedActions({
  editable, busy, space, onCheck, onLimit, onReplace, onDisconnect,
}: {
  editable: boolean; busy: boolean; space: StorageSpace;
  onCheck: () => void; onLimit: (gb: string) => void; onReplace: () => void; onDisconnect: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [limitOpen, setLimitOpen] = useState(false);
  const [limit, setLimit] = useState(String(Math.round((space.limitBytes / GIB) * 100) / 100));
  const [confirm, setConfirm] = useState(false);
  if (!editable) return null;
  return (
    <div className="os-actions">
      <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onCheck}>{t('os.check')}</button>
      {limitOpen ? (
        <form className="os-inline" onSubmit={(event) => { event.preventDefault(); onLimit(limit); setLimitOpen(false); }}>
          <label htmlFor={`${id}-limit`} className="os-sr">{t('os.f.limit')}</label>
          <input id={`${id}-limit`} type="number" min={1} max={102400} step="any" inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} />
          <span className="os-muted">GB</span>
          <button type="submit" className="btn-primary btn-sm" disabled={busy}>{t('os.saveLimit')}</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setLimitOpen(false)}>{t('os.cancel')}</button>
        </form>
      ) : (
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setLimitOpen(true)}>{t('os.changeLimit')}</button>
      )}
      <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onReplace}>{t('os.replace')}</button>
      {confirm ? (
        <span className="os-inline" role="group" aria-label={t('os.disconnect')}>
          <span>{t('os.disconnectConfirm')}</span>
          <button type="button" className="btn-ghost btn-sm" autoFocus onClick={() => setConfirm(false)}>{t('os.cancel')}</button>
          <button type="button" className="btn-ghost btn-sm os-danger" disabled={busy} onClick={() => { setConfirm(false); onDisconnect(); }}>{t('os.disconnect')}</button>
        </span>
      ) : (
        <button type="button" className="btn-ghost btn-sm os-danger" disabled={busy} onClick={() => setConfirm(true)}>{t('os.disconnect')}</button>
      )}
    </div>
  );
}

function iamPolicy(bucket: string, prefix: string): string {
  const b = bucket || 'YOUR-BUCKET';
  const p = prefix || OWN_STORAGE_DEFAULT_PREFIX;
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: `arn:aws:s3:::${b}` },
      { Effect: 'Allow', Action: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'], Resource: `arn:aws:s3:::${b}/${p}*` },
    ],
  }, null, 2);
}

function databaseSql(database: string, user: string, schema: string): string {
  const db = database || 'your_database';
  const role = user || 'sorye_uploader';
  const sch = schema || OWN_STORAGE_DEFAULT_SCHEMA;
  return [
    `CREATE ROLE ${role} LOGIN PASSWORD 'choose-a-strong-password';`,
    `GRANT CONNECT ON DATABASE ${db} TO ${role};`,
    `CREATE SCHEMA ${sch} AUTHORIZATION ${role};`,
  ].join('\n');
}

const emptyDrive = {
  provider: 'aws-s3' as DriveProvider, bucket: '', region: 'eu-central-1', accountId: '', endpoint: '', pathStyle: true,
  prefix: OWN_STORAGE_DEFAULT_PREFIX, accessKeyId: '', secretAccessKey: '', limitGb: '100',
};

function driveFormFrom(drive: DriveConnectionPublic | null) {
  if (!drive) return emptyDrive;
  return {
    ...emptyDrive, provider: drive.provider, bucket: drive.bucket, region: drive.region, accountId: drive.accountId ?? '',
    endpoint: drive.endpoint ?? '', pathStyle: drive.pathStyle, prefix: drive.prefix,
    limitGb: String(Math.round((drive.space.limitBytes / GIB) * 100) / 100),
  };
}

function DriveSection({
  drive, editable, busy, fieldError, devInsecure, onSubmit, onCheck, onLimit, onDisconnect,
}: {
  drive: DriveConnectionPublic | null; editable: boolean; busy: boolean; fieldError: string | null; devInsecure: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>; onCheck: () => void; onLimit: (gb: string) => void; onDisconnect: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [replacing, setReplacing] = useState(false);
  const [form, setForm] = useState(() => driveFormFrom(drive));
  const showForm = editable && (!drive || replacing);
  const err = (field: string) => (fieldError === field ? t('os.err.invalid_input') : null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const describedBy = (field: string) => [`${id}-${field}-hint`, fieldError === field ? `${id}-${field}-error` : ''].filter(Boolean).join(' ');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {
      provider: form.provider, bucket: form.bucket.trim(), prefix: form.prefix.trim(),
      accessKeyId: form.accessKeyId.trim(), secretAccessKey: form.secretAccessKey, limitGb: Number(form.limitGb),
    };
    if (driveFieldApplies('region', form.provider)) body.region = form.region.trim();
    if (driveFieldApplies('accountId', form.provider)) body.accountId = form.accountId.trim();
    if (driveFieldApplies('endpoint', form.provider)) { body.endpoint = form.endpoint.trim(); body.pathStyle = form.pathStyle; }
    if (await onSubmit(body)) {
      setReplacing(false);
      setForm((current) => ({ ...current, accessKeyId: '', secretAccessKey: '' }));
    }
  }

  const docs = DRIVE_DOCS.filter((doc) => driveFieldApplies(doc.key, form.provider));
  return (
    <section className="relay-panel os-section" aria-labelledby={`${id}-title`}>
      <header className="os-section-head">
        <h2 id={`${id}-title`}>{t('os.driveTitle')}</h2>
        <p className="os-muted">{t('os.driveLead')}</p>
      </header>

      {drive && !replacing ? (
        <div className="os-connected">
          <p className="os-where"><strong>{t(`os.provider.${drive.provider}` as MessageKey)}</strong> · <code>{drive.bucket}/{drive.prefix}</code>{drive.endpoint ? <> · <code>{drive.endpoint}</code></> : null}{drive.accessKeyHint ? <> · {t('os.keyHint', { hint: drive.accessKeyHint })}</> : null}</p>
          <StatusLine status={drive.status} verifiedAt={drive.verifiedAt} code={drive.lastErrorCode} />
          <SpaceMeter space={drive.space} />
          <ConnectedActions editable={editable} busy={busy} space={drive.space} onCheck={onCheck} onLimit={onLimit}
            onReplace={() => { setForm(driveFormFrom(drive)); setReplacing(true); }} onDisconnect={onDisconnect} />
        </div>
      ) : null}

      <details className="os-details" open={!drive}>
        <summary>{t('os.needTitle')}</summary>
        <FieldDocs docs={docs} />
        <h3>{t('os.permissionsTitle')}</h3>
        <p className="os-muted">{t('os.permissionsDrive')}</p>
        <CopyBlock text={iamPolicy(form.bucket.trim(), form.prefix.trim())} />
        <h3>{t('os.howTitle')}</h3>
        <ul className="os-how">
          <li>{t('os.how.driveKeys')}</li>
          <li>{t('os.how.driveProbe')}</li>
          <li>{t('os.how.checksum')}</li>
          <li>{t('os.how.delete')}</li>
          <li>{t('os.how.network')}</li>
        </ul>
      </details>

      {showForm ? (
        <form className="os-form" onSubmit={(event) => void submit(event)} autoComplete="off">
          <Field id={`${id}-provider`} label={t('os.f.provider')} error={err('provider')}>
            <select id={`${id}-provider`} className="os-select" value={form.provider} onChange={(event) => set('provider', event.target.value as DriveProvider)}>
              {DRIVE_PROVIDERS.map((provider) => <option key={provider} value={provider}>{t(`os.provider.${provider}` as MessageKey)}</option>)}
            </select>
          </Field>
          <Field id={`${id}-bucket`} label={t('os.f.bucket')} error={err('bucket')}>
            <input id={`${id}-bucket`} required maxLength={63} spellCheck={false} placeholder="acme-sorye-files" aria-invalid={fieldError === 'bucket' || undefined} aria-describedby={describedBy('bucket')}
              value={form.bucket} onChange={(event) => set('bucket', event.target.value)} />
          </Field>
          {driveFieldApplies('region', form.provider) ? (
            <Field id={`${id}-region`} label={t('os.f.region')} error={err('region')}>
              <input id={`${id}-region`} required maxLength={32} spellCheck={false} aria-invalid={fieldError === 'region' || undefined}
                value={form.region} onChange={(event) => set('region', event.target.value)} />
            </Field>
          ) : null}
          {driveFieldApplies('accountId', form.provider) ? (
            <Field id={`${id}-accountId`} label={t('os.f.accountId')} error={err('accountId')}>
              <input id={`${id}-accountId`} required maxLength={32} spellCheck={false} aria-invalid={fieldError === 'accountId' || undefined}
                value={form.accountId} onChange={(event) => set('accountId', event.target.value)} />
            </Field>
          ) : null}
          {driveFieldApplies('endpoint', form.provider) ? (
            <>
              <Field id={`${id}-endpoint`} label={t('os.f.endpoint')} error={err('endpoint')}>
                <input id={`${id}-endpoint`} required type="url" maxLength={300} spellCheck={false} inputMode="url"
                  placeholder={devInsecure ? 'http://minio:9000' : 'https://s3.example.com'} aria-invalid={fieldError === 'endpoint' || undefined}
                  value={form.endpoint} onChange={(event) => set('endpoint', event.target.value)} />
              </Field>
              <label className="os-check">
                <input type="checkbox" checked={form.pathStyle} onChange={(event) => set('pathStyle', event.target.checked)} />
                {t('os.f.pathStyle')}
              </label>
            </>
          ) : null}
          <Field id={`${id}-prefix`} label={t('os.f.prefix')} error={err('prefix')}>
            <input id={`${id}-prefix`} maxLength={200} spellCheck={false} aria-invalid={fieldError === 'prefix' || undefined}
              value={form.prefix} onChange={(event) => set('prefix', event.target.value)} />
          </Field>
          <Field id={`${id}-accessKeyId`} label={t('os.f.accessKeyId')} error={err('accessKeyId')}>
            <input id={`${id}-accessKeyId`} required maxLength={256} spellCheck={false} autoComplete="off" aria-invalid={fieldError === 'accessKeyId' || undefined}
              value={form.accessKeyId} onChange={(event) => set('accessKeyId', event.target.value)} />
          </Field>
          <Field id={`${id}-secretAccessKey`} label={t('os.f.secretAccessKey')} hint={t('os.secretNote')} error={err('secretAccessKey')}>
            <input id={`${id}-secretAccessKey`} required type="password" maxLength={256} autoComplete="new-password" aria-invalid={fieldError === 'secretAccessKey' || undefined}
              aria-describedby={describedBy('secretAccessKey')} value={form.secretAccessKey} onChange={(event) => set('secretAccessKey', event.target.value)} />
          </Field>
          <Field id={`${id}-limitGb`} label={t('os.f.limit')} error={err('limitGb')}>
            <input id={`${id}-limitGb`} required type="number" min={1} max={102400} step="any" inputMode="decimal" aria-invalid={fieldError === 'limitGb' || undefined}
              value={form.limitGb} onChange={(event) => set('limitGb', event.target.value)} />
          </Field>
          <div className="os-form-actions">
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? t('os.connecting') : t('os.connectButton')}</button>
            {replacing ? <button type="button" className="btn-ghost" onClick={() => setReplacing(false)}>{t('os.cancel')}</button> : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}

const emptyDatabase = {
  host: '', port: String(OWN_STORAGE_DEFAULT_PORT), database: '', user: '', password: '', schema: OWN_STORAGE_DEFAULT_SCHEMA,
  tls: 'verify' as DatabaseTlsMode, caPem: '', limitGb: '100',
};

function databaseFormFrom(database: DatabaseConnectionPublic | null) {
  if (!database) return emptyDatabase;
  return {
    ...emptyDatabase, host: database.host, port: String(database.port), database: database.database, user: database.user,
    schema: database.schema, tls: database.tls, limitGb: String(Math.round((database.space.limitBytes / GIB) * 100) / 100),
  };
}

function DatabaseSection({
  database, editable, busy, fieldError, devInsecure, onSubmit, onCheck, onLimit, onDisconnect,
}: {
  database: DatabaseConnectionPublic | null; editable: boolean; busy: boolean; fieldError: string | null; devInsecure: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>; onCheck: () => void; onLimit: (gb: string) => void; onDisconnect: () => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const [replacing, setReplacing] = useState(false);
  const [form, setForm] = useState(() => databaseFormFrom(database));
  const showForm = editable && (!database || replacing);
  const err = (field: string) => (fieldError === field ? t('os.err.invalid_input') : null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {
      host: form.host.trim(), port: Number(form.port), database: form.database.trim(), user: form.user.trim(), password: form.password,
      schema: form.schema.trim(), tls: form.tls, limitGb: Number(form.limitGb),
    };
    if (form.tls === 'verify' && form.caPem.trim()) body.caPem = form.caPem.trim();
    if (await onSubmit(body)) {
      setReplacing(false);
      setForm((current) => ({ ...current, password: '', caPem: '' }));
    }
  }

  const tlsModes: DatabaseTlsMode[] = devInsecure ? ['verify', 'encrypt', 'disable'] : ['verify', 'encrypt'];
  return (
    <section className="relay-panel os-section" aria-labelledby={`${id}-title`}>
      <header className="os-section-head">
        <h2 id={`${id}-title`}>{t('os.databaseTitle')}</h2>
        <p className="os-muted">{t('os.databaseLead')}</p>
      </header>

      {database && !replacing ? (
        <div className="os-connected">
          <p className="os-where"><code>{database.user}@{database.host}:{database.port}/{database.database}</code> · <code>{database.schema}.files</code> · {t(`os.tls.${database.tls}` as MessageKey)}</p>
          <StatusLine status={database.status} verifiedAt={database.verifiedAt} code={database.lastErrorCode} />
          <SpaceMeter space={database.space} extra={database.tableBytes !== null ? t('os.space.tableSize', { size: formatBytes(database.tableBytes, locale) }) : null} />
          <ConnectedActions editable={editable} busy={busy} space={database.space} onCheck={onCheck} onLimit={onLimit}
            onReplace={() => { setForm(databaseFormFrom(database)); setReplacing(true); }} onDisconnect={onDisconnect} />
        </div>
      ) : null}

      <details className="os-details" open={!database}>
        <summary>{t('os.needTitle')}</summary>
        <FieldDocs docs={DATABASE_DOCS} />
        <h3>{t('os.permissionsTitle')}</h3>
        <p className="os-muted">{t('os.permissionsDb')}</p>
        <CopyBlock text={databaseSql(form.database.trim(), form.user.trim(), form.schema.trim())} />
        <h3>{t('os.howTitle')}</h3>
        <ul className="os-how">
          <li>{t('os.how.dbTable')}</li>
          <li>{t('os.how.dbProbe')}</li>
          <li>{t('os.how.checksum')}</li>
          <li>{t('os.how.delete')}</li>
          <li>{t('os.how.network')}</li>
        </ul>
      </details>

      {showForm ? (
        <form className="os-form" onSubmit={(event) => void submit(event)} autoComplete="off">
          <Field id={`${id}-host`} label={t('os.f.host')} error={err('host')}>
            <input id={`${id}-host`} required maxLength={253} spellCheck={false} placeholder="db.acme.com" aria-invalid={fieldError === 'host' || undefined}
              value={form.host} onChange={(event) => set('host', event.target.value)} />
          </Field>
          <Field id={`${id}-port`} label={t('os.f.port')} error={err('port')}>
            <input id={`${id}-port`} type="number" min={1} max={65535} inputMode="numeric" aria-invalid={fieldError === 'port' || undefined}
              value={form.port} onChange={(event) => set('port', event.target.value)} />
          </Field>
          <Field id={`${id}-database`} label={t('os.f.database')} error={err('database')}>
            <input id={`${id}-database`} required maxLength={63} spellCheck={false} aria-invalid={fieldError === 'database' || undefined}
              value={form.database} onChange={(event) => set('database', event.target.value)} />
          </Field>
          <Field id={`${id}-user`} label={t('os.f.user')} error={err('user')}>
            <input id={`${id}-user`} required maxLength={63} spellCheck={false} autoComplete="off" aria-invalid={fieldError === 'user' || undefined}
              value={form.user} onChange={(event) => set('user', event.target.value)} />
          </Field>
          <Field id={`${id}-password`} label={t('os.f.password')} hint={t('os.secretNote')} error={err('password')}>
            <input id={`${id}-password`} required type="password" maxLength={512} autoComplete="new-password" aria-invalid={fieldError === 'password' || undefined}
              value={form.password} onChange={(event) => set('password', event.target.value)} />
          </Field>
          <Field id={`${id}-schema`} label={t('os.f.schema')} error={err('schema')}>
            <input id={`${id}-schema`} maxLength={63} spellCheck={false} aria-invalid={fieldError === 'schema' || undefined}
              value={form.schema} onChange={(event) => set('schema', event.target.value)} />
          </Field>
          <Field id={`${id}-tls`} label={t('os.f.tls')} error={err('tls')}>
            <select id={`${id}-tls`} className="os-select" value={form.tls} onChange={(event) => set('tls', event.target.value as DatabaseTlsMode)}>
              {tlsModes.map((mode) => <option key={mode} value={mode}>{t(`os.tls.${mode}` as MessageKey)}</option>)}
            </select>
          </Field>
          {form.tls === 'verify' ? (
            <Field id={`${id}-caPem`} label={`${t('os.f.caPem')} (${t('os.optional')})`} error={err('caPem')}>
              <textarea id={`${id}-caPem`} rows={4} maxLength={16384} spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----"
                aria-invalid={fieldError === 'caPem' || undefined} value={form.caPem} onChange={(event) => set('caPem', event.target.value)} />
            </Field>
          ) : null}
          <Field id={`${id}-limitGb`} label={t('os.f.limit')} error={err('limitGb')}>
            <input id={`${id}-limitGb`} required type="number" min={1} max={102400} step="any" inputMode="decimal" aria-invalid={fieldError === 'limitGb' || undefined}
              value={form.limitGb} onChange={(event) => set('limitGb', event.target.value)} />
          </Field>
          <div className="os-form-actions">
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? t('os.connecting') : t('os.connectButton')}</button>
            {replacing ? <button type="button" className="btn-ghost" onClick={() => setReplacing(false)}>{t('os.cancel')}</button> : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}

const TARGET_LABEL: Record<UploadTarget, MessageKey> = { sorye: 'os.target.sorye', drive: 'os.target.drive', database: 'os.target.database' };
const TARGET_HELP: Record<UploadTarget, MessageKey> = { sorye: 'os.target.soryeHelp', drive: 'os.target.driveHelp', database: 'os.target.databaseHelp' };

function UploadsTable({ snapshot }: { snapshot: OwnStorageSnapshot }) {
  const { t, locale } = useI18n();
  const id = useId();
  return (
    <section className="relay-panel os-section" aria-labelledby={`${id}-title`}>
      <header className="os-section-head">
        <h2 id={`${id}-title`}>{t('os.uploadsTitle')}</h2>
        <p className="os-muted">{t('os.uploadsLead')}</p>
      </header>
      {snapshot.recentUploads.length === 0 ? (
        <p className="os-muted">{t('os.uploadsEmpty')}</p>
      ) : (
        <div className="os-table-wrap">
          <table className="os-table">
            <thead>
              <tr>
                <th scope="col">{t('os.col.time')}</th>
                <th scope="col">{t('os.col.file')}</th>
                <th scope="col">{t('os.col.size')}</th>
                <th scope="col">{t('os.col.where')}</th>
                <th scope="col">{t('os.col.status')}</th>
                <th scope="col">{t('os.col.checksum')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.recentUploads.map((row) => (
                <tr key={row.id}>
                  <td><time dateTime={row.createdAt}>{formatDate(row.createdAt, locale)}</time></td>
                  <td className="os-file">{row.displayName}</td>
                  <td>{formatBytes(row.size, locale)}</td>
                  <td>{t(TARGET_LABEL[row.target])}</td>
                  <td>
                    <span className={`os-pill os-pill-${row.status}`}>{t(`os.ustatus.${row.status}` as MessageKey)}</span>
                    {row.errorCode && row.errorCode !== 'file_rejected' ? <span className="os-small os-muted"> · {t(`os.err.${row.errorCode}` as MessageKey)}</span> : null}
                  </td>
                  <td>{row.sha256 ? <code title={row.sha256}>{row.sha256.slice(0, 12)}…</code> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function OwnStorage() {
  const { t } = useI18n();
  const id = useId();
  const [snapshot, setSnapshot] = useState<OwnStorageSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [fieldError, setFieldError] = useState<FieldError>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch('/api/own-storage', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      setSnapshot((await response.json()) as OwnStorageSnapshot);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run(key: string, method: string, url: string, body: unknown, done: (next: OwnStorageSnapshot) => string, section?: 'drive' | 'database'): Promise<boolean> {
    setBusy(key);
    setMessage(null);
    setFieldError(null);
    const result = await request(method, url, body);
    setBusy(null);
    if (result.ok) {
      setSnapshot(result.snapshot);
      setMessage({ tone: 'ok', text: done(result.snapshot) });
      return true;
    }
    if (result.field && section) setFieldError({ section, field: result.field });
    setMessage({ tone: 'error', text: t(`os.err.${result.code}` as MessageKey) });
    // Status may have changed (for example a failed check); refresh quietly.
    void load();
    return false;
  }

  if (!snapshot) {
    return (
      <div className="relay-panel os-loading" role={loadFailed ? 'alert' : 'status'}>
        {loadFailed ? (
          <>
            <p>{t('os.loadFailed')}</p>
            <button type="button" className="btn-ghost btn-sm" onClick={() => void load()}>{t('os.retry')}</button>
          </>
        ) : <p className="os-muted">{t('os.loading')}</p>}
      </div>
    );
  }

  const editable = snapshot.canManage && snapshot.eligible && snapshot.encryptionReady;
  const targetEditable = snapshot.canManage;
  const connected: Record<UploadTarget, boolean> = {
    sorye: true,
    drive: Boolean(snapshot.drive) && snapshot.eligible,
    database: Boolean(snapshot.database) && snapshot.eligible,
  };

  return (
    <div className="os-root">
      <header className="os-intro">
        <h1>{t('os.title')}</h1>
        <p>{t('os.lead')}</p>
      </header>

      {snapshot.devInsecure ? <p className="relay-banner warn">{t('os.devInsecure')}</p> : null}
      {!snapshot.eligible ? (
        <div className="relay-panel os-gate">
          <div>
            <h2>{t('os.planTitle')}</h2>
            <p className="os-muted">{t('os.planBody')}</p>
          </div>
          <a className="btn-primary" href="/billing">{t('os.seePlans')}</a>
        </div>
      ) : null}
      {snapshot.eligible && !snapshot.encryptionReady ? <p className="relay-banner warn">{t('os.encryptionMissing')}</p> : null}
      {!snapshot.canManage ? <p className="relay-banner">{t('os.ownerOnly')}</p> : null}

      <div aria-live="polite" role="status" className="os-message-slot">
        {message ? <p className={`relay-banner ${message.tone === 'ok' ? 'ok' : 'warn'}`}>{message.text}</p> : null}
      </div>

      <section className="relay-panel os-section" aria-labelledby={`${id}-target`}>
        <header className="os-section-head">
          <h2 id={`${id}-target`}>{t('os.targetTitle')}</h2>
        </header>
        <div className="os-targets" role="radiogroup" aria-labelledby={`${id}-target`}>
          {(['sorye', 'drive', 'database'] as const).map((target) => {
            const available = connected[target];
            return (
              <label key={target} className={`os-target${snapshot.target === target ? ' os-target-active' : ''}${!available || !targetEditable ? ' os-target-disabled' : ''}`}>
                <input
                  type="radio" name={`${id}-target`} value={target} checked={snapshot.target === target}
                  disabled={!available || !targetEditable || busy !== null}
                  onChange={() => void run('target', 'PUT', '/api/own-storage/target', { target }, () => t('os.done.target', { target: t(TARGET_LABEL[target]) }))}
                />
                <span>
                  <strong>{t(TARGET_LABEL[target])}</strong>
                  <span className="os-muted os-small">{available ? t(TARGET_HELP[target]) : t('os.target.notConnected')}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="os-muted os-small">{t('os.target.failClosed')} {t('os.target.existing')}</p>
      </section>

      <DriveSection
        drive={snapshot.drive} editable={editable} busy={busy !== null} devInsecure={snapshot.devInsecure}
        fieldError={fieldError?.section === 'drive' ? fieldError.field : null}
        onSubmit={(body) => run('drive', 'PUT', '/api/own-storage/drive', body, () => t('os.done.connected'), 'drive')}
        onCheck={() => void run('drive-check', 'POST', '/api/own-storage/drive', undefined, () => t('os.done.checked'))}
        onLimit={(gb) => void run('drive-limit', 'PATCH', '/api/own-storage/drive', { limitGb: Number(gb) }, () => t('os.done.saved'), 'drive')}
        onDisconnect={() => void run('drive-off', 'DELETE', '/api/own-storage/drive', undefined, () => t('os.done.disconnected'))}
      />
      <DatabaseSection
        database={snapshot.database} editable={editable} busy={busy !== null} devInsecure={snapshot.devInsecure}
        fieldError={fieldError?.section === 'database' ? fieldError.field : null}
        onSubmit={(body) => run('database', 'PUT', '/api/own-storage/database', body, () => t('os.done.connected'), 'database')}
        onCheck={() => void run('database-check', 'POST', '/api/own-storage/database', undefined, () => t('os.done.checked'))}
        onLimit={(gb) => void run('database-limit', 'PATCH', '/api/own-storage/database', { limitGb: Number(gb) }, () => t('os.done.saved'), 'database')}
        onDisconnect={() => void run('database-off', 'DELETE', '/api/own-storage/database', undefined, () => t('os.done.disconnected'))}
      />
      {snapshot.canManage ? <UploadsTable snapshot={snapshot} /> : null}
    </div>
  );
}

