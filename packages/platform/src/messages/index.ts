import type { Locale } from './define';
import { common } from './common';
import { tasks } from './tasks';
import { messenger } from './messenger';
import { calendar } from './calendar';
import { notes } from './notes';

// Add a namespace here after creating its file in this folder.
const bundles = [common, tasks, messenger, calendar, notes] as const;

export type MessageKey = { [I in keyof typeof bundles]: keyof (typeof bundles)[I]['en'] }[number] & string;

export const messages = Object.fromEntries(
  (['en', 'de', 'sk', 'hu', 'es'] as const).map((locale) => [
    locale,
    Object.assign({}, ...bundles.map((bundle) => bundle[locale])),
  ]),
) as Record<Locale, Record<MessageKey, string>>;
