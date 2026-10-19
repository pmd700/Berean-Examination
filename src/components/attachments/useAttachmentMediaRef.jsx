import { useCallback, useRef } from 'react';

// Removing a media element alone can leave its native player alive until GC.
// Stop playback and release its decoded resource on close, lock, or file change.
export default function useAttachmentMediaRef() {
  const ref = useRef(null);
  return useCallback((media) => {
    const previous = ref.current;
    if (previous && previous !== media) {
      const hasResource = previous.networkState !== 0 || previous.readyState !== 0;
      if (!previous.paused) previous.pause();
      previous.removeAttribute('src');
      if (hasResource) previous.load();
    }
    ref.current = media;
  }, []);
}
