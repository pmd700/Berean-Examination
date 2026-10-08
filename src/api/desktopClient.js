/**
 * The renderer's narrow gateway to BEX's local desktop services.
 *
 * Importing this module never makes a network request. Records go through the
 * Electron bridge to encrypted SQLite, images go to protected local Media, and
 * future Online Mode calls remain sealed until a provider is deliberately wired.
 */

import { localEntities, runWithLocalBackupBarrier } from '@/lib/localEntities';
import { readLocalOwner, saveLocalOwnerPreferences } from '@/lib/localOwner';

function requireDesktopApi() {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop) {
    throw new Error('This feature is available only inside the BEX desktop app.');
  }
  return desktopApi;
}

const owner = Object.freeze({
  read: readLocalOwner,
  async exists() {
    try {
      await readLocalOwner();
      return true;
    } catch {
      return false;
    }
  },
  updatePreferences: saveLocalOwnerPreferences,
});

async function uploadFile({ file }) {
  return runWithLocalBackupBarrier(async () => {
    if (!file) throw new Error('No file provided');

    const desktopApi = requireDesktopApi();
    if (typeof desktopApi.saveLocalImage !== 'function') {
      throw new Error('Protected local image storage is unavailable.');
    }

    const result = await desktopApi.saveLocalImage({
      bytes: await file.arrayBuffer(),
      mimeType: file.type || '',
      name: file.name || '',
    });

    if (!result?.ok || !result.media?.url) {
      throw new Error(result?.error || 'BEX could not save that image locally.');
    }

    return { file_url: result.media.url };
  });
}

const online = Object.freeze({
  async invoke() {
    return {
      data: {
        ok: false,
        error: 'Online Mode is dormant. No provider or Internet request was started.',
      },
    };
  },
});

export const desktopClient = Object.freeze({
  owner,
  entities: localEntities,
  media: Object.freeze({ uploadFile }),
  online,
});

export default desktopClient;
