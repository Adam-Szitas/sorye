import { isPlatformAdmin } from '@/lib/platform-admin';

export interface OperatorDenial {
  status: 401 | 403;
  body: { error: string };
}

/** Session gate for operator routes. The body is only an error string. */
export function operatorDenial(user: {
  email: string;
  isAdmin: boolean;
} | null): OperatorDenial | null {
  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (!isPlatformAdmin(user)) return { status: 403, body: { error: 'Forbidden' } };
  return null;
}
