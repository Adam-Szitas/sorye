/** In-app Sorye Mail — workspace mailbox, not a public MX. */

export const MAIL_ADDRESS_SUFFIX = 'mail.sorye';

export const MAIL_SUBJECT_MAX = 160;
export const MAIL_BODY_MAX = 10_000;
export const MAIL_PERSONAL_EMAIL_MAX = 200;
export const MAIL_MAX_MESSAGES = 400;

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

export interface MailBootstrap {
  profile: MailProfile;
  members: MailMember[];
  inbox: MailMessage[];
  sent: MailMessage[];
  draft: MailDraft | null;
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
