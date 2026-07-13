const METRICS = [
  { label: 'Active users', value: '2,847', delta: '+12%', up: true },
  { label: 'API calls (24h)', value: '148K', delta: '+8%', up: true },
  { label: 'Connected apps', value: '6', delta: '0', up: true },
  { label: 'Error rate', value: '0.3%', delta: '-0.1%', up: true },
];

const ACTIVITY = [
  { time: '2m ago', event: 'CRM sync completed', source: 'My CRM' },
  { time: '18m ago', event: 'New connection added', source: 'DevKit' },
  { time: '1h ago', event: 'Dashboard widget refreshed', source: 'Pulse' },
  { time: '3h ago', event: 'Team member invited', source: 'Hub' },
];

export default function App() {
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p>Workspace overview and connected data</p>
        </div>
        <span className="dashboard-badge">Micro-frontend</span>
      </header>

      <section className="metrics-grid">
        {METRICS.map((metric) => (
          <article key={metric.label} className="metric-card">
            <span className="metric-label">{metric.label}</span>
            <strong className="metric-value">{metric.value}</strong>
            <span className={`metric-delta ${metric.up ? 'up' : 'down'}`}>
              {metric.delta}
            </span>
          </article>
        ))}
      </section>

      <section className="panels">
        <article className="panel">
          <h2>Activity feed</h2>
          <ul>
            {ACTIVITY.map((item) => (
              <li key={item.event}>
                <div>
                  <strong>{item.event}</strong>
                  <span>{item.source}</span>
                </div>
                <time>{item.time}</time>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h2>API connections</h2>
          <p className="panel-hint">
            REST endpoints registered in the Hub are surfaced here. Wire live
            data when your backend is ready.
          </p>
          <div className="connection-placeholder">
            <code>GET /api/v1/metrics</code>
            <span className="status-pill">Ready</span>
          </div>
          <div className="connection-placeholder">
            <code>POST /api/v1/events</code>
            <span className="status-pill">Ready</span>
          </div>
        </article>
      </section>
    </div>
  );
}
