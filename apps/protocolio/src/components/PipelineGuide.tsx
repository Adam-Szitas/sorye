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
        <span className="pipe-node">Browser JSON</span>
        <span className="pipe-arrow">→</span>
        <span className="pipe-node">@protocolio/sdk</span>
        <span className="pipe-arrow">→</span>
        <span className="pipe-node">Protocolio API</span>
        <span className="pipe-arrow">→</span>
        <span className="pipe-node">PDF Engine</span>
        <span className="pipe-arrow">→</span>
        <span className="pipe-node">PDF Preview</span>
      </div>
    </div>
  );
}
