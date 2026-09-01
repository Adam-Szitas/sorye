export default function PipelineGuide() {
  return (
    <div className="section pipeline-guide">
      <h2>How it works</h2>
      <p className="guide-intro">
        In production, a <strong>backend service</strong> provisions a token once via{' '}
        <code>POST /api/auth/register</code>, stores it, and calls Protocolio for PDF generation.
        This playground simulates that flow in the browser.
      </p>
      <ol className="pipeline-steps">
        <li>
          <strong>OCR handoff</strong> — OCR sends a layout as a{' '}
          <code>PdfTemplate</code> via Hub handoffs + <code>sorye.ocr.ready</code>{' '}
          events; Protocolio loads it automatically
        </li>
        <li>
          <strong>Edit JSON</strong> — define page settings, metadata, and a <code>blocks</code> array
          (text, tables, images, columns, etc.)
        </li>
        <li>
          <strong>Validate</strong> — <code>POST /api/validate</code> checks structure (blocks array,
          each block has a <code>type</code>)
        </li>
        <li>
          <strong>Generate</strong> — <code>POST /api/generate</code> renders the template with PDFKit
          and returns a PDF binary
        </li>
        <li>
          <strong>Preview</strong> — the PDF appears below so you can see the final output
        </li>
      </ol>
      <div className="pipeline-diagram">
        <span className="pipe-node">OCR</span>
        <span className="pipe-arrow">→</span>
        <span className="pipe-node">Hub bridge</span>
        <span className="pipe-arrow">→</span>
        <span className="pipe-node">Protocolio API</span>
        <span className="pipe-arrow">→</span>
        <span className="pipe-node">PDF</span>
      </div>
      <p className="guide-intro" style={{ marginTop: '0.75rem' }}>
        Locally, Hub&apos;s developer bridge holds <code>PROTOCOLIO_DEV_TOKEN</code> and
        proxies generate — no browser Bearer token required.
      </p>
    </div>
  );
}
