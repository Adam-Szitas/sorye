import type { MicroFrontendConfig } from '@sorye/types';

const REMOTE_ENV_OVERRIDES: Record<string, string | undefined> = {
  dashboard: process.env.NEXT_PUBLIC_DASHBOARD_REMOTE,
  calendar: process.env.NEXT_PUBLIC_CALENDAR_REMOTE,
  notes: process.env.NEXT_PUBLIC_NOTES_REMOTE,
  tasks: process.env.NEXT_PUBLIC_TASKS_REMOTE,
  relay: process.env.NEXT_PUBLIC_RELAY_REMOTE,
  protocolio: process.env.NEXT_PUBLIC_PROTOCOLIO_REMOTE,
  canvas: process.env.NEXT_PUBLIC_CANVAS_REMOTE,
  devkit: process.env.NEXT_PUBLIC_DEVKIT_REMOTE,
  messenger: process.env.NEXT_PUBLIC_MESSENGER_REMOTE,
  ocr: process.env.NEXT_PUBLIC_OCR_REMOTE,
};

export function resolveRemoteEntry(config: MicroFrontendConfig): string {
  return REMOTE_ENV_OVERRIDES[config.remoteName] ?? config.remoteEntry;
}
