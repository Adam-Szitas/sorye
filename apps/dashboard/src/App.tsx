import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  APP_CATALOG,
  getPlanById,
  selectableAppCount,
  SUBSCRIPTION_PLANS,
  type AppCatalogEntry,
  type EmbedWidget,
  type HubSession,
  type WorkspaceStorageInfo,
} from '@sorye/types';
import {
  formatRelativeTime,
  loadDashboardData,
  type ActivityItem,
  type EventsStatus,
  type LocalAppSnapshots,
} from './dashboard-data';
import { EmbedGuide } from './embed-guide';
import { DatabaseGuide } from './database-guide';
import { EventsGuide } from './events-guide';
import './styles.css';

type DashTab = 'connect' | 'database' | 'events' | 'overview';

interface MetricCard {
  label: string;
  value: string;
  hint: string;
}

function buildMetrics(
  session: HubSession,
  snapshots: LocalAppSnapshots,
  widgetCount: number,
): MetricCard[] {
  const plan = getPlanById(SUBSCRIPTION_PLANS, session.workspace.subscriptionId);
  const appCount = selectableAppCount(
    APP_CATALOG,
    session.workspace.selectedAppIds,
  );
  const connCount = session.workspace.connectedApps.length;

  return [
    {
      label: 'Installed apps',
      value: `${appCount}`,
      hint: `${plan.maxApps === 999 ? 'Unlimited' : `of ${plan.maxApps}`} on ${plan.name}`,
    },
    {
      label: 'Embed widgets',
      value: `${widgetCount}`,
      hint: widgetCount > 0 ? 'Keys ready for your product' : 'Create one in Connections',
    },
    {
      label: 'Open tasks',
      value: `${snapshots.openTasks}`,
      hint:
        snapshots.totalTasks > 0
          ? `${snapshots.totalTasks} total in Tasks`
          : 'Add tasks in the Tasks app',
    },
    {
      label: 'Upcoming events',
      value: `${snapshots.upcomingEvents}`,
      hint:
        snapshots.calendarEvents > 0
          ? `${snapshots.calendarEvents} on your calendar`
          : 'Next 7 days from Calendar',
    },
    {
      label: 'API connections',
      value: `${connCount}`,
      hint: `${plan.maxConnections === 999 ? 'Unlimited' : `of ${plan.maxConnections}`} on plan`,
    },
    {
      label: 'Workspace',
      value: session.workspace.kind === 'team' ? 'Team' : 'Personal',
      hint: session.workspace.name,
    },
  ];
}

function getInstalledApps(session: HubSession): AppCatalogEntry[] {
  const selected = new Set(session.workspace.selectedAppIds);
  return APP_CATALOG.filter((app) => selected.has(app.id));
}

function activityVerb(item: ActivityItem): string {
  switch (item.source) {
    case 'Tasks':
      return 'Task updated';
    case 'Notes':
      return 'Note saved';
    case 'Calendar':
      return 'Event scheduled';
    case 'Relay':
      return 'Message relayed';
    default:
      return 'Activity';
  }
}

export default function App() {
  const [tab, setTab] = useState<DashTab>('connect');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<HubSession | null>(null);
  const [snapshots, setSnapshots] = useState<LocalAppSnapshots | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [widgets, setWidgets] = useState<EmbedWidget[]>([]);
  const [storage, setStorage] = useState<WorkspaceStorageInfo | null>(null);
  const [events, setEvents] = useState<EventsStatus | null>(null);
  const [hubOrigin, setHubOrigin] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await loadDashboardData();
        if (!cancelled) {
          setSession(data.session);
          setSnapshots(data.snapshots);
          setActivity(data.activity);
          setWidgets(data.widgets);
          setStorage(data.storage);
          setEvents(data.events);
          setHubOrigin(data.hubOrigin);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load dashboard.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = session
    ? getPlanById(SUBSCRIPTION_PLANS, session.workspace.subscriptionId)
    : null;
  const metrics =
    session && snapshots ? buildMetrics(session, snapshots, widgets.length) : [];
  const installedApps = session ? getInstalledApps(session) : [];

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p>
            {session
              ? `${session.workspace.name} · ${session.user.email}`
              : 'Connect Sorye apps to your product'}
          </p>
        </div>
        <div className="dashboard-header-badges">
          {plan ? (
            <span
              className="dashboard-plan-badge"
              style={{ '--plan-color': plan.accent } as CSSProperties}
            >
              {plan.name} plan
            </span>
          ) : null}
          <span className="dashboard-badge">Live data</span>
        </div>
      </header>

      <nav className="dashboard-tabs" aria-label="Dashboard sections">
        <button
          type="button"
          className={tab === 'connect' ? 'active' : undefined}
          onClick={() => setTab('connect')}
        >
          Connect your app
        </button>
        <button
          type="button"
          className={tab === 'database' ? 'active' : undefined}
          onClick={() => setTab('database')}
        >
          Workspace database
        </button>
        <button
          type="button"
          className={tab === 'events' ? 'active' : undefined}
          onClick={() => setTab('events')}
        >
          App events
        </button>
        <button
          type="button"
          className={tab === 'overview' ? 'active' : undefined}
          onClick={() => setTab('overview')}
        >
          Workspace overview
        </button>
      </nav>

      {loading ? (
        <div className="dashboard-state">Loading workspace overview…</div>
      ) : null}

      {error ? (
        <div className="dashboard-state dashboard-error">
          <p>{error}</p>
          <p className="dashboard-state-hint">
            Open this app from the Hub at{' '}
            <code>http://localhost:3000</code> while signed in.
          </p>
        </div>
      ) : null}

      {!loading && !error && session && snapshots ? (
        tab === 'connect' ? (
          <EmbedGuide
            session={session}
            widgets={widgets}
            hubOrigin={hubOrigin}
          />
        ) : tab === 'database' ? (
          <DatabaseGuide
            session={session}
            storage={storage}
            onStorageChange={setStorage}
          />
        ) : tab === 'events' ? (
          <EventsGuide
            session={session}
            status={events}
            onStatusChange={setEvents}
          />
        ) : (
          <>
            <section className="metrics-grid">
              {metrics.map((metric) => (
                <article key={metric.label} className="metric-card">
                  <span className="metric-label">{metric.label}</span>
                  <strong className="metric-value">{metric.value}</strong>
                  <span className="metric-hint">{metric.hint}</span>
                </article>
              ))}
            </section>

            <section className="panels">
              <article className="panel">
                <h2>Recent activity</h2>
                {activity.length === 0 ? (
                  <p className="panel-empty">
                    No activity yet. Use Calendar, Notes, Tasks, or Relay to
                    populate this feed.
                  </p>
                ) : (
                  <ul>
                    {activity.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>
                            {activityVerb(item)}: {item.title}
                          </strong>
                          <span>{item.source}</span>
                        </div>
                        <time>{formatRelativeTime(item.at)}</time>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="panel">
                <h2>Installed apps</h2>
                <ul className="app-chip-list">
                  {installedApps.map((app) => (
                    <li key={app.id}>
                      <a href={app.mountPath} className="app-chip">
                        <span
                          className="app-chip-dot"
                          style={{ background: app.color }}
                        />
                        <span>
                          <strong>{app.name}</strong>
                          <em>
                            {app.status === 'available' ? 'Ready' : app.status}
                          </em>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="panel panel-wide">
                <h2>API connections</h2>
                {session.workspace.connectedApps.length === 0 ? (
                  <>
                    <p className="panel-hint">
                      Outbound API connectors live under Hub → Connections →
                      Outbound APIs. For embedding Sorye into your product, use
                      the <strong>Connect your app</strong> tab.
                    </p>
                    <button
                      type="button"
                      className="dashboard-link-btn"
                      onClick={() => setTab('connect')}
                    >
                      Open connect guide
                    </button>
                  </>
                ) : (
                  session.workspace.connectedApps.map((conn) => (
                    <div key={conn.id} className="connection-placeholder">
                      <div>
                        <strong>{conn.name}</strong>
                        <code>{conn.endpoint}</code>
                      </div>
                      <span className={`status-pill status-${conn.status}`}>
                        {conn.status}
                      </span>
                    </div>
                  ))
                )}
              </article>
            </section>
          </>
        )
      ) : null}
    </div>
  );
}
