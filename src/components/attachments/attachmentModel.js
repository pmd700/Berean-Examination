const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|oga|flac|aac|m4a|opus)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|mov|ogv)$/i;
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const VAULT_FILE_URL = new RegExp(`^bex-media://library/file-${UUID_V4}\\.[a-z0-9]{1,20}$`);

/**
 * @typedef {{openLocalFile?: (url: string) => Promise<{ok: boolean, error?: string}>,
 * getPrivacyStatus?: () => Promise<{ok?: boolean, status?: {locked?: boolean}}>,
 * onPrivacyStatusChanged?: (callback: (status: {locked?: boolean}) => void) => (() => void)}} AttachmentDesktopApi
 */
export function getAttachmentDesktopApi() {
  return /** @type {Window & {bexDesktop?: AttachmentDesktopApi}} */ (window).bexDesktop;
}

/** Restrict viewers to vault references; never fetch a URL copied into note HTML. */
export function isVaultAttachmentUrl(value) {
  // Exact canonical URLs from the main process: no normalization, arbitrary
  // path, credentials, percent escapes, or remotely supplied document URLs.
  return typeof value === 'string' && VAULT_FILE_URL.test(value);
}

/** Only PDF/audio/video get an in-app viewer or optional inline preview. */
export function getAttachmentPreviewKind(attachment) {
  if (!attachment || !isVaultAttachmentUrl(attachment.url)) return null;
  const mime = String(attachment.mimeType || '').toLowerCase().split(';')[0];
  const name = String(attachment.name || attachment.url);
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.test(name)) return 'audio';
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.test(name)) return 'video';
  return null;
}

export async function openAttachmentExternally(url) {
  if (!isVaultAttachmentUrl(url)) throw new Error('This attachment has an invalid vault reference.');
  const desktop = getAttachmentDesktopApi();
  if (typeof desktop?.openLocalFile !== 'function') {
    throw new Error('Open this attachment in the BEX desktop app.');
  }
  const result = await desktop.openLocalFile(url);
  if (!result?.ok) throw new Error(result?.error || 'The default app could not open this file.');
  return result;
}
