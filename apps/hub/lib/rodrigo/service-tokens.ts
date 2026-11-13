import { z } from 'zod';
import {
  RODRIGO_SERVICE_TOKEN_MAX_TTL_SECONDS, RODRIGO_SERVICE_TOKEN_SERVICES,
  type RodrigoServiceToken, type RodrigoServiceTokenRequest,
} from '@sorye/types';
import type { RodrigoContext } from './service-client';
import { readJson, signedFetch } from './transport';

const tokenSchema: z.ZodType<RodrigoServiceToken> = z.object({
  contractVersion: z.literal('2'), token: z.string().min(16).max(4096),
  audience: z.enum(['sorye-ocr', 'sorye-protocolio', 'sorye-ai']), keyId: z.string().max(64),
  expiresAt: z.number().int().positive(),
}).strict();

/**
 * Asks Rodrigo for a scoped token before Hub calls a compute service on the user's behalf.
 * Identity comes from the caller's server session; the token is never sent to a browser.
 */
export async function issueServiceToken(context: RodrigoContext, input: RodrigoServiceTokenRequest): Promise<RodrigoServiceToken> {
  if (!RODRIGO_SERVICE_TOKEN_SERVICES.includes(input.service) || !/^[a-z0-9._-]{1,64}$/.test(input.operation)
    || !Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > RODRIGO_SERVICE_TOKEN_MAX_TTL_SECONDS
    || !/^[a-z][a-z0-9-]{0,31}$/.test(input.appId)) {
    throw new Error('Invalid service token request.');
  }
  const response = await signedFetch({
    context, method: 'POST', path: '/v2/service-tokens', scope: 'service-tokens:issue', appScopes: [input.appId],
    body: JSON.stringify(input),
  });
  return readJson(response, tokenSchema);
}
