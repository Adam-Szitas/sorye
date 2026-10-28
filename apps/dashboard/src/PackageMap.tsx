import { APP_CATALOG, getPlanById, SUBSCRIPTION_PLANS, type HubSession } from '@sorye/types';
import type { CSSProperties } from 'react';

export function PackageMap({ session }: { session: HubSession }) {
  const plan = getPlanById(SUBSCRIPTION_PLANS, session.workspace.subscriptionId);
  const selected = new Set(session.workspace.selectedAppIds);
  const apps = APP_CATALOG.filter((app) =>
    !app.presentationOnly && (!app.adminOnly || session.user.isAdmin) &&
    (app.alwaysAvailable || selected.has(app.id)),
  );
  return <section className="panel package-map">
    <div className="package-map-heading"><div><h2>{plan.name} package map</h2><p className="panel-hint">Apps and shared routes enabled in this workspace.</p></div><span className="dashboard-plan-badge" style={{ '--plan-color': plan.accent } as CSSProperties}>{plan.name} · {plan.maxApps === 999 ? 'unlimited app slots' : `${selected.size}/${plan.maxApps} app slots`}</span></div>
    <div className="package-map-canvas" role="img" aria-label={`${plan.name} package showing Hub connected to ${apps.map((app) => app.name).join(', ')}`}>
      <div className="package-map-hub"><strong>{session.workspace.name}</strong><span>Hub · sign-in · workspace data</span></div>
      <div className="package-map-branches">{apps.map((app) => <a key={app.id} href={app.mountPath} className="package-map-node" style={{ '--node-color': app.color } as CSSProperties}><strong>{app.name}</strong><span>{app.description}</span></a>)}</div>
    </div>
    <p className="panel-hint">Shared events, files, and app handoffs pass through Hub and follow this workspace’s access rules.</p>
  </section>;
}
