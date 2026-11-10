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
  mail: 'M4 6h16v12H4zm0 0 8 7 8-7',
  files: 'M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  reports: 'M5 20V10m7 10V4m7 16v-8',
  susm: 'M4 7h16v10H4zm4 3h8m-8 3h5',
  espm: 'M12 3l8 4v6c0 4-3.5 7.5-8 9-4.5-1.5-8-5-8-9V7l8-4z',
  ocr: 'M4 5h16v14H4zm3 4h10M7 12h7M7 15h5',
  studio: 'M12 3l8 5v8l-8 5-8-5V8l8-5zm0 5v10m-7.5-6.5L12 13l7.5-4.5',
  catalog: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  contact: 'M4 6h16v12H4zm0 0 8 7 8-7',
  site: 'M6 3h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm9 0v5h5',
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
