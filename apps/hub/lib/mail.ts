import { randomUUID } from 'crypto';
import {
  MAIL_ADDRESS_SUFFIX,
  MAIL_BODY_MAX,
  MAIL_MAX_MESSAGES,
  MAIL_PERSONAL_EMAIL_MAX,
  MAIL_SUBJECT_MAX,
  type MailBootstrap,
  type MailDraft,
  type MailDraftInput,
  type MailMember,
  type MailMessage,
  type MailProfile,
  type MailSettingsInput,
  type SendMailInput,
} from '@sorye/types';
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

interface WorkspaceMailState {
  workspaceSlug: string;
  profiles: Record<string, MailProfileRecord>;
  messages: MailMessage[];
  drafts: Record<string, MailDraft>;
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

function emptyState(workspaceName: string, workspaceId: string): WorkspaceMailState {
  return {
    workspaceSlug: slugify(workspaceName, `ws-${idSuffix(workspaceId)}`),
    profiles: {},
    messages: [],
    drafts: {},
  };
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
