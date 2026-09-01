import { useCallback, useEffect, useMemo, useState } from 'react';
import { RelayHandler } from './relay-handler';
import {
  fetchRelayConfig,
  loadConfig,
  persistRelayConfig,
  saveConfig,
  sendRelayTest,
  subscribeRelayUpdates,
} from './relay-storage';
import { RelayActivity } from './relay-activity';
import { RelayConfigure } from './relay-config';
import './styles.css';

type Panel = 'activity' | 'configure';

export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const [panel, setPanel] = useState<Panel>('configure');
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handler = useMemo(() => new RelayHandler(config), [config]);

  const refresh = useCallback(async () => {
    const snapshot = await fetchRelayConfig();
    if (!snapshot) {
      setSyncError('Using local Relay config — Hub API unavailable.');
      return;
    }
    setSyncError(null);
    setConfig(snapshot.config);
    saveConfig(snapshot.config);
    setEventsEnabled(snapshot.eventsEnabled);
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeRelayUpdates(() => {
      void refresh();
    });
    const timer = window.setInterval(() => {
      void refresh();
    }, 12_000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [refresh]);

  const apply = useCallback(async (next: RelayHandler) => {
    const snapshot = next.getConfig();
    setConfig(snapshot);
    saveConfig(snapshot);
    const saved = await persistRelayConfig(snapshot);
    if (!saved) {
      setSyncError('Could not save to Hub — changes kept locally only.');
      return;
    }
    setConfig(saved);
    setSyncError(null);
    setNotice('Relay routes saved for this workspace.');
  }, []);

  const onTest = useCallback(async (sourceAppId: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendRelayTest(sourceAppId);
      if (!result) {
        setNotice('Test failed — could not reach Hub Relay API.');
        return;
      }
      setConfig(result.config);
      setEventsEnabled(result.eventsEnabled);
      setNotice(
        result.eventsEnabled
          ? 'Test sent. Check Activity and Messenger #events if that route is on.'
          : 'Test logged in Relay. Enable App events for Messenger delivery.',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="relay-app">
      <header className="relay-header">
        <div>
          <h1>Relay</h1>
          <p>
            Connect OCR, Protocolio, Messenger, Calendar, and Tasks — route
            movements to Messenger, email, and webhooks
          </p>
        </div>
        <div className="relay-header-actions">
          <span className="relay-badge">Communication</span>
          <div className="relay-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'activity' ? 'true' : 'false'}
              className={panel === 'activity' ? 'active' : undefined}
              onClick={() => setPanel('activity')}
            >
              Activity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'configure' ? 'true' : 'false'}
              className={panel === 'configure' ? 'active' : undefined}
              onClick={() => setPanel('configure')}
            >
              Configure
            </button>
          </div>
        </div>
      </header>

      {syncError ? <p className="relay-banner warn">{syncError}</p> : null}

      {panel === 'activity' ? (
        <RelayActivity
          handler={handler}
          onTest={onTest}
          eventsEnabled={eventsEnabled}
          busy={busy}
          notice={notice}
        />
      ) : (
        <RelayConfigure
          handler={handler}
          onChange={(next) => {
            void apply(next);
          }}
          eventsEnabled={eventsEnabled}
        />
      )}
    </div>
  );
}
