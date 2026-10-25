/** In-app Sorye Mail — workspace mailbox plus optional connected IMAP/SMTP. Not a public MX. */

export const MAIL_ADDRESS_SUFFIX = 'mail.sorye';

export const MAIL_SUBJECT_MAX = 160;
export const MAIL_BODY_MAX = 10_000;
export const MAIL_PERSONAL_EMAIL_MAX = 200;
export const MAIL_MAX_MESSAGES = 400;
export const MAIL_MAX_CONNECTED_ACCOUNTS = 8;
export const MAIL_ACCOUNT_PASSWORD_MAX = 200;
export const MAIL_ACCOUNT_LABEL_MAX = 80;
export const MAIL_ACCOUNT_HOST_MAX = 253;
export const MAIL_SYNC_MESSAGE_MAX = 80;
export const MAIL_EXTERNAL_BODY_MAX = 50_000;
export const MAIL_SORYE_ACCOUNT_ID = 'sorye';

export type MailAccountProvider = 'gmail' | 'outlook' | 'imap';
export type MailAccountStatus = 'ok' | 'error' | 'pending';
export type MailFolderId = 'inbox' | 'sent' | 'drafts';

export interface MailAccountEndpoint {
  host: string;
  port: number;
  secure: boolean;
}

export const MAIL_ACCOUNT_PRESETS: Record<
  Exclude<MailAccountProvider, 'imap'>,
  { imap: MailAccountEndpoint; smtp: MailAccountEndpoint }
> = {
  gmail: {
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
  },
  outlook: {
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
  },
};

export const MAIL_PROVIDER_LABELS: Record<MailAccountProvider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook / Hotmail',
  imap: 'Custom IMAP / SMTP',
};

/** Hub shell: open the Mail compose modal (`detail` is {@link MailComposeDetail}). */
export const HUB_MAIL_COMPOSE_EVENT = 'sorye:mail:compose';

export interface MailComposeDetail {
  subject?: string;
  body?: string;
  imageDataUrl?: string;
}

export interface MailProfile {
  userId: string;
  displayName: string;
  /** Stable in-app address, e.g. `alex@{workspace}.mail.sorye`. */
  generatedAddress: string;
  /** Optional personal inbox — only returned for the signed-in user. */
  personalEmail: string;
  notifyMessenger: boolean;
}

export interface MailMember {
  userId: string;
  displayName: string;
  generatedAddress: string;
}

export interface MailMessage {
  id: string;
  workspaceId: string;
  fromUserId: string;
  fromAddress: string;
  fromName: string;
  toUserId: string;
  toAddress: string;
  toName: string;
  subject: string;
  body: string;
  imageDataUrl?: string;
  createdAt: string;
}

export interface MailDraft {
  subject: string;
  body: string;
  imageDataUrl?: string;
  updatedAt: string;
}

/** Public connected account — never includes passwords or tokens. */
export interface MailConnectedAccount {
  id: string;
  label: string;
  email: string;
  provider: MailAccountProvider;
  imap: MailAccountEndpoint;
  smtp: MailAccountEndpoint;
  username: string;
  lastSync: string | null;
  status: MailAccountStatus;
  statusMessage?: string;
}

export interface MailExternalMessage {
  id: string;
  accountId: string;
  folder: MailFolderId;
  uid: number;
  fromAddress: string;
  fromName: string;
  toAddress: string;
  toName: string;
  subject: string;
  snippet: string;
  body?: string;
  createdAt: string;
  seen: boolean;
  hasAttachments: boolean;
}

export interface MailBootstrap {
  profile: MailProfile;
  members: MailMember[];
  inbox: MailMessage[];
  sent: MailMessage[];
  draft: MailDraft | null;
  accounts: MailConnectedAccount[];
}

export interface AddMailAccountInput {
  provider: MailAccountProvider;
  email: string;
  password: string;
  label?: string;
  username?: string;
  imap?: Partial<MailAccountEndpoint>;
  smtp?: Partial<MailAccountEndpoint>;
}

export interface SendExternalMailInput {
  toAddress: string;
  subject: string;
  body: string;
  imageDataUrl?: string;
}

export interface SendMailInput {
  toUserId?: string;
  toAddress?: string;
  subject: string;
  body: string;
  imageDataUrl?: string;
}

export interface MailSettingsInput {
  personalEmail?: string;
  notifyMessenger?: boolean;
}

export interface MailDraftInput {
  subject?: string;
  body?: string;
  imageDataUrl?: string;
}
