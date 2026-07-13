'use client';

import type { SubscriptionPlan, WorkspaceSummary } from '@sorye/types';
import { canCreateTeamWorkspace } from '@sorye/types';
import { useState } from 'react';

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;
  plan: SubscriptionPlan;
  onSwitch: (workspaceId: string) => Promise<unknown>;
  onCreateTeam: (name: string) => Promise<unknown>;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  plan,
  onSwitch,
  onCreateTeam,
}: WorkspaceSwitcherProps) {
  const [creating, setCreating] = useState(false);
  const [teamName, setTeamName] = useState('');
  const canCreate = canCreateTeamWorkspace(
    plan,
    workspaces.filter((w) => w.kind === 'team').length,
  );

  return (
    <div className="surface flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          type="button"
          onClick={() => onSwitch(ws.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            ws.id === activeWorkspaceId
              ? 'bg-white/15 text-[var(--color-text)]'
              : 'text-[var(--color-text-muted)] hover:bg-white/8 hover:text-[var(--color-text)]'
          }`}
        >
          {ws.kind === 'team' ? '👥 ' : '👤 '}
          {ws.name}
        </button>
      ))}

      {canCreate && !creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/8 hover:text-[var(--color-text)]"
        >
          + New team
        </button>
      )}

      {creating && (
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!teamName.trim()) return;
            await onCreateTeam(teamName.trim());
            setTeamName('');
            setCreating(false);
          }}
        >
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
            autoFocus
          />
          <button
            type="submit"
            className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="text-xs text-[var(--color-text-muted)]"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
