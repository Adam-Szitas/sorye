// Dependency-free, reproducible PDFs with selectable text and expected content.
const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(__dirname, '../test-documents');
fs.mkdirSync(directory, { recursive: true });
const escape = (text) => text.replace(/[\\()]/g, '\\$&');

function writePdf(name, pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, n) => `${5 + n * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  pages.forEach((page, index) => {
    const lines = [
      '0.08 0.18 0.30 rg 0 740 612 52 re f',
      `1 1 1 rg BT /F1 19 Tf 40 759 Td (${escape(page.title)}) Tj ET`,
      '0.12 0.16 0.20 rg',
      ...page.lines.map((text, n) => `BT /F2 10 Tf 40 ${708 - n * 19} Td (${escape(text)}) Tj ET`),
      '0.65 0.72 0.80 RG 40 55 m 572 55 l S',
      `BT /F1 9 Tf 40 36 Td (Sorye OCR / Qwen3 8B test - page ${index + 1} of ${pages.length}) Tj ET`,
    ];
    const stream = lines.join('\n');
    const streamId = objects.length + 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, n) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${n + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(path.join(directory, name), pdf);
  fs.writeFileSync(path.join(directory, name.replace('.pdf', '.expected.json')), JSON.stringify({ pages }, null, 2));
  console.log(`${name}: ${pages.length} pages, ${Buffer.byteLength(pdf)} bytes`);
}

writePdf('sorye-ocr-qwen-test.pdf', [
  { title: 'Sorye | Document reading test', lines: [
    'DOCUMENT ID: SORYE-OCR-2026-001',
    'This is synthetic test data. No customer information is included.',
    'Purpose: check extraction, math retention, storage and summary.',
    '',
    'INVOICE: INV-TEST-1042       DATE: 2026-10-25',
    'Supplier: Example Research Lab',
    'Customer: Sorye Demo Workspace',
    '',
    'Item                    Quantity    Unit EUR    Total EUR',
    'Optical sensor                 3       40.00       120.00',
    'Calibration service            2       30.00        60.00',
    'Subtotal                                          180.00',
    'Tax at 20 percent                                  36.00',
    'Grand total                                       216.00',
    '',
    'Payment due: 2026-11-08',
    'PAGE-ONE-END-ALPHA',
  ] },
  { title: 'Mathematical expressions', lines: [
    'Keep these expressions as source text. Do not silently rewrite.',
    'ASCII notation is intentional for this extraction baseline.',
    '',
    '3*40+2*30=180',
    '180*0.20=36',
    '180+36=216',
    'x^2+2*x+1=(x+1)^2',
    'E=m*c^2',
    'v=120/2=60',
    'p=3.14159*r^2',
    '',
    'Units: distance in km, time in hours, speed in km/h.',
    'The quadratic expression is an identity, not a measured result.',
    'PAGE-TWO-END-BETA',
  ] },
  { title: 'Summary and verification', lines: [
    'The lab supplied three optical sensors and two calibrations.',
    'The invoice subtotal is EUR 180 and the tax is EUR 36.',
    'The payable total is EUR 216, due on 2026-11-08.',
    'The equations demonstrate arithmetic, powers and division.',
    '',
    'Verify that stored rows contain all three page-end markers.',
    'Verify that equations have MATH markers in the saved data.',
    'Verify that the summary mentions the invoice and its total.',
    'This PDF has selectable text. It does not test scanned images.',
    'A summary may omit details; the saved rows should preserve them.',
    '',
    'FINAL-SENTINEL-OMEGA-7391',
  ] },
]);

writePdf('sorye-ocr-qwen-12-pages.pdf', Array.from({ length: 12 }, (_, n) => ({
  title: `Sequential processing | Section ${n + 1}`,
  lines: [
    `SECTION-${String(n + 1).padStart(2, '0')}-START`,
    'A synthetic inspection report for extraction coverage testing.',
    ...Array.from({ length: 20 }, (_, r) => `Record ${String(n * 20 + r + 1).padStart(3, '0')}: sensor inspection completed; reading ${100 + n + r} units.`),
    `${n + 1}*10=${(n + 1) * 10}`,
    `SECTION-${String(n + 1).padStart(2, '0')}-END`,
    n === 11 ? 'FINAL-LARGE-SENTINEL-240-RECORDS' : 'Continued on the next page.',
  ],
})));
