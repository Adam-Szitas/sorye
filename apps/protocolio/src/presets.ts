import type { PdfTemplate } from '@protocolio/sdk';
import { DEFAULT_PAGE_SETTINGS } from './defaults';

export const minimalPreset: PdfTemplate = {
  page: DEFAULT_PAGE_SETTINGS,
  blocks: [{ type: 'text', content: 'Hello from Protocolio' }],
};

export const tableHeavyPreset: PdfTemplate = {
  page: { size: 'A4', orientation: 'portrait' },
  metadata: { title: 'Table-Heavy Report' },
  blocks: [
    { type: 'text', content: 'Table-Heavy Report', font: { size: 24, bold: true } },
    { type: 'spacer', height: 10 },
    {
      type: 'table',
      columns: [
        { header: 'Product', width: '40%', align: 'left' },
        { header: 'Qty', width: '15%', align: 'center' },
        { header: 'Price', width: '20%', align: 'right' },
        { header: 'Total', width: '25%', align: 'right' },
      ],
      rows: [
        ['Widget A', 10, '$5.00', '$50.00'],
        ['Widget B', 25, '$3.50', '$87.50'],
        ['Widget C', 5, '$12.00', '$60.00'],
      ],
      headerBackground: '#333',
      headerFont: { color: '#fff', bold: true },
      stripedRows: true,
      stripedColor: '#f5f5f5',
    },
  ],
};

export const invoicePreset: PdfTemplate = {
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 60, right: 50, bottom: 60, left: 50 },
  },
  metadata: { title: 'Invoice #2024-0042', author: 'Acme Corp' },
  defaultFont: { family: 'DejaVu Sans', size: 11, color: '#333333' },
  blocks: [
    {
      type: 'headerFooter',
      position: 'footer',
      height: 30,
      blocks: [
        { type: 'text', content: '' },
        {
          type: 'text',
          content: 'Page {{pageNumber}} of {{totalPages}}',
          font: { size: 9, color: '#999999' },
        },
        { type: 'text', content: '' },
      ],
    },
    { type: 'text', content: 'INVOICE', font: { size: 32, bold: true, color: '#1a1a1a' } },
    { type: 'spacer', height: 5 },
    { type: 'divider', thickness: 2, color: '#0066cc', margin: 8 },
    {
      type: 'columns',
      gap: 20,
      columns: [
        {
          width: '55%',
          blocks: [
            {
              type: 'text',
              content: 'From:\nAcme Corp\n123 Main Street\nNew York, NY 10001',
              font: { size: 10 },
            },
          ],
        },
        {
          width: '45%',
          blocks: [
            {
              type: 'text',
              content: 'Invoice #2024-0042\nDate: January 15, 2024\nDue: February 15, 2024',
              font: { size: 10, align: 'right' },
            },
          ],
        },
      ],
    },
    { type: 'spacer', height: 15 },
    {
      type: 'table',
      columns: [
        { header: 'Description', width: '50%' },
        { header: 'Qty', width: '15%', align: 'center' },
        { header: 'Unit Price', width: '17%', align: 'right' },
        { header: 'Total', width: '18%', align: 'right' },
      ],
      rows: [
        ['Professional License (Annual)', 2, '$1,200.00', '$2,400.00'],
        ['Support Package', 1, '$500.00', '$500.00'],
        ['Setup & Onboarding', 1, '$350.00', '$350.00'],
      ],
      headerBackground: '#0066cc',
      headerFont: { color: '#fff', bold: true },
      stripedRows: true,
      stripedColor: '#f0f4ff',
    },
    { type: 'spacer', height: 10 },
    {
      type: 'text',
      content: 'Total Due: $3,250.00',
      font: { size: 16, bold: true, align: 'right', color: '#0066cc' },
    },
  ],
};

export const presets = [
  { id: 'minimal', label: 'Minimal', template: minimalPreset },
  { id: 'invoice', label: 'Invoice (full)', template: invoicePreset },
  { id: 'table', label: 'Table-heavy', template: tableHeavyPreset },
] as const;
