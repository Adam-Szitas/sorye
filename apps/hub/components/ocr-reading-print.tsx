'use client';

export function PrintReadingButton() {
  return (
    <button type="button" className="reading-print" onClick={() => window.print()}>
      Print
    </button>
  );
}
