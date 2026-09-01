/** Cross-app handoffs — OCR (and others) → Protocolio PDF generation. */

export type HandoffKind = 'pdf-template';

export interface AppHandoff {
  id: string;
  workspaceId: string;
  sourceAppId: string;
  targetAppId: string;
  kind: HandoffKind;
  title: string;
  summary?: string;
  /** Opaque payload — for pdf-template this is a Protocolio PdfTemplate. */
  payload: unknown;
  createdAt: string;
  /** When Protocolio (or target) consumed it. */
  consumedAt?: string;
}

export interface CreateHandoffInput {
  sourceAppId: string;
  targetAppId: string;
  kind: HandoffKind;
  title: string;
  summary?: string;
  payload: unknown;
}

export const HANDOFF_BROADCAST_CHANNEL = 'sorye-app-handoff';

export interface HandoffBroadcastMessage {
  type: 'handoff-created';
  handoffId: string;
  targetAppId: string;
  sourceAppId: string;
  kind: HandoffKind;
}
