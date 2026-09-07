import type { Locator, Page } from '@playwright/test';
import { loc, type LocatorSpec } from './query';

/** Visual-diff masks for emails, avatars, and user chips. */
export const IdentityMask = {
  avatarChip: {
    css: '[class*="avatar" i], [class*="user-chip" i], [class*="userChip" i]',
  },
  userName: {
    css: '[class*="user-name" i], [class*="username" i], [class*="userName" i]',
  },
  profileImg: { role: 'img' as const, name: /avatar|profile|user/i },
  mailto: { css: 'a[href^="mailto:"]' },
  emailText: { text: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/ },
} as const satisfies Record<string, LocatorSpec>;

export function identityMaskLocators(page: Page): Locator[] {
  return [
    loc(page, IdentityMask.avatarChip),
    loc(page, IdentityMask.userName),
    loc(page, IdentityMask.profileImg),
    loc(page, IdentityMask.mailto),
    loc(page, IdentityMask.emailText),
  ];
}
