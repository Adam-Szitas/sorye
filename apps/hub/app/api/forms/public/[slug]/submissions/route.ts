import { NextResponse } from 'next/server';
import { isFormAnswers, isFormSlug } from '@sorye/types';
import {
  FORMS_PUBLIC_LIMITS,
  FORMS_PUBLIC_MAX_BODY_BYTES,
  formsPublicLimiter,
  publicClientKey,
} from '@/lib/forms/public-rate-limit';
import { parsePublicSubmission, readBoundedText } from '@/lib/forms/public-submission';
import { RodrigoResponseError, submitPublicForm } from '@/lib/rodrigo/service-client';

const noStore = { 'Cache-Control': 'no-store' };
const fail = (status: number, code: string, extra: Record<string, string> = {}) =>
  NextResponse.json({ error: { code } }, { status, headers: { ...noStore, ...extra } });

/** Answer problems a visitor can fix; passed through. Everything else is collapsed. */
const VISITOR_CODES = new Set(['required_missing', 'invalid_answer', 'unknown_field', 'form_closed', 'submission_id_reused']);

/**
 * Anonymous submission. Hub bounds and rate-limits the request; Rodrigo resolves the
 * workspace from the slug, validates the answers against the stored definition and
 * stores the row. A lost response is safe to retry with the same submissionId.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isFormSlug(slug)) return fail(404, 'not_found');

  const client = publicClientKey(request.headers);
  const perClient = formsPublicLimiter.hit(`submit:${client}`, FORMS_PUBLIC_LIMITS.submitPerClient.max, FORMS_PUBLIC_LIMITS.submitPerClient.windowMs);
  if (perClient > 0) return fail(429, 'rate_limited', { 'Retry-After': String(perClient) });
  const perForm = formsPublicLimiter.hit(`form:${slug}`, FORMS_PUBLIC_LIMITS.submitPerForm.max, FORMS_PUBLIC_LIMITS.submitPerForm.windowMs);
  if (perForm > 0) return fail(429, 'rate_limited', { 'Retry-After': String(perForm) });

  let text: string;
  try {
    text = await readBoundedText(request, FORMS_PUBLIC_MAX_BODY_BYTES);
  } catch (error) {
    return error instanceof Error && error.message === 'too_large' ? fail(413, 'body_limit_exceeded') : fail(400, 'invalid_submission');
  }
  const parsed = parsePublicSubmission(text);
  if (!parsed) return fail(400, 'invalid_submission');
  // Bots fill every input. A filled trap is acknowledged and dropped, so they learn nothing.
  if (parsed.trap) return NextResponse.json({ status: 'accepted', submissionId: parsed.submissionId }, { status: 201, headers: noStore });
  if (!isFormAnswers(parsed.answers)) return fail(422, 'invalid_answer');

  try {
    const result = await submitPublicForm(slug, { submissionId: parsed.submissionId, answers: parsed.answers });
    return NextResponse.json(result, { status: result.status === 'accepted' ? 201 : 200, headers: noStore });
  } catch (error) {
    if (error instanceof RodrigoResponseError) {
      if (error.status === 404) return fail(404, 'not_found');
      if (VISITOR_CODES.has(error.code)) return fail(error.status === 409 ? 409 : 422, error.code);
      if (error.status < 500) return fail(400, 'invalid_submission');
    }
    return fail(503, 'forms_unavailable');
  }
}
