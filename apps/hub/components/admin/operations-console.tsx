'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const Tenants = dynamic(() => import('./platform-sections').then(m => m.WorkspacesConsole));
const Audit = dynamic(() => import('./platform-sections').then(m => m.HistorySection));
const AI = dynamic(() => import('./shared-ai-console').then(m => m.SharedAiConsole));
const Notices = dynamic(() => import('./operator-panels').then(m => m.OperatorPanels));
const Guide = dynamic(() => import('./operations').then(m => m.AdminOperations));
const sections = ['Tenant support', 'Service notices', 'AI response', 'Audit review', 'Runbooks'] as const;

export function OperationsConsole() {
  const [section, setSection] = useState<typeof sections[number]>('Tenant support');
  return <>
    <header className="admin-page"><h1>Operations desk</h1><p className="admin-lede">Review customer access, manage scheduled service notices, respond to AI incidents, and inspect administrative changes.</p>
      <nav aria-label="Operational tools" className="flex flex-wrap gap-2">{sections.map(item => <button key={item} type="button" aria-pressed={section === item} onClick={() => setSection(item)} className="admin-button">{item}</button>)}</nav>
    </header>
    {section === 'Tenant support' && <Tenants />}
    {section === 'Service notices' && <Notices sections={['notices']} title="Service notices" intro="Publish a scheduled notice to the supported plan audience. Review the dates and audience before publishing. Notices use the existing Hub-owned store and administrative audit; they are not a durable incident-management system." />}
    {section === 'AI response' && <AI />}
    {section === 'Audit review' && <Audit />}
    {section === 'Runbooks' && <Guide />}
  </>;
}
