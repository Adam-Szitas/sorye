const IMAGE_DATA_URL_RE =
  /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/** Max decoded-ish payload for base64 image data URLs (~4 MB raw). */
export const MAX_IMAGE_DATA_URL_LENGTH = 5_500_000;

export const MAX_HANDOFF_PAYLOAD_BYTES = 2_000_000;
export const MAX_MESSAGE_TEXT_LENGTH = 10_000;
export const MAX_STOREFRONT_ORDER_BYTES = 16_000;
export const MAX_STOREFRONT_PRODUCT_BYTES = 8_000;
export const MAX_SITE_BYTES = 32_000;
/** Mail send/draft JSON cap (image data URL + subject/body). */
export const MAX_MAIL_BYTES = 6_000_000;
/** Add/update connected mail account (no image). */
export const MAX_MAIL_ACCOUNT_BYTES = 8_000;
export const MAX_MAIL_ACCOUNTS = 8;
export const MAX_MAIL_SYNC_MESSAGES = 80;
export const MAX_MAIL_EXTERNAL_BODY = 50_000;
/** Drive upload cap — bytes go to disk, never the JSON/Postgres row. */
export { FILE_MAX_BYTES as MAX_FILE_BYTES } from '@sorye/types';

/** OCR → Qwen upload. Original PDFs are retained in workspace Drive. */
export const MAX_OCR_PDF_BYTES = 64 * 1024 * 1024;
export const MAX_OCR_PAGES = 500;
export const MAX_OCR_ANALYSES = 50;
export const MAX_OCR_ANALYSIS_BYTES = 16_000_000;

/** Tasks / Notes / Calendar workspace documents. */
export const MAX_TASKS_BOARD_BYTES = 256_000;
export const MAX_NOTES_BYTES = 512_000;
export const MAX_CALENDAR_BYTES = 256_000;
export const MAX_TASK_STATUSES = 30;
export const MAX_TASKS = 500;
export const MAX_TASK_TITLE_LENGTH = 200;
export const MAX_TASK_BODY_LENGTH = 8_000;
export const MAX_NOTES = 200;
export const MAX_NOTE_TITLE_LENGTH = 200;
export const MAX_NOTE_BODY_LENGTH = 50_000;
export const MAX_CALENDAR_EVENTS = 1_000;
export const MAX_CALENDAR_TITLE_LENGTH = 200;
export const MAX_CALENDAR_DATES = 366;

export function validateImageDataUrl(
  value: string,
): { ok: true; dataUrl: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!IMAGE_DATA_URL_RE.test(trimmed)) {
    return {
      ok: false,
      error: 'Image must be a base64 data URL (jpeg, png, webp, or gif)',
    };
  }
  if (trimmed.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return { ok: false, error: 'Image is too large' };
  }
  return { ok: true, dataUrl: trimmed };
}

export function assertJsonPayloadSize(
  payload: unknown,
  maxBytes: number,
  label = 'Payload',
): void {
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size > maxBytes) {
    throw new Error(`${label} exceeds maximum size (${maxBytes} bytes)`);
  }
}
