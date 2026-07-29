import { useState } from 'react';
import { Select } from '@sorye/sdk/react';
import {
  CHANNEL_META,
  RelayHandler,
  WORKSPACE_SOURCES,
  channelLabel,
  sourceLabel,
} from './relay-handler';

interface RelayConfigureProps {
  handler: RelayHandler;
  onChange: (handler: RelayHandler) => void;
}

export function RelayConfigure({ handler, onChange }: RelayConfigureProps) {
  const config = handler.getConfig();
  const channels = handler.getChannels();
  const routes = handler.getRoutes();

  return (
    <div className="relay-config">
      <section className="relay-panel">
        <h2>App sources</h2>
        <p className="relay-panel-hint">
          Choose which workspace apps may emit messages into Relay.
        </p>
        <ul className="source-toggle-list">
          {WORKSPACE_SOURCES.map((source) => (
            <li key={source.id}>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={handler.isSourceEnabled(source.id)}
                  onChange={(e) =>
                    onChange(handler.toggleSource(source.id, e.target.checked))
                  }
                />
                <span>{source.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="relay-panel">
        <h2>Delivery channels</h2>
        <p className="relay-panel-hint">
          Configure where messages go. Live connectors ship with the hub API
          later — for now delivery is simulated locally.
        </p>
        <div className="channel-cards">
          {channels.map((channel) => {
            const meta = CHANNEL_META[channel.kind];
            return (
              <article key={channel.id} className="channel-card">
                <header className="channel-card-header">
                  <span className={`channel-kind-badge kind-${channel.kind}`}>
                    {meta.label}
                  </span>
                  <label className="toggle-row compact">
                    <input
                      type="checkbox"
                      checked={channel.enabled}
                      onChange={(e) =>
                        onChange(
                          handler.updateChannel(channel.id, {
                            enabled: e.target.checked,
                          }),
                        )
                      }
                    />
                    <span>Enabled</span>
                  </label>
                </header>

                <label className="field">
                  Label
                  <input
                    type="text"
                    value={channel.label}
                    onChange={(e) =>
                      onChange(
                        handler.updateChannel(channel.id, {
                          label: e.target.value,
                        }),
                      )
                    }
                  />
                </label>

                <label className="field">
                  Destination
                  <input
                    type="text"
                    placeholder={meta.placeholder}
                    value={channel.destination}
                    onChange={(e) =>
                      onChange(
                        handler.updateChannel(channel.id, {
                          destination: e.target.value,
                        }),
                      )
                    }
                  />
                </label>
                <p className="field-hint">{meta.hint}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="relay-panel">
        <h2>Routing rules</h2>
        <p className="relay-panel-hint">
          Map each app to the channels it should notify. Disable a rule to stop
          that path without removing the channel.
        </p>

        <ul className="route-list">
          {routes.map((route) => (
            <li key={route.id} className="route-row">
              <div className="route-summary">
                <strong>{sourceLabel(route.sourceAppId)}</strong>
                <span aria-hidden="true">→</span>
                <em>{channelLabel(channels, route.channelId)}</em>
              </div>
              <label className="toggle-row compact">
                <input
                  type="checkbox"
                  checked={route.enabled}
                  onChange={(e) =>
                    onChange(handler.toggleRoute(route.id, e.target.checked))
                  }
                />
                <span>On</span>
              </label>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => onChange(handler.removeRoute(route.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <AddRouteForm handler={handler} onChange={onChange} />
      </section>

      <section className="relay-panel">
        <h2>Quiet hours</h2>
        <p className="relay-panel-hint">
          During quiet hours, messages queue instead of sending immediately. A
          simple guardrail so alerts do not overwhelm you.
        </p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config.quietHoursEnabled}
            onChange={(e) =>
              onChange(
                handler.updatePreferences({
                  quietHoursEnabled: e.target.checked,
                }),
              )
            }
          />
          <span>Enable quiet hours</span>
        </label>
        <div className="quiet-hours-row">
          <label className="field">
            From
            <input
              type="time"
              value={config.quietHoursStart}
              disabled={!config.quietHoursEnabled}
              onChange={(e) =>
                onChange(
                  handler.updatePreferences({
                    quietHoursStart: e.target.value,
                  }),
                )
              }
            />
          </label>
          <label className="field">
            Until
            <input
              type="time"
              value={config.quietHoursEnd}
              disabled={!config.quietHoursEnabled}
              onChange={(e) =>
                onChange(
                  handler.updatePreferences({ quietHoursEnd: e.target.value }),
                )
              }
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function AddRouteForm({
  handler,
  onChange,
}: {
  handler: RelayHandler;
  onChange: (handler: RelayHandler) => void;
}) {
  const channels = handler.getChannels();
  const [sourceAppId, setSourceAppId] = useState(WORKSPACE_SOURCES[0].id);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');

  const add = () => {
    if (!channelId) return;
    onChange(handler.addRoute(sourceAppId, channelId));
  };

  return (
    <div className="add-route-row">
      <Select
        label="App"
        value={sourceAppId}
        options={WORKSPACE_SOURCES.map((source) => ({
          value: source.id,
          label: source.name,
        }))}
        onSoryeChange={(e) => setSourceAppId(e.detail.value)}
      />
      <Select
        label="Channel"
        value={channelId}
        options={channels.map((channel) => ({
          value: channel.id,
          label: channel.label,
        }))}
        onSoryeChange={(e) => setChannelId(e.detail.value)}
      />
      <button type="button" className="btn-primary btn-sm" onClick={add}>
        Add route
      </button>
    </div>
  );
}
