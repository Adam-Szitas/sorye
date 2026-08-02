'use client';

import { preloadPanelChunk } from '@/lib/prefetch';

type Panel = 'launcher' | 'picker' | 'connections';

interface DockProps {
  activePanel: Panel;
  appCount: number;
  connectionCount: number;
  onNavigate: (panel: Panel) => void;
  workspaceOpen?: boolean;
  onOpenWorkspace?: () => void;
}

const items: { id: Panel; label: string; icon: string }[] = [
  {
    id: 'launcher',
    label: 'Home',
    icon: 'M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
  },
  {
    id: 'picker',
    label: 'Apps',
    icon: 'M4 6a2 2 0 0 1 2-2h3v6H4zm11-2h3a2 2 0 0 1 2 2v4h-5zm-7 6h5v8H7a2 2 0 0 1-2-2zm7 0h5v6a2 2 0 0 1-2 2h-3z',
  },
  {
    id: 'connections',
    label: 'Connect',
    icon: 'M10 13a5 5 0 0 1 7 0M14 11V7a2 2 0 0 1 4 0v1M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z',
  },
];

export function Dock({
  activePanel,
  appCount,
  connectionCount,
  onNavigate,
  workspaceOpen,
  onOpenWorkspace,
}: DockProps) {
  const badges: Record<Panel, number | undefined> = {
    launcher: undefined,
    picker: appCount,
    connections: connectionCount,
  };

  return (
    <nav
      className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2"
      aria-label="Main navigation"
    >
      <div className="glass flex items-center gap-1 rounded-2xl px-2 py-2 shadow-2xl">
        {items.map((item) => {
          const isActive = activePanel === item.id;
          const badge = badges[item.id];

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              onPointerEnter={() => {
                if (item.id === 'picker' || item.id === 'connections') {
                  preloadPanelChunk(item.id);
                }
              }}
              onFocus={() => {
                if (item.id === 'picker' || item.id === 'connections') {
                  preloadPanelChunk(item.id);
                }
              }}
              className={`relative flex flex-col items-center gap-0.5 rounded-xl px-4 py-2 transition ${
                isActive
                  ? 'bg-white/15 text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-white/8 hover:text-[var(--color-text)]'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={item.icon} />
              </svg>
              <span className="text-[10px] font-medium">{item.label}</span>
              {badge !== undefined && badge > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[9px] font-bold text-[var(--color-surface)]">
                  {badge}
                </span>
              )}
            </button>
          );
        })}

        {workspaceOpen && onOpenWorkspace ? (
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="relative flex flex-col items-center gap-0.5 rounded-xl px-4 py-2 text-[var(--color-accent)] transition hover:bg-white/8"
            aria-label="Open split workspace"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 5h7v14H4zm9 0h7v14h-7z" />
            </svg>
            <span className="text-[10px] font-medium">Split</span>
          </button>
        ) : null}
      </div>
    </nav>
  );
}
