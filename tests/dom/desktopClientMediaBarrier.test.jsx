import { describe, expect, it, vi } from 'vitest';
import { desktopClient } from '@/api/desktopClient';
import { waitForLocalEntityWritesToSettle } from '@/lib/localEntities';

describe('desktopClient media backup barrier', () => {
  it('holds a Mass Backup snapshot until a protected image upload finishes', async () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, 'bexDesktop');
    let releaseUpload;
    const uploadGate = new Promise((resolve) => { releaseUpload = resolve; });

    Object.defineProperty(window, 'bexDesktop', {
      configurable: true,
      writable: true,
      value: {
        isDesktop: true,
        saveLocalImage: vi.fn(async () => {
          await uploadGate;
          return { ok: true, media: { url: 'bex-media://saved-image' } };
        }),
      },
    });

    try {
      const upload = desktopClient.media.uploadFile({
        file: {
          name: 'evidence.png',
          type: 'image/png',
          async arrayBuffer() {
            return Uint8Array.from([1, 2, 3]).buffer;
          },
        },
      });

      let barrierFinished = false;
      const barrier = waitForLocalEntityWritesToSettle({ quietMs: 5, timeoutMs: 300 })
        .then(() => { barrierFinished = true; });

      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(barrierFinished).toBe(false);

      releaseUpload();
      await expect(upload).resolves.toEqual({ file_url: 'bex-media://saved-image' });
      await barrier;
      expect(barrierFinished).toBe(true);
    } finally {
      if (previousDescriptor) Object.defineProperty(window, 'bexDesktop', previousDescriptor);
      else delete window.bexDesktop;
    }
  });
});
