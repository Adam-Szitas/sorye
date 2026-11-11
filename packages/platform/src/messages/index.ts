import type { Locale } from './define';
import { common } from './common';
import { tasks } from './tasks';
import { messenger } from './messenger';
import { calendar } from './calendar';
import { notes } from './notes';
import { forms } from './forms';
import { apikeys } from './apikeys';
import { billing } from './billing';
import { ownstorage } from './ownstorage';

// Add a namespace here after creating its file in this folder.
const bundles = [common, tasks, messenger, calendar, notes, forms, apikeys, billing, ownstorage] as const;

// Distributes over the bundle union, so the result is the union of every namespace's keys.
type KeysOf<Bundle> = Bundle extends { en: infer English } ? keyof English : never;
export type MessageKey = KeysOf<(typeof bundles)[number]> & string;

export const messages = Object.fromEntries(
  (['en', 'de', 'sk', 'hu', 'es'] as const).map((locale) => [
    locale,
    Object.assign({}, ...bundles.map((bundle) => bundle[locale])),
  ]),
) as Record<Locale, Record<MessageKey, string>>;
