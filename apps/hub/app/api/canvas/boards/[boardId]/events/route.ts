import { ensureHubUser } from '@/lib/ensure-user';
import {
  authorizeBoardPresence,
  isBoardPresenceAuthorized,
  removePresence,
  subscribeBoard,
  upsertPresence,
  type CanvasRealtimeEvent,
} from '@/lib/canvas-realtime';
import { getCanvasBoard } from '@/lib/store/canvas';

type Params = { params: Promise<{ boardId: string }> };

export async function GET(req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { boardId } = await params;
  const board = await getCanvasBoard(
    session.user.id,
    session.workspace.id,
    boardId,
  );
  if (!board) {
    return new Response('Not found', { status: 404 });
  }

  authorizeBoardPresence(boardId, session.user.id);

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: CanvasRealtimeEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      const unsubscribe = subscribeBoard(boardId, send);
      const users = upsertPresence(boardId, {
        userId: session.user.id,
        displayName: session.user.displayName,
        image: session.user.image,
      });
      send({ type: 'presence', users });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
        upsertPresence(
          boardId,
          {
            userId: session.user.id,
            displayName: session.user.displayName,
            image: session.user.image,
          },
          { broadcast: false },
        );
      }, 15_000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        removePresence(boardId, session.user.id);
      };

      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function POST(req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { boardId } = await params;

  // Cursor updates are hot-path — only allow after SSE join (no DB round-trip).
  if (!isBoardPresenceAuthorized(boardId, session.user.id)) {
    return new Response('Join board stream first', { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    cursor?: { x: number; y: number } | null;
  };

  const users = upsertPresence(boardId, {
    userId: session.user.id,
    displayName: session.user.displayName,
    image: session.user.image,
    cursor: body.cursor ?? undefined,
  });

  return Response.json({ users });
}
