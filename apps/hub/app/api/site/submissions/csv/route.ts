import { textFor, type SiteFormField } from '@sorye/site-sdk';
import { loadDrafts } from '@/lib/site-cms/drafts';
import { rodrigoContext, rodrigoFailure, siteSession } from '@/lib/site-cms/owner';

/**
 * CSV export of contact-form submissions (members). Values are plain text; cells that
 * a spreadsheet would run as a formula are prefixed with an apostrophe.
 */
function cell(value: unknown): string {
  let text = Array.isArray(value) ? value.join('; ') : value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET() {
  const gate = await siteSession();
  if ('response' in gate) return gate.response;
  try {
    const drafts = await loadDrafts(rodrigoContext(gate.session));
    const locale = drafts.settings?.value.defaultLocale ?? 'en';
    // Columns: every field id seen in the forms, labelled from the current draft pages.
    const labels = new Map<string, string>();
    for (const { value: page } of drafts.pages) {
      for (const section of page.sections) {
        if (section.type !== 'contactForm') continue;
        for (const field of section.props.fields as SiteFormField[]) labels.set(field.id, textFor(field.label, locale, locale) || field.id);
      }
    }
    for (const { value: s } of drafts.submissions) for (const key of Object.keys(s.answers)) if (!labels.has(key)) labels.set(key, key);
    const keys = [...labels.keys()];
    const header = ['Submitted at', 'Status', 'Page', 'Form', 'Language', ...keys.map((k) => labels.get(k)!)].map(cell).join(',');
    const rows = drafts.submissions.map(({ value: s }) => [s.submittedAt, s.status, s.pageId, s.sectionId, s.locale, ...keys.map((k) => s.answers[k])].map(cell).join(','));
    return new Response(`﻿${[header, ...rows].join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="site-submissions.csv"',
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return rodrigoFailure(error);
  }
}
