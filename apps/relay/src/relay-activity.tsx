import { Select } from '@sorye/sdk/react';
import { useMemo, useState } from 'react';
import {
  CHANNEL_META,
  RelayHandler,
  WORKSPACE_SOURCES,
  sourceLabel,
} from './relay-handler';

interface RelayActivityProps {
  handler: RelayHandler;
  onTest: (sourceAppId: string) => Promise<void>;
  eventsEnabled: boolean;
  busy?: boolean;
  notice?: string | null;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RelayActivity({
  handler,
  onTest,
  eventsEnabled,
  busy,
  notice,
}: RelayActivityProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [testSource, setTestSource] = useState(WORKSPACE_SOURCES[0]!.id);

  const messages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return handler.getMessages().filter((message) => {
      if (!q) return true;
      return (
        message.title.toLowerCase().includes(q) ||
        message.body.toLowerCase().includes(q) ||
        sourceLabel(message.sourceAppId).toLowerCase().includes(q) ||
        (message.eventName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [handler, searchQuery]);

  return (
    <div className="relay-activity">
      {!eventsEnabled ? (
        <p className="relay-banner">
          App events are off — Messenger routes will not post until you enable
          them in <a href="/apps/dashboard">Dashboard → App events</a>.
        </p>
      ) : null}

      <div className="relay-toolbar">
        <label className="field field-grow">
          Search activity
          <div className="search-input-wrap">
            <input
              type="search"
              placeholder="Filter by app, title, or body..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery ? (
              <button
                type="button"
                className="btn-icon search-clear"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
              >
                ×
              </button>
            ) : null}
          </div>
        </label>

        <Select
          label="Test source"
          value={testSource}
          options={WORKSPACE_SOURCES.map((source) => ({
            value: source.id,
            label: source.name,
          }))}
          onSoryeChange={(e) => setTestSource(e.detail.value)}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void onTest(testSource)}
        >
          {busy ? 'Sending…' : 'Send test'}
        </button>
      </div>

      {notice ? <p className="relay-notice">{notice}</p> : null}

      {messages.length === 0 ? (
        <p className="relay-empty">
          No messages yet. Enable sources and routes under Configure, turn on
          App events, then run OCR / Tasks / Calendar — or send a test.
        </p>
      ) : (
        <ul className="message-feed">
          {messages.map((message) => (
            <li key={message.id} className="message-card">
              <header className="message-card-header">
                <div>
                  <strong>{message.title}</strong>
                  <span>
                    {sourceLabel(message.sourceAppId)}
                    {message.eventName ? ` · ${message.eventName}` : ''} ·{' '}
                    {formatWhen(message.createdAt)}
                  </span>
                </div>
              </header>
              {message.body ? <p>{message.body}</p> : null}
              <ul className="delivery-list">
                {message.deliveries.map((delivery, index) => (
                  <li
                    key={`${message.id}-${delivery.channelId}-${index}`}
                    className={`delivery-item status-${delivery.status}`}
                  >
                    <span className="delivery-channel">
                      {CHANNEL_META[delivery.channelKind].label}
                    </span>
                    <span className="delivery-detail">{delivery.detail}</span>
                    <span className={`delivery-status status-${delivery.status}`}>
                      {delivery.status}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
