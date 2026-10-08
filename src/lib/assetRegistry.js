import { platformEntities } from '@/lib/platform/entities';

function requireDesktopMedia() {
  const desktop = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktop?.isDesktop) {
    throw new Error('The Asset Library is available only inside the BEX desktop app.');
  }
  return desktop;
}

export async function listAssets() {
  return platformEntities.Asset.list('-created_date');
}

export async function uploadAsset(file) {
  if (!(file instanceof File)) throw new Error('Choose a valid image file.');
  const desktop = requireDesktopMedia();
  const bytes = await file.arrayBuffer();
  const saved = await desktop.saveLocalImage({
    bytes,
    mimeType: file.type || '',
    name: file.name || '',
  });
  if (!saved?.ok || !saved.media?.url) {
    throw new Error(saved?.error || 'BEX could not save that image locally.');
  }
  try {
    return await platformEntities.Asset.create({
      name: file.name,
      url: saved.media.url,
      mime_type: saved.media.mimeType,
      size: saved.media.size,
    });
  } catch (error) {
    await desktop.deleteLocalImage(saved.media.url).catch(() => {});
    throw error;
  }
}

export async function deleteAsset(id) {
  const desktop = requireDesktopMedia();
  const asset = await platformEntities.Asset.get(id);
  const deleted = await platformEntities.Asset.delete(id);
  const mediaResult = await desktop.deleteLocalImage(asset.url);
  if (!mediaResult?.ok || !mediaResult.result?.deleted) {
    throw new Error(mediaResult?.error || 'The encrypted image file could not be removed.');
  }
  return deleted;
}
