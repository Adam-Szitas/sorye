import {
  MAIL_ACCOUNT_PASSWORD_MAX,
  MAIL_BODY_MAX,
  MAIL_SUBJECT_MAX,
  type AddMailAccountInput,
  type MailAccountProvider,
  type SendExternalMailInput,
} from '@sorye/types';
import { accountLabelOf, parseMailAccountEmail } from '@/lib/mail';
import { resolveMailEndpoints } from '@/lib/mail-imap';

const PROVIDERS = new Set<MailAccountProvider>(['gmail', 'outlook', 'imap']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asProvider(value: unknown): MailAccountProvider {
  if (typeof value !== 'string' || !PROVIDERS.has(value as MailAccountProvider)) {
    throw new Error('Choose Gmail, Outlook, or custom IMAP');
  }
  return value as MailAccountProvider;
}

function endpointPatch(value: unknown): AddMailAccountInput['imap'] {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  return {
    host: typeof raw.host === 'string' ? raw.host : undefined,
    port: typeof raw.port === 'number' ? raw.port : undefined,
    secure: typeof raw.secure === 'boolean' ? raw.secure : undefined,
  };
}

export async function parseAddMailAccount(
  body: Record<string, unknown>,
): Promise<{
  provider: MailAccountProvider;
  email: string;
  password: string;
  label: string;
  username: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
}> {
  if (body.workspaceId != null) {
    throw new Error('workspaceId cannot be set by the client');
  }
  const provider = asProvider(body.provider);
  const email = parseMailAccountEmail(
    typeof body.email === 'string' ? body.email : '',
  );
  const password =
    typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > MAIL_ACCOUNT_PASSWORD_MAX) {
    throw new Error('App password is required');
  }
  const usernameRaw =
    typeof body.username === 'string' ? body.username.trim() : '';
  const username = usernameRaw || email;
  if (username.length > 200) throw new Error('Username is too long');
  const endpoints = await resolveMailEndpoints(
    provider,
    endpointPatch(body.imap),
    endpointPatch(body.smtp),
  );
  return {
    provider,
    email,
    password,
    label: accountLabelOf(
      provider,
      email,
      typeof body.label === 'string' ? body.label : undefined,
    ),
    username,
    imap: endpoints.imap,
    smtp: endpoints.smtp,
  };
}

export function parseExternalSend(
  body: Record<string, unknown>,
): SendExternalMailInput {
  if (body.workspaceId != null) {
    throw new Error('workspaceId cannot be set by the client');
  }
  const toAddress = (
    typeof body.toAddress === 'string' ? body.toAddress : ''
  )
    .trim()
    .toLowerCase();
  if (!EMAIL_RE.test(toAddress) || toAddress.length > 200) {
    throw new Error('Recipient email is invalid');
  }
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) throw new Error('Subject is required');
  if (subject.length > MAIL_SUBJECT_MAX) throw new Error('Subject is too long');
  const text = typeof body.body === 'string' ? body.body : '';
  if (text.length > MAIL_BODY_MAX) throw new Error('Message is too long');
  if (!text && typeof body.imageDataUrl !== 'string') {
    throw new Error('Write a message or attach an image');
  }
  return {
    toAddress,
    subject,
    body: text,
    imageDataUrl:
      typeof body.imageDataUrl === 'string' ? body.imageDataUrl : undefined,
  };
}
