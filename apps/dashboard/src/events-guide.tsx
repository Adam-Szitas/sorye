import { useCallback, useEffect, useState } from 'react';
import type { HubSession, WorkspaceEventSettings } from '@sorye/types';

interface EventsStatus {
  eligible: boolean;
  enabled: boolean;
  alive: boolean;
  settings: WorkspaceEventSettings;
  eventsChannel: string;
  selectedAppCount: number;
  hasMessenger: boolean;
}

interface EventsGuideProps {
  session: HubSession;
  status: EventsStatus | null;
  onStatusChange: (status: EventsStatus) => void;
}

const STEPS = [
  {
    title: 'Enable Messenger + another app',
    body: 'App events need Messenger (the feed) and at least one producer app such as OCR, Tasks, Calendar, or Protocolio.',
  },
  {
    title: 'Turn on the feature flag',
    body: 'Use the switch below. Until this is on, apps may still try to emit — nothing is delivered.',
  },
  {
    title: 'Route in Relay',
    body: 'Open Relay → Configure to choose which apps notify Messenger #events, email, or webhooks.',
  },
] as const;

export function EventsGuide({
  session,
  status,
  onStatusChange,
}: EventsGuideProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/events', { credentials: 'include' });
    if (!res.ok) return;
    const data = (await res.json()) as EventsStatus;
    onStatusChange(data);
  }, [onStatusChange]);

  useEffect(() => {
    if (!status) void refresh();
  }, [status, refresh]);

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/events', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await res.json()) as {
        settings?: WorkspaceEventSettings;
        eligible?: boolean;
        alive?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? 'Could not update App events.');
        return;
      }
      await refresh();
      setMessage(
        enabled
          ? 'App events enabled. Open Messenger → #events to see movements.'
          : 'App events disabled. No further movements will be delivered.',
      );
    } catch {
      setError('Could not reach the Hub API.');
    } finally {
      setBusy(false);
    }
  }

  const enabled = status?.enabled ?? false;
  const eligible = status?.eligible ?? false;

  return (
    <section className="embed-guide events-guide" aria-labelledby="events-guide-title">
      <div className="embed-guide-hero">
        <p className="embed-guide-eyebrow">Cross-app movements</p>
        <h2 id="events-guide-title">App events</h2>
        <p>
          Opt in to stream basic activity from your other apps into Messenger{' '}
          <code>#{status?.eventsChannel ?? 'events'}</code> for{' '}
          <strong>{session.workspace.name}</strong>. Off by default until you
          enable it here.
        </p>
      </div>

      <div
        className={`db-status-banner ${
          status?.alive
            ? 'db-status-ok'
            : enabled
              ? 'db-status-error'
              : 'db-status-default'
        }`}
      >
        <div>
          <strong>
            {status?.alive
              ? 'Sending events'
              : enabled
                ? 'Enabled — waiting on apps'
                : 'Feature flag off'}
          </strong>
          <span>
            {eligible
              ? 'Prerequisites met (Messenger + another app)'
              : status?.hasMessenger
                ? 'Enable at least one more app (Tasks, Calendar, Notes, …)'
                : 'Enable Messenger and at least one other app in the Hub'}
          </span>
        </div>
      </div>

      <ol className="embed-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="embed-step-num" aria-hidden>
              {index + 1}
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <article className="embed-snippet-card db-form-card">
        <h3>Feature flag</h3>
        <p className="embed-muted">
          When this is on (and prerequisites are met), Tasks, Calendar, and
          Notes start delivering basic events to Messenger.
        </p>

        <label className="events-flag">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={busy}
            onChange={(e) => void setEnabled(e.target.checked)}
          />
          <span className="events-flag-ui" aria-hidden />
          <span className="events-flag-copy">
            <strong>{enabled ? 'App events on' : 'App events off'}</strong>
            <em>
              {enabled
                ? 'Basic movements are allowed to send'
                : 'Nothing is delivered until you enable this'}
            </em>
          </span>
        </label>

        <div className="db-actions" style={{ marginTop: '1rem' }}>
          <a className="embed-cta" href="/apps/messenger">
            Open Messenger →
          </a>
        </div>

        {message ? <p className="db-message">{message}</p> : null}
        {error ? <p className="db-error">{error}</p> : null}
      </article>

      <aside className="embed-notes">
        <h3>What gets sent</h3>
        <ul>
          <li>
            <code>sorye.task.*</code> — task created, updated, or moved
          </li>
          <li>
            <code>sorye.calendar.saved</code> — calendar events added or removed
          </li>
          <li>
            <code>sorye.notes.saved</code> — notes created or edited
          </li>
          <li>
            <code>sorye.ocr.analyzed</code> — OCR scan finished
          </li>
          <li>
            <code>sorye.ocr.ready</code> — OCR layout ready for Protocolio PDF
          </li>
          <li>
            <code>sorye.protocolio.generated</code> — Protocolio PDF generated
          </li>
          <li>
            <code>sorye.studio.loaded</code> — Studio opened a 3D mesh
          </li>
          <li>
            <code>sorye.studio.too_much</code> — Studio Too-much monitor shut the GPU path down
          </li>
          <li>
            <code>sorye.storefront.order_placed</code> — Storefront order request (no payment)
          </li>
          <li>
            <code>sorye.site.published</code> — Site one-pager published
          </li>
          <li>
            <code>sorye.mail.sent</code> — in-workspace Sorye Mail sent (not public SMTP)
          </li>
          <li>
            <code>sorye.files.uploaded</code> — Drive file uploaded (name/size only, not the bytes)
          </li>
        </ul>
        <p style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
          Route which apps notify Messenger (and email/webhooks) in{' '}
          <a href="/apps/relay">Relay → Configure</a>.
        </p>
      </aside>
    </section>
  );
}
