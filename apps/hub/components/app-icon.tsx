import type { AppCatalogEntry } from '@sorye/types';

const ICON_PATHS: Record<string, string> = {
  notes: 'M6 4h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 0v4h4',
  calendar:
    'M7 4V2m10 2V2M4 8h16M6 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  pulse: 'M3 12h4l2-7 4 14 2-7h6',
  inbox: 'M4 6h16v12H4zm0 0 8 6 8-6',
  relay: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  store: 'M4 8l2-4h12l2 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm6 4v6m4-6v6',
  code: 'M8 9l-4 3 4 3m8-6l4 3-4 3M14 7l-4 10',
  protocolio: 'M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 5h4m-5 4h6m-6 4h4',
  canvas: 'M4 4h16v16H4zm4 4h8v8H8z',
  tasks: 'M4 6h16M4 12h10M4 18h14',
  chat: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6z',
  reports: 'M6 20V10m6 20V4m6 16v-8',
};

interface AppIconProps {
  app: AppCatalogEntry;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'h-10 w-10',
  md: 'h-14 w-14',
  lg: 'h-16 w-16',
};

export function AppIcon({ app, size = 'md' }: AppIconProps) {
  const path = ICON_PATHS[app.icon] ?? ICON_PATHS.notes;

  return (
    <div
      className={`${sizeMap[size]} flex shrink-0 items-center justify-center rounded-2xl shadow-lg`}
      style={{
        background: `linear-gradient(135deg, ${app.color}dd, ${app.color}88)`,
        boxShadow: `0 8px 24px ${app.color}33`,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-1/2 w-1/2 text-white"
        aria-hidden
      >
        <path d={path} />
      </svg>
    </div>
  );
}
