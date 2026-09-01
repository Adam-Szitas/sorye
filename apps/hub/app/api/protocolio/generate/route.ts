import { ensureHubUser } from '@/lib/ensure-user';
import {
  protocolioGenerate,
  resolveProtocolioApiUrl,
} from '@/lib/protocolio-bridge';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const template = await req.json().catch(() => null);
  if (!template || typeof template !== 'object' || !Array.isArray((template as { blocks?: unknown }).blocks)) {
    return NextResponse.json(
      { error: 'A PdfTemplate JSON body with a blocks array is required' },
      { status: 400 },
    );
  }

  try {
    const result = await protocolioGenerate(template);
    return new NextResponse(result.buffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'X-Generation-Time-Ms': String(result.generationTimeMs),
        'X-Protocolio-Api': resolveProtocolioApiUrl(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Protocolio generate failed',
        apiUrl: resolveProtocolioApiUrl(),
        hint:
          'Start the Protocolio API (PORT=3100 when Hub uses 3000) and set PROTOCOLIO_API_URL / PROTOCOLIO_DEV_TOKEN in Hub .env',
      },
      { status: 502 },
    );
  }
}
