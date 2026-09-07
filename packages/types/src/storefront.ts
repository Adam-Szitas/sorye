/** Workspace storefront — enquiry catalog and order requests (no payments). */

export type StorefrontOrderStatus = 'enquiry';

export interface StorefrontProduct {
  id: string;
  title: string;
  summary: string;
  description: string;
  /** Unit price in USD cents. Display-only until checkout is wired. */
  priceCents: number;
  category: string;
  accent: string;
}

export interface StorefrontOrderItem {
  productId: string;
  title: string;
  quantity: number;
  unitPriceCents: number;
}

export interface StorefrontOrder {
  id: string;
  workspaceId: string;
  userId: string;
  userName: string;
  status: StorefrontOrderStatus;
  items: StorefrontOrderItem[];
  note: string;
  totalCents: number;
  createdAt: string;
}

export interface PlaceStorefrontOrderInput {
  items: Array<{ productId: string; quantity: number }>;
  note?: string;
}

export interface UpsertStorefrontProductInput {
  id?: string;
  title: string;
  summary?: string;
  description?: string;
  priceCents: number;
  category?: string;
  accent?: string;
}

/** Seed catalog — SMB / shop-floor ops kits. Edit here, then new workspaces pick it up. */
export const STOREFRONT_SEED_PRODUCTS: readonly StorefrontProduct[] = [
  {
    id: 'sf-protocol-pack',
    title: 'Protocol pack',
    summary: 'SOP and inspection PDF templates for the floor.',
    description:
      'A starter set of Protocolio presets: toolbox talks, inspection sheets, and sign-off pages you can generate as PDFs from Hub.',
    priceCents: 8900,
    category: 'Documents',
    accent: '#a78bfa',
  },
  {
    id: 'sf-shop-floor-kit',
    title: 'Shop-floor kit',
    summary: 'Laminated checklists, tags, and a board starter pack.',
    description:
      'Printable checklists plus a Canvas board layout for daily stand-up. Built for smaller plants that still run on clipboards.',
    priceCents: 14900,
    category: 'Floor',
    accent: '#fb7185',
  },
  {
    id: 'sf-shift-handover',
    title: 'Shift handover pack',
    summary: 'Structured notes for overlapping crews.',
    description:
      'Handover sheets and a Messenger #events pattern so the next shift sees what moved without a verbal dump at the door.',
    priceCents: 5900,
    category: 'Ops',
    accent: '#34d399',
  },
  {
    id: 'sf-safety-briefing',
    title: 'Safety briefing kit',
    summary: 'Toolbox-talk cards and attendance sign-off.',
    description:
      'Short briefing cards with a sign-off block. Drop the PDF into OCR later if you need a searchable archive.',
    priceCents: 7900,
    category: 'Safety',
    accent: '#f59e0b',
  },
  {
    id: 'sf-maintenance-logs',
    title: 'Maintenance log pack',
    summary: 'Equipment logs and PM calendars as presets.',
    description:
      'Protocolio blocks for meter readings, work orders, and a Calendar-friendly PM cadence. Enquiry only — no card charge yet.',
    priceCents: 9900,
    category: 'Maintenance',
    accent: '#38bdf8',
  },
  {
    id: 'sf-ops-canvas',
    title: 'Ops canvas starter',
    summary: 'Sticky-note layouts for daily stand-up boards.',
    description:
      'A Canvas board template with swimlanes for blockers, running jobs, and parts on order. Duplicate it per line or crew.',
    priceCents: 4900,
    category: 'Boards',
    accent: '#f472b6',
  },
];

export function formatStorefrontPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function cloneStorefrontSeedProducts(): StorefrontProduct[] {
  return STOREFRONT_SEED_PRODUCTS.map((product) => ({ ...product }));
}
