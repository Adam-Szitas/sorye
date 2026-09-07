/**
 * Product copy for the Hub-native Contact page.
 * Public emails and social URLs are fine here — no secrets.
 */
export const contactCopy = {
  name: 'Sorye',
  role: 'Workspace OS for ops automation',
  location: 'Smaller–mid corporations',
  offer:
    'A workspace OS for smaller–mid companies — document templates and ops boards in one shell.',
  intro:
    'Sorye is a Hub that hosts ops tools instead of twelve logins. It is built for smaller and mid-size corporations that move invoices, packing lists, and shop-floor work without buying an enterprise suite. Protocolio and Canvas run here as the real remotes — the same apps this workspace already hosts.',
  email: 'hello@sorye.dev',
  offers: [
    {
      title: 'Document automation',
      blurb:
        'Protocolio: design a PDF template, edit blocks, and watch an A4 preview update — invoices and packing lists, not a lorem form.',
    },
    {
      title: 'Ops boards',
      blurb:
        'Canvas: sticky notes, cards, and connectors on a shared board so intake-to-ledger is something you can rearrange.',
    },
    {
      title: 'One workspace OS',
      blurb:
        'Catalog, dock, and panes in a single shell. Other Sorye apps live in this Hub — enable them from the App Library.',
    },
    {
      title: 'Events when you need them',
      blurb:
        'Relay, OCR, Tasks, and Studio are real remotes. Open them from Catalog when you want the rest of the OS.',
    },
  ],
  caseStudies: [
    {
      kicker: 'Protocolio',
      title: 'An invoice that is actually a template',
      summary:
        'Start from Invoice or Packing list, change vendor and line items, and see the A4 page reflow. That is the document loop Sorye is built around.',
    },
    {
      kicker: 'Canvas',
      title: 'Inbound as a board, not a thread',
      summary:
        'Stickies for ASN and exceptions, cards for AP review, a connector between them. Drag the work until the path is obvious.',
    },
    {
      kicker: 'Hub',
      title: 'The rest of the OS stays in Hub',
      summary:
        'Tasks, Studio, Relay, Messenger — real remotes in this workspace. Enable them from Catalog; they are not dummy tiles.',
    },
  ],
} as const;

export function contactMailtoHref(): string {
  const subject = encodeURIComponent('Sorye — ops automation');
  return `mailto:${contactCopy.email}?subject=${subject}`;
}
