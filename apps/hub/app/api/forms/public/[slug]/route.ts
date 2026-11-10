import { NextResponse } from 'next/server';
import { isFormSlug } from '@sorye/types';
import { FORMS_PUBLIC_LIMITS, formsPublicLimiter, publicClientKey } from '@/lib/forms/public-rate-limit';
import { readPublishedForm, RodrigoResponseError } from '@/lib/rodrigo/service-client';

const noStore = { 'Cache-Control': 'no-store' };

/** Anonymous read of a published form definition. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isFormSlug(slug)) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404, headers: noStore });
  const wait = formsPublicLimiter.hit(`read:${publicClientKey(request.headers)}`, FORMS_PUBLIC_LIMITS.read.max, FORMS_PUBLIC_LIMITS.read.windowMs);
  if (wait > 0) {
    return NextResponse.json({ error: { code: 'rate_limited' } }, { status: 429, headers: { ...noStore, 'Retry-After': String(wait) } });
  }
  try {
    const form = await readPublishedForm(slug);
    if (!form) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404, headers: noStore });
    return NextResponse.json({ form }, { headers: noStore });
  } catch (error) {
    const status = error instanceof RodrigoResponseError && error.status < 500 ? 404 : 503;
    return NextResponse.json({ error: { code: status === 404 ? 'not_found' : 'forms_unavailable' } }, { status, headers: noStore });
  }
}
