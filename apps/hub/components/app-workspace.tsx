'use client';

import { ExternalAppFrame } from '@/components/external-app-frame';
import { MicroAppLoader } from '@/components/micro-app-loader';
import { AppIcon } from '@/components/app-icon';
import { HubNativeAppBody } from '@/components/hub-native-app';
import { AppUsageGuide } from '@/components/app-usage-guide';
import { shouldShowUsageGuide } from '@/lib/usage-guide';
import { isHubNativeApp, type AppCatalogEntry } from '@sorye/types';
import { useEffect, useRef, useState } from 'react';

export type PaneSide = 'left' | 'right';

interface AppPaneProps {
  side: PaneSide;
  app: AppCatalogEntry;
  focused: boolean;
  alone: boolean;
  onFocus: () => void;
  onClose: () => void;
  onExpand: () => void;
  onMove: () => void;
}

function AppPane({
  side,
  app,
  focused,
  alone,
  onFocus,
  onClose,
  onExpand,
  onMove,
}: AppPaneProps) {
  return (
    <section
      className={`app-pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border ${
        focused
          ? 'border-[var(--color-accent)]/50 shadow-[0_0_0_1px_rgba(56,189,248,0.2)]'
          : 'border-white/10'
      } bg-[var(--color-surface-raised)]`}
      onMouseDown={onFocus}
      aria-label={`${app.name} (${side})`}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/8 px-3 py-2">
        <AppIcon app={app} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{app.name}</p>
          <p className="truncate text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            {alone ? 'Full width' : side === 'left' ? 'Left' : 'Right'}
          </p>
        </div>
        {!alone ? (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[11px] text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
            onClick={onMove}
            title={`Move to ${side === 'left' ? 'right' : 'left'}`}
          >
            {side === 'left' ? '→' : '←'}
          </button>
        ) : null}
        {!alone ? (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[11px] text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
            onClick={onExpand}
            title="Expand to full width"
          >
            Expand
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-[11px] text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-red-300"
          onClick={onClose}
          aria-label={`Close ${app.name}`}
        >
          Close
        </button>
      </header>
      {shouldShowUsageGuide(app.id) ? (
        <AppUsageGuide app={app} variant="pane" />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {isHubNativeApp(app) ? (
          <HubNativeAppBody app={app} paneSide={side} alone={alone} />
        ) : app.external ? (
          <ExternalAppFrame config={app.external} appName={app.name} />
        ) : app.microFrontend ? (
          <MicroAppLoader config={app.microFrontend} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-text-muted)]">
            {app.name} is not available in split view yet.
          </div>
        )}
      </div>
    </section>
  );
}

interface AppWorkspaceProps {
  left: AppCatalogEntry | null;
  right: AppCatalogEntry | null;
  focus: PaneSide;
  onFocus: (side: PaneSide) => void;
  onClose: (side: PaneSide) => void;
  onExpand: (side: PaneSide) => void;
  onSwap: () => void;
  onMove: (side: PaneSide) => void;
}

export function AppWorkspace({
  left,
  right,
  focus,
  onFocus,
  onClose,
  onExpand,
  onSwap,
  onMove,
}: AppWorkspaceProps) {
  const [ratio, setRatio] = useState(0.5);
  const dragging = useRef(false);
  const liveRatio = useRef(0.5);
  const shellRef = useRef<HTMLDivElement>(null);
  const leftWrapRef = useRef<HTMLDivElement>(null);
  const rightWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // During the drag we write flex directly to the DOM — re-rendering both
    // micro-frontend hosts on every pointermove is wasted work. React state
    // is committed once, on pointerup.
    function onMovePointer(e: PointerEvent) {
      if (!dragging.current || !shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      const next = Math.min(
        0.72,
        Math.max(0.28, (e.clientX - rect.left) / rect.width),
      );
      liveRatio.current = next;
      if (leftWrapRef.current) {
        leftWrapRef.current.style.flex = `${next} 1 0%`;
      }
      if (rightWrapRef.current) {
        rightWrapRef.current.style.flex = `${1 - next} 1 0%`;
      }
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setRatio(liveRatio.current);
    }
    window.addEventListener('pointermove', onMovePointer);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMovePointer);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const both = Boolean(left && right);
  const aloneSide: PaneSide | null = left && !right ? 'left' : right && !left ? 'right' : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-sm text-[var(--color-text-muted)]">
          Side-by-side desk — use L / R on the app grid to place another app
        </p>
        {both ? (
          <button
            type="button"
            onClick={onSwap}
            className="rounded-lg bg-white/8 px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
          >
            Swap sides
          </button>
        ) : null}
      </div>

      <div
        ref={shellRef}
        className={`app-workspace flex min-h-0 flex-1 flex-col gap-2 md:flex-row md:gap-0 ${
          both ? '' : ''
        }`}
      >
        {left ? (
          // key={app.id} lets React move a pane's subtree on swap/move
          // instead of unmounting and remounting the federation remote.
          <div
            key={left.id}
            ref={leftWrapRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col max-md:min-h-[40dvh]"
            style={both ? { flex: `${ratio} 1 0%` } : undefined}
          >
            <AppPane
              side="left"
              app={left}
              focused={focus === 'left' || aloneSide === 'left'}
              alone={!both}
              onFocus={() => onFocus('left')}
              onClose={() => onClose('left')}
              onExpand={() => onExpand('left')}
              onMove={() => onMove('left')}
            />
          </div>
        ) : null}

        {both ? (
          <div
            key="splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
            className="app-workspace-splitter group relative hidden cursor-col-resize items-stretch justify-center md:flex md:w-2.5"
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = true;
            }}
          >
            <span className="my-auto h-16 w-1 rounded-full bg-white/20 transition group-hover:bg-[var(--color-accent)]" />
          </div>
        ) : null}

        {right ? (
          <div
            key={right.id}
            ref={rightWrapRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col max-md:min-h-[40dvh]"
            style={both ? { flex: `${1 - ratio} 1 0%` } : undefined}
          >
            <AppPane
              side="right"
              app={right}
              focused={focus === 'right' || aloneSide === 'right'}
              alone={!both}
              onFocus={() => onFocus('right')}
              onClose={() => onClose('right')}
              onExpand={() => onExpand('right')}
              onMove={() => onMove('right')}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
