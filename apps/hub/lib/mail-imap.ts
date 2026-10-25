import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import {
  MAIL_ACCOUNT_PRESETS,
  MAIL_EXTERNAL_BODY_MAX,
  MAIL_SYNC_MESSAGE_MAX,
  type MailAccountEndpoint,
  type MailAccountProvider,
  type MailConnectedAccount,
  type MailExternalMessage,
  type MailFolderId,
} from '@sorye/types';
import { assertMailPort, assertSafeMailHost } from '@/lib/security';
import { clipMailText } from '@/lib/mail';

const CONNECT_MS = 12_000;
const SOCKET_MS = 20_000;

const SAFE_USER_ERROR =
  /is required|Email is invalid|Mail host is invalid|Mail port is invalid|Recipient email is invalid|already connected|up to \d+ accounts|Choose Gmail|workspaceId|too long|too many|not found|Unknown folder|Write a message|Folder is not available|Mail host|Mail port|not allowed|Could not resolve|Image must/i;

export function publicMailError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : fallback;
  if (SAFE_USER_ERROR.test(raw)) return raw;
  const cleaned = raw
    .replace(/pass(word)?\s*[=:].+/gi, '[redacted]')
    .replace(/AUTH[^\n]*/gi, 'AUTH [redacted]');
  if (/auth|invalid credentials|login|authentication|application-specific|command failed/i.test(cleaned)) {
    return 'Sign-in failed. Check the email and app password.';
  }
  if (/timeout|etimedout|enotfound|econnrefused|ehostunreach/i.test(cleaned)) {
    return 'Could not reach the mail server. Check host and port.';
  }
  if (/certificate|tls|ssl/i.test(cleaned)) {
    return 'Could not open a secure connection to the mail server.';
  }
  return fallback;
}

async function closeImap(client: ImapFlow): Promise<void> {
  try {
    if (client.usable) await client.logout();
    else client.close();
  } catch {
    try {
      client.close();
    } catch {
      // Ignore teardown errors so they never hide connect/auth failures.
    }
  }
}

export async function resolveMailEndpoints(
  provider: MailAccountProvider,
  imap?: Partial<MailAccountEndpoint>,
  smtp?: Partial<MailAccountEndpoint>,
): Promise<{ imap: MailAccountEndpoint; smtp: MailAccountEndpoint }> {
  if (provider === 'gmail' || provider === 'outlook') {
    return {
      imap: { ...MAIL_ACCOUNT_PRESETS[provider].imap },
      smtp: { ...MAIL_ACCOUNT_PRESETS[provider].smtp },
    };
  }

  const imapHost = await assertSafeMailHost(imap?.host ?? '');
  const smtpHost = await assertSafeMailHost(smtp?.host ?? '');
  return {
    imap: {
      host: imapHost,
      port: assertMailPort(imap?.port ?? 993),
      secure: imap?.secure !== false,
    },
    smtp: {
      host: smtpHost,
      port: assertMailPort(smtp?.port ?? 465),
      secure: smtp?.secure !== false,
    },
  };
}

function imapClient(
  endpoint: MailAccountEndpoint,
  username: string,
  password: string,
): ImapFlow {
  return new ImapFlow({
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.secure,
    auth: { user: username, pass: password },
    logger: false,
    emitLogs: false,
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
    socketTimeout: SOCKET_MS,
    tls: { minVersion: 'TLSv1.2' },
  });
}

function smtpTransport(
  endpoint: MailAccountEndpoint,
  username: string,
  password: string,
) {
  return nodemailer.createTransport({
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.secure,
    requireTLS: !endpoint.secure && endpoint.port === 587,
    auth: { user: username, pass: password },
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
    socketTimeout: SOCKET_MS,
    logger: false,
    tls: { minVersion: 'TLSv1.2' },
  });
}

function addressOf(
  value:
    | { address?: string; name?: string }
    | Array<{ address?: string; name?: string }>
    | undefined,
): { address: string; name: string } {
  const first = Array.isArray(value) ? value[0] : value;
  return {
    address: (first?.address ?? '').slice(0, 200),
    name: (first?.name ?? first?.address ?? '').slice(0, 120),
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetOf(text: string): string {
  return clipMailText(text.replace(/\s+/g, ' '), 160);
}

function isoOf(date: Date | string | undefined): string {
  if (!date) return new Date().toISOString();
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

async function resolveFolderPaths(client: ImapFlow): Promise<{
  inbox: string;
  sent: string | null;
  drafts: string | null;
}> {
  let sent: string | null = null;
  let drafts: string | null = null;
  try {
    const boxes = await client.list();
    for (const box of boxes) {
      const special = box.specialUse;
      const path = box.path;
      if ((special === '\\Sent' || /sent/i.test(path)) && !sent) sent = path;
      if ((special === '\\Drafts' || /draft/i.test(path)) && !drafts) {
        drafts = path;
      }
    }
  } catch {
    sent = 'Sent';
    drafts = 'Drafts';
  }
  return { inbox: 'INBOX', sent, drafts };
}

async function fetchFolder(
  client: ImapFlow,
  accountId: string,
  folder: MailFolderId,
  path: string,
): Promise<MailExternalMessage[]> {
  const lock = await client.getMailboxLock(path);
  try {
    const mailbox = client.mailbox;
    const exists = mailbox ? mailbox.exists : 0;
    if (!exists) return [];
    const start = Math.max(1, exists - MAIL_SYNC_MESSAGE_MAX + 1);
    const messages: MailExternalMessage[] = [];
    for await (const msg of client.fetch(
      `${start}:${exists}`,
      { envelope: true, flags: true, uid: true },
      { uid: false },
    )) {
      const from = addressOf(msg.envelope?.from);
      const to = addressOf(msg.envelope?.to);
      const subject = clipMailText(msg.envelope?.subject ?? '(no subject)', 160);
      const uid = msg.uid ?? 0;
      messages.push({
        id: `ext-${accountId}-${folder}-${uid}`,
        accountId,
        folder,
        uid,
        fromAddress: from.address,
        fromName: from.name || from.address,
        toAddress: to.address,
        toName: to.name || to.address,
        subject,
        snippet: subject,
        createdAt: isoOf(msg.envelope?.date),
        seen: Boolean(msg.flags?.has('\\Seen')),
        hasAttachments: false,
      });
    }
    return messages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    lock.release();
  }
}

export async function testMailConnection(input: {
  imap: MailAccountEndpoint;
  smtp: MailAccountEndpoint;
  username: string;
  password: string;
}): Promise<void> {
  const client = imapClient(input.imap, input.username, input.password);
  try {
    await client.connect();
    await client.list();
  } finally {
    await closeImap(client);
  }

  const transport = smtpTransport(input.smtp, input.username, input.password);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export async function syncMailAccount(input: {
  account: MailConnectedAccount;
  password: string;
}): Promise<{
  inbox: MailExternalMessage[];
  sent: MailExternalMessage[];
  drafts: MailExternalMessage[];
}> {
  const client = imapClient(
    input.account.imap,
    input.account.username,
    input.password,
  );
  try {
    await client.connect();
    const paths = await resolveFolderPaths(client);
    const inbox = await fetchFolder(
      client,
      input.account.id,
      'inbox',
      paths.inbox,
    );
    let sent: MailExternalMessage[] = [];
    let drafts: MailExternalMessage[] = [];
    if (paths.sent) {
      try {
        sent = await fetchFolder(client, input.account.id, 'sent', paths.sent);
      } catch {
        sent = [];
      }
    }
    if (paths.drafts) {
      try {
        drafts = await fetchFolder(
          client,
          input.account.id,
          'drafts',
          paths.drafts,
        );
      } catch {
        drafts = [];
      }
    }
    return { inbox, sent, drafts };
  } finally {
    await closeImap(client);
  }
}

export async function fetchMailBody(input: {
  account: MailConnectedAccount;
  password: string;
  folder: MailFolderId;
  uid: number;
}): Promise<string> {
  const client = imapClient(
    input.account.imap,
    input.account.username,
    input.password,
  );
  try {
    await client.connect();
    const paths = await resolveFolderPaths(client);
    const path =
      input.folder === 'inbox'
        ? paths.inbox
        : input.folder === 'sent'
          ? paths.sent
          : paths.drafts;
    if (!path) throw new Error('Folder is not available on this account');
    const lock = await client.getMailboxLock(path);
    try {
      const msg = await client.fetchOne(
        String(input.uid),
        { source: true, uid: true },
        { uid: true },
      );
      if (msg === false || msg == null || !msg.source) return '';
      const parsed = await simpleParser(msg.source);
      const text =
        parsed.text?.trim() ||
        (parsed.html ? stripHtml(String(parsed.html)) : '');
      return clipMailText(text, MAIL_EXTERNAL_BODY_MAX);
    } finally {
      lock.release();
    }
  } finally {
    await closeImap(client);
  }
}

export async function sendSmtpMail(input: {
  account: MailConnectedAccount;
  password: string;
  toAddress: string;
  subject: string;
  body: string;
  imageDataUrl?: string;
}): Promise<void> {
  const transport = smtpTransport(
    input.account.smtp,
    input.account.username,
    input.password,
  );
  try {
    const attachments = input.imageDataUrl
      ? [
          {
            filename: 'attachment.png',
            path: input.imageDataUrl,
          },
        ]
      : undefined;
    await transport.sendMail({
      from: input.account.email,
      to: input.toAddress,
      subject: input.subject,
      text: input.body,
      attachments,
    });
  } finally {
    transport.close();
  }
}
