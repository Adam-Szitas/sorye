import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CanvasDocument,
  CanvasItem,
  CanvasItemType,
  CanvasPresenceUser,
  CanvasViewport,
} from '@sorye/types';
import { STICKY_COLORS } from '@sorye/types';

export type Tool = 'select' | 'pan' | 'pen' | CanvasItemType;

interface BoardCanvasProps {
  document: CanvasDocument;
  presence: CanvasPresenceUser[];
  currentUserId: string;
  onChange: (document: CanvasDocument) => void;
  onCursorMove: (point: { x: number; y: number } | null) => void;
  /** True while pointer gestures or text editing are active — parent should defer saves. */
  onInteractionChange?: (active: boolean) => void;
}

const DEFAULT_VIEW: CanvasViewport = { x: 0, y: 0, zoom: 1 };
const PLACE_TOOLS = new Set<Tool>([
  'sticky',
  'text',
  'rect',
  'ellipse',
  'frame',
]);

function createItem(type: CanvasItemType, x: number, y: number): CanvasItem {
  const id = `item-${crypto.randomUUID().slice(0, 8)}`;
  const base = { id, type, x, y, zIndex: Date.now(), rotation: 0 };

  switch (type) {
    case 'sticky':
      return {
        ...base,
        width: 180,
        height: 180,
        text: '',
        fill: STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)]!,
        fontSize: 14,
      };
    case 'text':
      return {
        ...base,
        width: 220,
        height: 48,
        text: '',
        fill: 'transparent',
        fontSize: 20,
      };
    case 'rect':
      return {
        ...base,
        width: 200,
        height: 120,
        fill: 'rgba(56, 189, 248, 0.18)',
        stroke: '#38bdf8',
      };
    case 'ellipse':
      return {
        ...base,
        width: 180,
        height: 180,
        fill: 'rgba(244, 114, 182, 0.18)',
        stroke: '#f472b6',
      };
    case 'frame':
      return {
        ...base,
        width: 420,
        height: 280,
        text: 'Frame',
        fill: 'rgba(255,255,255,0.03)',
        stroke: 'rgba(255,255,255,0.25)',
      };
    case 'path':
      return {
        ...base,
        width: 1,
        height: 1,
        points: [{ x: 0, y: 0 }],
        stroke: '#f1f5f9',
        strokeWidth: 3,
        fill: 'transparent',
      };
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]'),
  );
}

function pathBounds(points: { x: number; y: number }[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 4;
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
    points: points.map((p) => ({ x: p.x - (minX - pad), y: p.y - (minY - pad) })),
  };
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

const MIN_SIZE = 36;

function applyResize(
  item: CanvasItem,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  origin: { x: number; y: number; w: number; h: number },
): CanvasItem {
  let { x, y, w, h } = {
    x: origin.x,
    y: origin.y,
    w: origin.w,
    h: origin.h,
  };

  if (handle.includes('e')) w = origin.w + dx;
  if (handle.includes('s')) h = origin.h + dy;
  if (handle.includes('w')) {
    w = origin.w - dx;
    x = origin.x + dx;
  }
  if (handle.includes('n')) {
    h = origin.h - dy;
    y = origin.y + dy;
  }

  if (w < MIN_SIZE) {
    if (handle.includes('w')) x = origin.x + origin.w - MIN_SIZE;
    w = MIN_SIZE;
  }
  if (h < MIN_SIZE) {
    if (handle.includes('n')) y = origin.y + origin.h - MIN_SIZE;
    h = MIN_SIZE;
  }

  if (item.type === 'path' && item.points?.length) {
    const sx = w / Math.max(1, origin.w);
    const sy = h / Math.max(1, origin.h);
    return {
      ...item,
      x,
      y,
      width: w,
      height: h,
      points: item.points.map((p) => ({
        x: p.x * sx,
        y: p.y * sy,
      })),
    };
  }

  return { ...item, x, y, width: w, height: h };
}

export function BoardCanvas({
  document,
  presence,
  currentUserId,
  onChange,
  onCursorMove,
  onInteractionChange,
}: BoardCanvasProps) {
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [penColor, setPenColor] = useState('#f1f5f9');
  const viewport = document.viewport ?? DEFAULT_VIEW;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const toolBeforeSpace = useRef<Tool>('select');
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureActiveRef = useRef(false);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onInteractionChangeRef.current = onInteractionChange;
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    startMid: { x: number; y: number };
    originViewport: CanvasViewport;
  } | null>(null);
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);

  const reportInteraction = useCallback((gesturing: boolean, editing: string | null) => {
    gestureActiveRef.current = gesturing;
    onInteractionChangeRef.current?.(gesturing || editing !== null);
  }, []);

  useEffect(() => {
    reportInteraction(gestureActiveRef.current, editingId);
  }, [editingId, reportInteraction]);
  const dragRef = useRef<{
    mode: 'pan' | 'move' | 'draw' | 'resize';
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originW?: number;
    originH?: number;
    itemId?: string;
    points?: { x: number; y: number }[];
    originPoints?: { x: number; y: number }[];
    handle?: ResizeHandle;
    moved?: boolean;
    deselectOnEnd?: boolean;
  } | null>(null);

  const setViewport = useCallback(
    (next: CanvasViewport) => {
      onChange({ ...document, viewport: next });
    },
    [document, onChange],
  );

  const updateItems = useCallback(
    (items: CanvasItem[]) => {
      onChange({ ...document, items });
    },
    [document, onChange],
  );

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.x) / viewport.zoom,
        y: (clientY - rect.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId || isTypingTarget(e.target)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedId) return;
        e.preventDefault();
        updateItems(document.items.filter((i) => i.id !== selectedId));
        setSelectedId(null);
        return;
      }

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        toolBeforeSpace.current = tool;
        setTool('pan');
        return;
      }

      const hotkeys: Record<string, Tool> = {
        v: 'select',
        h: 'pan',
        p: 'pen',
        n: 'sticky',
        t: 'text',
        r: 'rect',
        o: 'ellipse',
        f: 'frame',
      };
      const next = hotkeys[e.key.toLowerCase()];
      if (next) {
        e.preventDefault();
        setEditingId(null);
        setTool(next);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        setTool(toolBeforeSpace.current);
      }
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [document.items, editingId, selectedId, tool, updateItems]);

  const beginPinch = () => {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !a || !b) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const vp = viewportRef.current;
    dragRef.current = null;
    pinchRef.current = {
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startZoom: vp.zoom,
      startMid: { x: mid.x - rect.left, y: mid.y - rect.top },
      originViewport: { ...vp },
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    surfaceRef.current?.setPointerCapture(e.pointerId);
    reportInteraction(true, editingId);

    if (pointersRef.current.size >= 2) {
      beginPinch();
      return;
    }

    if (e.button === 1 || tool === 'pan') {
      setEditingId(null);
      dragRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        originX: viewport.x,
        originY: viewport.y,
      };
      return;
    }

    if (tool === 'pen') {
      setEditingId(null);
      const point = screenToWorld(e.clientX, e.clientY);
      const item = createItem('path', point.x, point.y);
      item.stroke = penColor;
      item.points = [{ x: 0, y: 0 }];
      updateItems([...document.items, item]);
      setSelectedId(item.id);
      dragRef.current = {
        mode: 'draw',
        startX: e.clientX,
        startY: e.clientY,
        originX: point.x,
        originY: point.y,
        itemId: item.id,
        points: [{ x: point.x, y: point.y }],
      };
      return;
    }

    if (PLACE_TOOLS.has(tool)) {
      setEditingId(null);
      const point = screenToWorld(e.clientX, e.clientY);
      const item = createItem(tool as CanvasItemType, point.x, point.y);
      updateItems([...document.items, item]);
      setSelectedId(item.id);
      // Keep the placement tool active for multiple drops.
      if (item.type === 'sticky' || item.type === 'text') {
        setEditingId(item.id);
      }
      return;
    }

    // Select tool
    const target = e.target as HTMLElement;
    const resizeHandle = target.dataset.resize as ResizeHandle | undefined;
    const resizeItemId = target.dataset.resizeItem;
    if (resizeHandle && resizeItemId) {
      e.stopPropagation();
      const item = document.items.find((i) => i.id === resizeItemId);
      if (!item) return;
      setEditingId(null);
      setSelectedId(item.id);
      dragRef.current = {
        mode: 'resize',
        startX: e.clientX,
        startY: e.clientY,
        originX: item.x,
        originY: item.y,
        originW: item.width,
        originH: item.height,
        itemId: item.id,
        handle: resizeHandle,
        originPoints: item.points?.map((p) => ({ ...p })),
      };
      return;
    }

    const id = target.closest('[data-item-id]')?.getAttribute('data-item-id');
    if (id) {
      const item = document.items.find((i) => i.id === id);
      if (!item) return;
      setSelectedId(id);
      if (item.type === 'path') {
        setEditingId(null);
      }
      dragRef.current = {
        mode: 'move',
        startX: e.clientX,
        startY: e.clientY,
        originX: item.x,
        originY: item.y,
        itemId: id,
        moved: false,
      };
      return;
    }

    // Empty board: drag to pan; tap to clear selection.
    setEditingId(null);
    dragRef.current = {
      mode: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      originX: viewport.x,
      originY: viewport.y,
      moved: false,
      deselectOnEnd: true,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointersRef.current.size >= 2) {
      if (!pinchRef.current) beginPinch();
      const pinch = pinchRef.current;
      const pts = [...pointersRef.current.values()];
      const a = pts[0];
      const b = pts[1];
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (pinch && a && b && rect) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const midLocal = { x: mid.x - rect.left, y: mid.y - rect.top };
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const nextZoom = Math.min(
          2.5,
          Math.max(0.25, pinch.startZoom * (dist / pinch.startDist)),
        );
        const worldX =
          (pinch.startMid.x - pinch.originViewport.x) /
          pinch.originViewport.zoom;
        const worldY =
          (pinch.startMid.y - pinch.originViewport.y) /
          pinch.originViewport.zoom;
        setViewport({
          zoom: nextZoom,
          x: midLocal.x - worldX * nextZoom,
          y: midLocal.y - worldY * nextZoom,
        });
      }
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);
    onCursorMove(world);

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.mode === 'pan') {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      setViewport({
        ...viewportRef.current,
        x: drag.originX + dx,
        y: drag.originY + dy,
      });
      return;
    }

    if (drag.mode === 'draw' && drag.itemId && drag.points) {
      drag.points.push({ x: world.x, y: world.y });
      const bounds = pathBounds(drag.points);
      updateItems(
        document.items.map((item) =>
          item.id === drag.itemId
            ? {
                ...item,
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                points: bounds.points,
              }
            : item,
        ),
      );
      return;
    }

    if (
      drag.mode === 'resize' &&
      drag.itemId &&
      drag.handle &&
      drag.originW !== undefined &&
      drag.originH !== undefined
    ) {
      const zoom = viewportRef.current.zoom;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      updateItems(
        document.items.map((item) => {
          if (item.id !== drag.itemId) return item;
          const base =
            item.type === 'path' && drag.originPoints
              ? { ...item, points: drag.originPoints }
              : item;
          return applyResize(base, drag.handle!, dx, dy, {
            x: drag.originX,
            y: drag.originY,
            w: drag.originW!,
            h: drag.originH!,
          });
        }),
      );
      return;
    }

    if (drag.mode === 'move' && drag.itemId) {
      const zoom = viewportRef.current.zoom;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (editingId === drag.itemId) setEditingId(null);
      updateItems(
        document.items.map((item) =>
          item.id === drag.itemId
            ? { ...item, x: drag.originX + dx, y: drag.originY + dy }
            : item,
        ),
      );
    }
  };

  const beginEditing = useCallback((itemId: string) => {
    const item = document.items.find((i) => i.id === itemId);
    if (!item || (item.type !== 'sticky' && item.type !== 'text')) return;
    setSelectedId(itemId);
    setEditingId(itemId);
    lastTapRef.current = null;
    reportInteraction(gestureActiveRef.current, itemId);
  }, [document.items, reportInteraction]);

  const endPointer = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (pointersRef.current.size > 0) return;

    const drag = dragRef.current;
    let nextEditing = editingId;
    if (drag?.mode === 'move' && drag.itemId && !drag.moved) {
      const item = document.items.find((i) => i.id === drag.itemId);
      if (item && (item.type === 'sticky' || item.type === 'text')) {
        const now = Date.now();
        const last = lastTapRef.current;
        if (last && last.id === drag.itemId && now - last.at < 400) {
          nextEditing = item.id;
          setEditingId(item.id);
          lastTapRef.current = null;
        } else {
          lastTapRef.current = { id: drag.itemId, at: now };
        }
      } else {
        lastTapRef.current = null;
      }
    }
    if (drag?.deselectOnEnd && !drag.moved) {
      setSelectedId(null);
      nextEditing = null;
      setEditingId(null);
      lastTapRef.current = null;
    }
    dragRef.current = null;
    reportInteraction(false, nextEditing);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
    const nextZoom = Math.min(2.5, Math.max(0.25, viewport.zoom * zoomFactor));
    const worldX = (mouseX - viewport.x) / viewport.zoom;
    const worldY = (mouseY - viewport.y) / viewport.zoom;
    setViewport({
      zoom: nextZoom,
      x: mouseX - worldX * nextZoom,
      y: mouseY - worldY * nextZoom,
    });
  };

  const zoomBy = (factor: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const vp = viewportRef.current;
    const nextZoom = Math.min(2.5, Math.max(0.25, vp.zoom * factor));
    const worldX = (cx - vp.x) / vp.zoom;
    const worldY = (cy - vp.y) / vp.zoom;
    setViewport({
      zoom: nextZoom,
      x: cx - worldX * nextZoom,
      y: cy - worldY * nextZoom,
    });
  };

  const selected = document.items.find((i) => i.id === selectedId) ?? null;

  const cycleStickyColor = () => {
    if (!selected || selected.type !== 'sticky') return;
    const colors = [...STICKY_COLORS];
    const idx = colors.indexOf(
      selected.fill as (typeof STICKY_COLORS)[number],
    );
    const next = colors[(idx + 1) % colors.length]!;
    updateItems(
      document.items.map((i) =>
        i.id === selected.id ? { ...i, fill: next } : i,
      ),
    );
  };

  return (
    <div className="canvas-stage">
      <aside className="canvas-toolbar" aria-label="Tools">
        {(
          [
            ['select', 'Select', 'V'],
            ['pan', 'Pan', 'H'],
            ['pen', 'Draw', 'P'],
            ['sticky', 'Sticky', 'N'],
            ['text', 'Text', 'T'],
            ['rect', 'Rect', 'R'],
            ['ellipse', 'Ellipse', 'O'],
            ['frame', 'Frame', 'F'],
          ] as const
        ).map(([id, label, key]) => (
          <button
            key={id}
            type="button"
            className={tool === id ? 'active' : undefined}
            title={`${label} (${key})`}
            onClick={() => {
              setEditingId(null);
              setTool(id);
            }}
          >
            <span>{label}</span>
            <kbd>{key}</kbd>
          </button>
        ))}
        <div className="toolbar-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            title="Zoom out"
            onClick={() => zoomBy(0.85)}
          >
            −
          </button>
          <button type="button" title="Zoom in" onClick={() => zoomBy(1.15)}>
            +
          </button>
        </div>
        {tool === 'pen' ? (
          <label className="pen-color" title="Pen color">
            <input
              type="color"
              value={penColor}
              onChange={(e) => setPenColor(e.target.value)}
            />
          </label>
        ) : null}
        {selected?.type === 'sticky' ? (
          <button type="button" onClick={cycleStickyColor} title="Cycle color">
            Color
          </button>
        ) : null}
        {selectedId ? (
          <button
            type="button"
            className="toolbar-delete"
            title="Delete selected (Del)"
            onClick={() => {
              updateItems(document.items.filter((i) => i.id !== selectedId));
              setSelectedId(null);
              setEditingId(null);
            }}
          >
            Delete
          </button>
        ) : null}
        <p className="toolbar-hint">
          {tool === 'select'
            ? 'Double-click / double-tap to edit · Delete removes. Shift+Enter for a new line.'
            : tool === 'pen'
              ? 'Draw with one finger. Two fingers pan & pinch.'
              : tool === 'pan'
                ? 'Drag to pan. Pinch to zoom.'
                : 'Tap the board to place. Stays active.'}
        </p>
      </aside>

      <div
        ref={surfaceRef}
        className={`canvas-surface tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => onCursorMove(null)}
        onWheel={onWheel}
      >
        <div
          className="canvas-world"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          <div className="canvas-grid" />
          {document.items
            .slice()
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((item) => {
              const selected = selectedId === item.id;
              const handles =
                selected && tool === 'select' ? (
                  <div className="resize-handles" aria-hidden>
                    {(
                      [
                        'nw',
                        'n',
                        'ne',
                        'e',
                        'se',
                        's',
                        'sw',
                        'w',
                      ] as ResizeHandle[]
                    ).map((handle) => (
                      <span
                        key={handle}
                        className={`resize-handle resize-${handle}`}
                        data-resize={handle}
                        data-resize-item={item.id}
                      />
                    ))}
                  </div>
                ) : null;

              if (item.type === 'path') {
                return (
                  <div
                    key={item.id}
                    data-item-id={item.id}
                    className={[
                      'canvas-item',
                      'type-path',
                      selected ? 'selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      left: item.x,
                      top: item.y,
                      width: item.width,
                      height: item.height,
                    }}
                  >
                    <svg
                      width="100%"
                      height="100%"
                      viewBox={`0 0 ${item.width} ${item.height}`}
                    >
                      <polyline
                        fill="none"
                        stroke={item.stroke ?? '#f1f5f9'}
                        strokeWidth={item.strokeWidth ?? 3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={(item.points ?? [])
                          .map((p) => `${p.x},${p.y}`)
                          .join(' ')}
                      />
                    </svg>
                    {handles}
                  </div>
                );
              }

              return (
                <div
                  key={item.id}
                  data-item-id={item.id}
                  className={[
                    'canvas-item',
                    `type-${item.type}`,
                    selected ? 'selected' : '',
                    editingId === item.id ? 'editing' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    left: item.x,
                    top: item.y,
                    width: item.width,
                    height: item.height,
                    background: item.fill,
                    borderColor: item.stroke,
                    fontSize: item.fontSize,
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (tool !== 'select') return;
                    if (item.type === 'sticky' || item.type === 'text') {
                      beginEditing(item.id);
                    }
                  }}
                >
                  {editingId === item.id ? (
                    <textarea
                      className="item-editor"
                      autoFocus
                      placeholder={
                        item.type === 'text'
                          ? 'Type here… (Shift+Enter for new line)'
                          : 'Sticky note… (Shift+Enter for new line)'
                      }
                      value={item.text ?? ''}
                      onChange={(e) =>
                        updateItems(
                          document.items.map((i) =>
                            i.id === item.id
                              ? { ...i, text: e.target.value }
                              : i,
                          ),
                        )
                      }
                      onBlur={() => setEditingId(null)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingId(null);
                          return;
                        }
                        // Enter finishes editing; Shift+Enter inserts a line break.
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          setEditingId(null);
                          return;
                        }
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          const el = e.currentTarget;
                          const start = el.selectionStart;
                          const end = el.selectionEnd;
                          const value = item.text ?? '';
                          const next =
                            value.slice(0, start) + '\n' + value.slice(end);
                          updateItems(
                            document.items.map((i) =>
                              i.id === item.id ? { ...i, text: next } : i,
                            ),
                          );
                          requestAnimationFrame(() => {
                            el.selectionStart = el.selectionEnd = start + 1;
                          });
                        }
                      }}
                    />
                  ) : (
                    <div className="item-label">
                      {item.text ||
                        (item.type === 'sticky' || item.type === 'text'
                          ? 'Double-tap to edit'
                          : null)}
                    </div>
                  )}
                  {handles}
                </div>
              );
            })}

          {presence
            .filter((p) => p.userId !== currentUserId && p.cursor)
            .map((p) => (
              <div
                key={p.userId}
                className="presence-cursor"
                style={{
                  left: p.cursor!.x,
                  top: p.cursor!.y,
                  color: p.color,
                }}
              >
                <span className="presence-pointer" />
                <span className="presence-name">{p.displayName}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
