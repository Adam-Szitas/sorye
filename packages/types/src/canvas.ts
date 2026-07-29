/** Shared canvas board models for hub API + Canvas micro-app. */

export type CanvasItemType =
  | 'sticky'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'frame'
  | 'path';

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasItem {
  id: string;
  type: CanvasItemType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
  zIndex: number;
  /** Freehand stroke points (world coords relative to item x/y). */
  points?: CanvasPoint[];
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasDocument {
  items: CanvasItem[];
  viewport?: CanvasViewport;
}

export interface CanvasBoardSummary {
  id: string;
  workspaceId: string;
  title: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  itemCount: number;
}

export interface CanvasBoard extends CanvasBoardSummary {
  document: CanvasDocument;
}

export interface CanvasPresenceUser {
  userId: string;
  displayName: string;
  image?: string;
  color: string;
  cursor?: { x: number; y: number };
  lastSeenAt: string;
}

export function emptyCanvasDocument(): CanvasDocument {
  return {
    items: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export const STICKY_COLORS = [
  '#fef08a',
  '#bbf7d0',
  '#bfdbfe',
  '#fbcfe8',
  '#ddd6fe',
  '#fed7aa',
] as const;
