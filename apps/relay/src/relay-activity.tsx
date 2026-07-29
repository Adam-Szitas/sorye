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
  onChange: (handler: RelayHandler) => void;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RelayActivity({ handler, onChange }: RelayActivityProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [testSource, setTestSource] = useState(WORKSPACE_SOURCES[0].id);

  const messages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return handler.getMessages().filter((message) => {
      if (!q) return true;
      return (
        message.title.toLowerCase().includes(q) ||
        message.body.toLowerCase().includes(q) ||
        sourceLabel(message.sourceAppId).toLowerCase().includes(q)
      );
    });
  }, [handler, searchQuery]);

  const sendTest = () => {
    onChange(handler.sendTestMessage(testSource));
  };

  return (
    <div className="relay-activity">
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
        <button type="button" className="btn-primary" onClick={sendTest}>
          Send test
        </button>
      </div>

      {messages.length === 0 ? (
        <p className="relay-empty">
          No messages yet. Configure routes, then send a test notification.
        </p>
      ) : (
        <ul className="message-feed">
          {messages.map((message) => (
            <li key={message.id} className="message-card">
              <header className="message-card-header">
                <div>
                  <strong>{message.title}</strong>
                  <span>
                    {sourceLabel(message.sourceAppId)} ·{' '}
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
