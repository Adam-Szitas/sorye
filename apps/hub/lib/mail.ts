import { randomUUID } from 'crypto';
import {
  MAIL_ACCOUNT_LABEL_MAX,
  MAIL_ACCOUNT_PASSWORD_MAX,
  MAIL_ADDRESS_SUFFIX,
  MAIL_BODY_MAX,
  MAIL_EXTERNAL_BODY_MAX,
  MAIL_MAX_CONNECTED_ACCOUNTS,
  MAIL_MAX_MESSAGES,
  MAIL_PERSONAL_EMAIL_MAX,
  MAIL_SUBJECT_MAX,
  MAIL_SYNC_MESSAGE_MAX,
  type MailAccountEndpoint,
  type MailAccountProvider,
  type MailAccountStatus,
  type MailBootstrap,
  type MailConnectedAccount,
  type MailDraft,
  type MailDraftInput,
  type MailExternalMessage,
  type MailFolderId,
  type MailMember,
  type MailMessage,
  type MailProfile,
  type MailSettingsInput,
  type SendMailInput,
} from '@sorye/types';
import { decryptMailSecret, encryptMailSecret } from '@/lib/storage-crypto';
import { validateImageDataUrl } from '@/lib/security-limits';
import { getWorkspaceMembers } from '@/lib/store';
import { jsonDataFile } from '@/lib/store/json-file';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERATED_RE = new RegExp(
  `^[a-z0-9][a-z0-9-]{0,39}@[a-z0-9][a-z0-9-]{0,39}\\.${MAIL_ADDRESS_SUFFIX.replace('.', '\\.')}$`,
);

interface MailProfileRecord {
  userSlug: string;
  generatedAddress: string;
  personalEmail: string;
  notifyMessenger: boolean;
}

interface MailAccountRecord {
  id: string;
  label: string;
  email: string;
  provider: MailAccountProvider;
  imap: MailAccountEndpoint;
  smtp: MailAccountEndpoint;
  username: string;
  passwordEncrypted: string;
  lastSync: string | null;
  status: MailAccountStatus;
  statusMessage?: string;
}

interface MailExternalFolderCache {
  inbox: MailExternalMessage[];
  sent: MailExternalMessage[];
  drafts: MailExternalMessage[];
}

interface WorkspaceMailState {
  workspaceSlug: string;
  profiles: Record<string, MailProfileRecord>;
  messages: MailMessage[];
  drafts: Record<string, MailDraft>;
  accounts: Record<string, MailAccountRecord[]>;
  external: Record<string, Record<string, MailExternalFolderCache>>;
}

type MailStore = Record<string, WorkspaceMailState>;

const mailFile = jsonDataFile<MailStore>('mail.json', () => ({}));

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function slugify(name: string, fallback: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return ascii || fallback;
}

function idSuffix(id: string, length = 6): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return (compact.slice(-length) || 'mail').slice(0, length);
}

function parsePersonalEmail(raw: string | undefined): string {
  const email = clip(raw ?? '', MAIL_PERSONAL_EMAIL_MAX);
  if (!email) return '';
  if (email.toLowerCase().includes('javascript:')) {
    throw new Error('Email is invalid');
  }
  if (!EMAIL_RE.test(email)) {
    throw new Error('Email is invalid');
  }
  return email.toLowerCase();
}

function cloneMessage(message: MailMessage): MailMessage {
  return { ...message };
}

function cloneDraft(draft: MailDraft | undefined): MailDraft | null {
  if (!draft) return null;
  return { ...draft };
}

function emptyFolders(): MailExternalFolderCache {
  return { inbox: [], sent: [], drafts: [] };
}

function emptyState(workspaceName: string, workspaceId: string): WorkspaceMailState {
  return {
    workspaceSlug: slugify(workspaceName, `ws-${idSuffix(workspaceId)}`),
    profiles: {},
    messages: [],
    drafts: {},
    accounts: {},
    external: {},
  };
}

function ensureCollections(state: WorkspaceMailState): void {
  if (!state.accounts) state.accounts = {};
  if (!state.external) state.external = {};
}

function usedGeneratedAddresses(
  state: WorkspaceMailState,
  exceptUserId?: string,
): Set<string> {
  const used = new Set<string>();
  for (const [userId, profile] of Object.entries(state.profiles)) {
    if (exceptUserId && userId === exceptUserId) continue;
    used.add(profile.generatedAddress);
  }
  return used;
}

function allocateGeneratedAddress(
  state: WorkspaceMailState,
  userId: string,
  displayName: string,
  email: string,
): { userSlug: string; generatedAddress: string } {
  const local = email.includes('@') ? email.split('@')[0] ?? displayName : displayName;
  let userSlug = slugify(displayName || local, `user-${idSuffix(userId)}`);
  let address = `${userSlug}@${state.workspaceSlug}.${MAIL_ADDRESS_SUFFIX}`;
  const used = usedGeneratedAddresses(state, userId);
  let extra = 4;
  while (used.has(address) || !GENERATED_RE.test(address)) {
    userSlug = `${slugify(displayName || local, 'user')}-${idSuffix(userId, extra)}`;
    address = `${userSlug}@${state.workspaceSlug}.${MAIL_ADDRESS_SUFFIX}`;
    extra += 2;
    if (extra > 16) {
      userSlug = `user-${idSuffix(userId, 10)}`;
      address = `${userSlug}@${state.workspaceSlug}.${MAIL_ADDRESS_SUFFIX}`;
      break;
    }
  }
  return { userSlug, generatedAddress: address };
}

function ensureProfile(
  state: WorkspaceMailState,
  member: { id: string; displayName: string; email: string },
): MailProfileRecord {
  const existing = state.profiles[member.id];
  if (existing?.generatedAddress) return existing;
  const allocated = allocateGeneratedAddress(
    state,
    member.id,
    member.displayName,
    member.email,
  );
  const next: MailProfileRecord = {
    userSlug: allocated.userSlug,
    generatedAddress: allocated.generatedAddress,
    personalEmail: existing?.personalEmail ?? '',
    notifyMessenger: existing?.notifyMessenger === true,
  };
  state.profiles[member.id] = next;
  return next;
}

async function withWorkspaceState<T>(
  workspaceId: string,
  workspaceName: string,
  fn: (state: WorkspaceMailState) => T | Promise<T>,
): Promise<T> {
  return mailFile.update((store) => {
    const state = store[workspaceId] ?? emptyState(workspaceName, workspaceId);
    if (!state.workspaceSlug) {
      state.workspaceSlug = slugify(workspaceName, `ws-${idSuffix(workspaceId)}`);
    }
    ensureCollections(state);
    store[workspaceId] = state;
    return fn(state);
  });
}

function toPublicProfile(
  userId: string,
  displayName: string,
  record: MailProfileRecord,
  includePersonal: boolean,
): MailProfile {
  return {
    userId,
    displayName,
    generatedAddress: record.generatedAddress,
    personalEmail: includePersonal ? record.personalEmail : '',
    notifyMessenger: record.notifyMessenger === true,
  };
}

function toMember(
  userId: string,
  displayName: string,
  record: MailProfileRecord,
): MailMember {
  return {
    userId,
    displayName,
    generatedAddress: record.generatedAddress,
  };
}

export async function bootstrapMail(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
}): Promise<MailBootstrap> {
  const members = await getWorkspaceMembers(input.workspaceId);
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const publicMembers: MailMember[] = [];
    let self: MailProfile | null = null;
    for (const member of members) {
      const record = ensureProfile(state, member);
      publicMembers.push(toMember(member.id, member.displayName, record));
      if (member.id === input.userId) {
        self = toPublicProfile(member.id, member.displayName, record, true);
      }
    }
    if (!self) {
      throw new Error('You are not a member of this workspace');
    }
    const inbox = state.messages
      .filter((message) => message.toUserId === input.userId)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneMessage);
    const sent = state.messages
      .filter((message) => message.fromUserId === input.userId)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneMessage);
    return {
      profile: self,
      members: publicMembers,
      inbox,
      sent,
      draft: cloneDraft(state.drafts[input.userId]),
      accounts: listPublicAccounts(state, input.userId),
    };
  });
}

function resolveRecipient(
  state: WorkspaceMailState,
  members: Array<{ id: string; displayName: string; email: string }>,
  input: SendMailInput,
): { userId: string; displayName: string; address: string } {
  const byId = new Map(members.map((member) => [member.id, member]));
  const requestedId = clip(input.toUserId ?? '', 64);
  const requestedAddress = clip(input.toAddress ?? '', 120).toLowerCase();

  if (requestedId) {
    const member = byId.get(requestedId);
    const record = member ? state.profiles[member.id] : undefined;
    if (!member || !record) {
      throw new Error('Recipient must be a workspace member');
    }
    return {
      userId: member.id,
      displayName: member.displayName,
      address: record.generatedAddress,
    };
  }

  if (requestedAddress) {
    for (const member of members) {
      const record = state.profiles[member.id];
      if (record?.generatedAddress === requestedAddress) {
        return {
          userId: member.id,
          displayName: member.displayName,
          address: record.generatedAddress,
        };
      }
    }
    throw new Error(
      'Recipient must be a workspace Sorye Mail address — Hub does not send internet email',
    );
  }

  throw new Error('Choose a workspace member or Sorye Mail address');
}

export async function sendMail(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  displayName: string;
  body: SendMailInput;
}): Promise<{ message: MailMessage; notifyMessenger: boolean }> {
  const members = await getWorkspaceMembers(input.workspaceId);
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const senderMember = members.find((member) => member.id === input.userId);
    if (!senderMember) {
      throw new Error('You are not a member of this workspace');
    }
    const sender = ensureProfile(state, senderMember);
    for (const member of members) ensureProfile(state, member);

    const recipient = resolveRecipient(state, members, input.body);
    const subject = clip(input.body.subject ?? '', MAIL_SUBJECT_MAX);
    if (!subject) throw new Error('Subject is required');
    const body = clip(input.body.body ?? '', MAIL_BODY_MAX);
    if (!body && !input.body.imageDataUrl) {
      throw new Error('Write a message or attach an image');
    }

    let imageDataUrl: string | undefined;
    if (input.body.imageDataUrl) {
      const image = validateImageDataUrl(input.body.imageDataUrl);
      if (!image.ok) throw new Error(image.error);
      imageDataUrl = image.dataUrl;
    }

    const message: MailMessage = {
      id: `mail-${randomUUID().slice(0, 10)}`,
      workspaceId: input.workspaceId,
      fromUserId: input.userId,
      fromAddress: sender.generatedAddress,
      fromName: input.displayName,
      toUserId: recipient.userId,
      toAddress: recipient.address,
      toName: recipient.displayName,
      subject,
      body,
      imageDataUrl,
      createdAt: new Date().toISOString(),
    };

    state.messages = [message, ...state.messages].slice(0, MAIL_MAX_MESSAGES);
    delete state.drafts[input.userId];
    return {
      message: cloneMessage(message),
      notifyMessenger: sender.notifyMessenger === true,
    };
  });
}

export async function updateMailSettings(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  displayName: string;
  patch: MailSettingsInput;
}): Promise<MailProfile> {
  const members = await getWorkspaceMembers(input.workspaceId);
  const self = members.find((member) => member.id === input.userId);
  if (!self) {
    throw new Error('You are not a member of this workspace');
  }
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const record = ensureProfile(state, self);
    if (input.patch.personalEmail !== undefined) {
      record.personalEmail = parsePersonalEmail(input.patch.personalEmail);
    }
    if (input.patch.notifyMessenger !== undefined) {
      record.notifyMessenger = input.patch.notifyMessenger === true;
    }
    state.profiles[input.userId] = record;
    return toPublicProfile(input.userId, input.displayName, record, true);
  });
}

export async function saveMailDraft(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  draft: MailDraftInput;
}): Promise<MailDraft> {
  const members = await getWorkspaceMembers(input.workspaceId);
  if (!members.some((member) => member.id === input.userId)) {
    throw new Error('You are not a member of this workspace');
  }

  let imageDataUrl: string | undefined;
  if (input.draft.imageDataUrl) {
    const image = validateImageDataUrl(input.draft.imageDataUrl);
    if (!image.ok) throw new Error(image.error);
    imageDataUrl = image.dataUrl;
  }

  const next: MailDraft = {
    subject: clip(input.draft.subject ?? '', MAIL_SUBJECT_MAX),
    body: clip(input.draft.body ?? '', MAIL_BODY_MAX),
    imageDataUrl,
    updatedAt: new Date().toISOString(),
  };

  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    state.drafts[input.userId] = next;
    return cloneDraft(next)!;
  });
}

export function isGeneratedMailAddress(value: string): boolean {
  return GENERATED_RE.test(value.trim().toLowerCase());
}

function toPublicAccount(record: MailAccountRecord): MailConnectedAccount {
  return {
    id: record.id,
    label: record.label,
    email: record.email,
    provider: record.provider,
    imap: { ...record.imap },
    smtp: { ...record.smtp },
    username: record.username,
    lastSync: record.lastSync,
    status: record.status,
    statusMessage: record.statusMessage,
  };
}

function listPublicAccounts(
  state: WorkspaceMailState,
  userId: string,
): MailConnectedAccount[] {
  return (state.accounts[userId] ?? []).map(toPublicAccount);
}

function cloneExternal(message: MailExternalMessage): MailExternalMessage {
  return { ...message };
}

export function parseMailAccountEmail(raw: string): string {
  return parsePersonalEmail(raw);
}

export async function listMailAccounts(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
}): Promise<MailConnectedAccount[]> {
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) =>
    listPublicAccounts(state, input.userId),
  );
}

export interface MailAccountSecret {
  account: MailConnectedAccount;
  password: string;
}

export async function getMailAccountSecret(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  accountId: string;
}): Promise<MailAccountSecret> {
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const record = (state.accounts[input.userId] ?? []).find(
      (account) => account.id === input.accountId,
    );
    if (!record) throw new Error('Mail account not found');
    return {
      account: toPublicAccount(record),
      password: decryptMailSecret(record.passwordEncrypted),
    };
  });
}

export async function addMailAccount(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  record: Omit<MailAccountRecord, 'id' | 'passwordEncrypted'> & {
    password: string;
  };
}): Promise<MailConnectedAccount> {
  const password = input.record.password;
  if (!password || password.length > MAIL_ACCOUNT_PASSWORD_MAX) {
    throw new Error('App password is required');
  }
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const existing = state.accounts[input.userId] ?? [];
    if (existing.length >= MAIL_MAX_CONNECTED_ACCOUNTS) {
      throw new Error(`You can connect up to ${MAIL_MAX_CONNECTED_ACCOUNTS} accounts`);
    }
    const email = input.record.email.toLowerCase();
    if (existing.some((account) => account.email === email)) {
      throw new Error('That email is already connected');
    }
    const record: MailAccountRecord = {
      id: `acct-${randomUUID().slice(0, 10)}`,
      label: input.record.label,
      email,
      provider: input.record.provider,
      imap: input.record.imap,
      smtp: input.record.smtp,
      username: input.record.username,
      passwordEncrypted: encryptMailSecret(password),
      lastSync: input.record.lastSync,
      status: input.record.status,
      statusMessage: input.record.statusMessage,
    };
    state.accounts[input.userId] = [...existing, record];
    return toPublicAccount(record);
  });
}

export async function removeMailAccount(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  accountId: string;
}): Promise<void> {
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const existing = state.accounts[input.userId] ?? [];
    if (!existing.some((account) => account.id === input.accountId)) {
      throw new Error('Mail account not found');
    }
    state.accounts[input.userId] = existing.filter(
      (account) => account.id !== input.accountId,
    );
    const userExternal = state.external[input.userId];
    if (userExternal) {
      delete userExternal[input.accountId];
    }
  });
}

export async function updateMailAccountStatus(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  accountId: string;
  status: MailAccountStatus;
  statusMessage?: string;
  lastSync?: string | null;
}): Promise<MailConnectedAccount> {
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const record = (state.accounts[input.userId] ?? []).find(
      (account) => account.id === input.accountId,
    );
    if (!record) throw new Error('Mail account not found');
    record.status = input.status;
    record.statusMessage = input.statusMessage;
    if (input.lastSync !== undefined) record.lastSync = input.lastSync;
    return toPublicAccount(record);
  });
}

export async function listExternalMessages(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  accountId: string;
  folder: MailFolderId;
}): Promise<MailExternalMessage[]> {
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const record = (state.accounts[input.userId] ?? []).find(
      (account) => account.id === input.accountId,
    );
    if (!record) throw new Error('Mail account not found');
    const cached = state.external[input.userId]?.[input.accountId];
    return (cached?.[input.folder] ?? []).map((message) => {
      const copy = cloneExternal(message);
      delete copy.body;
      return copy;
    });
  });
}

export async function putExternalMessages(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  accountId: string;
  folders: MailExternalFolderCache;
}): Promise<MailExternalFolderCache> {
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const record = (state.accounts[input.userId] ?? []).find(
      (account) => account.id === input.accountId,
    );
    if (!record) throw new Error('Mail account not found');
    const prev = state.external[input.userId]?.[input.accountId];
    const merged = emptyFolders();
    for (const folder of ['inbox', 'sent', 'drafts'] as const) {
      const previousById = new Map(
        (prev?.[folder] ?? []).map((message) => [message.id, message]),
      );
      merged[folder] = input.folders[folder]
        .slice(0, MAIL_SYNC_MESSAGE_MAX)
        .map((message) => {
          const older = previousById.get(message.id);
          if (older?.body && !message.body) {
            return { ...message, body: older.body };
          }
          return message;
        });
    }
    if (!state.external[input.userId]) state.external[input.userId] = {};
    state.external[input.userId][input.accountId] = merged;
    record.lastSync = new Date().toISOString();
    record.status = 'ok';
    record.statusMessage = undefined;
    return {
      inbox: merged.inbox.map((message) => {
        const copy = cloneExternal(message);
        delete copy.body;
        return copy;
      }),
      sent: merged.sent.map((message) => {
        const copy = cloneExternal(message);
        delete copy.body;
        return copy;
      }),
      drafts: merged.drafts.map((message) => {
        const copy = cloneExternal(message);
        delete copy.body;
        return copy;
      }),
    };
  });
}

export async function getExternalMessage(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  accountId: string;
  messageId: string;
}): Promise<MailExternalMessage> {
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const cached = state.external[input.userId]?.[input.accountId];
    if (!cached) throw new Error('Message not found');
    for (const folder of ['inbox', 'sent', 'drafts'] as const) {
      const found = cached[folder].find((message) => message.id === input.messageId);
      if (found) return cloneExternal(found);
    }
    throw new Error('Message not found');
  });
}

export async function setExternalMessageBody(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  accountId: string;
  messageId: string;
  body: string;
}): Promise<MailExternalMessage> {
  return withWorkspaceState(input.workspaceId, input.workspaceName, (state) => {
    const cached = state.external[input.userId]?.[input.accountId];
    if (!cached) throw new Error('Message not found');
    for (const folder of ['inbox', 'sent', 'drafts'] as const) {
      const found = cached[folder].find((message) => message.id === input.messageId);
      if (found) {
        found.body = clip(input.body, MAIL_EXTERNAL_BODY_MAX);
        return cloneExternal(found);
      }
    }
    throw new Error('Message not found');
  });
}

export function clipMailText(value: string, max: number): string {
  return clip(value, max);
}

export function accountLabelOf(
  provider: MailAccountProvider,
  email: string,
  label?: string,
): string {
  const named = clip(label ?? '', MAIL_ACCOUNT_LABEL_MAX);
  if (named) return named;
  if (provider === 'gmail') return `Gmail · ${email}`;
  if (provider === 'outlook') return `Outlook · ${email}`;
  return email;
}
