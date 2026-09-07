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
/** Drive upload cap — bytes go to disk, never the JSON/Postgres row. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

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
