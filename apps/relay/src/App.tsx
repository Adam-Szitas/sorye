import { useCallback, useMemo, useState } from 'react';
import { RelayHandler } from './relay-handler';
import { loadConfig, saveConfig } from './relay-storage';
import { RelayActivity } from './relay-activity';
import { RelayConfigure } from './relay-config';
import './styles.css';

type Panel = 'activity' | 'configure';

export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const [panel, setPanel] = useState<Panel>('activity');

  const handler = useMemo(() => new RelayHandler(config), [config]);

  const apply = useCallback((next: RelayHandler) => {
    const snapshot = next.getConfig();
    setConfig(snapshot);
    saveConfig(snapshot);
  }, []);

  return (
    <div className="relay-app">
      <header className="relay-header">
        <div>
          <h1>Relay</h1>
          <p>Route workspace app messages to email, WhatsApp, and more</p>
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

      {panel === 'activity' ? (
        <RelayActivity handler={handler} onChange={apply} />
      ) : (
        <RelayConfigure handler={handler} onChange={apply} />
      )}
    </div>
  );
}
