import { useEffect, useState } from 'react';
import { NEW_TESTAMENT } from '../utils/bibleData';

// The interlinear source codes the app understands. Old-Testament books can be
// rendered from either UXLC (Leningrad Codex) or MAM (Miqra according to the
// Masorah). New-Testament books use the Greek SBLGNT system.
export const OT_SOURCES = ['MAM'];

// Resolve the *effective* source for a book given the user's selected source.
// NT always collapses to SBLGNT. For OT we honour UXLC / MAM and otherwise
// fall back to MAM (the source that ships with bundled data).
export function resolveInterlinearSource(book, selectedSource) {
  if (NEW_TESTAMENT.includes(book)) return 'SBLGNT';
  return OT_SOURCES.includes(selectedSource) ? selectedSource : 'MAM';
}

// Single interlinear data hook. The selected source (UXLC / MAM / SBLGNT)
// drives both the fetch path and what gets rendered under each English verse.
export default function useInterlinearChapter(currentChapter, interlinearEnabled, selectedSource) {
  const [interlinearVerses, setInterlinearVerses] = useState({});
  const [isLoadingInterlinear, setIsLoadingInterlinear] = useState(false);
  const [attribution, setAttribution] = useState(null);
  const [error, setError] = useState(null);

  const book = currentChapter?.book;
  const isNewTestament = NEW_TESTAMENT.includes(book);
  const isOldTestament = !!currentChapter && !isNewTestament;
  const effectiveSource = currentChapter
    ? resolveInterlinearSource(book, selectedSource)
    : (selectedSource || 'UXLC');
  const isRtlSource = isOldTestament;

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      if (!currentChapter || !interlinearEnabled) {
        if (isMounted) {
          setInterlinearVerses({});
          setAttribution(null);
          setError(null);
          setIsLoadingInterlinear(false);
        }
        return;
      }

      setIsLoadingInterlinear(true);
      setError(null);
      setAttribution(null);

      try {
        if (effectiveSource === 'MAM') {
          const bridge = window.bexDesktop;
          if (!bridge?.isDesktop || typeof bridge.getLocalMamChapter !== 'function') {
            throw new Error('The local MAM reader is available only in the BEX desktop app.');
          }
          const result = await bridge.getLocalMamChapter({
            book,
            chapter: currentChapter.chapter_number,
          });
          if (!isMounted) return;
          if (result?.ok) {
            setInterlinearVerses(result.chapter?.verses || {});
            setAttribution(result.chapter?.attribution || null);
            setError(null);
          } else {
            setInterlinearVerses({});
            setAttribution(null);
            const reason = result?.error || 'MAM Hebrew text is unavailable for this chapter.';
            console.warn(`[interlinear] MAM unavailable for ${book} ${currentChapter.chapter_number}: ${reason}`);
            setError(reason);
          }
        } else {
          setInterlinearVerses({});
          setError(`${effectiveSource} requires a future local source package.`);
        }
      } catch (err) {
        if (!isMounted) return;
        console.error(
          `[interlinear] failed to load ${effectiveSource} for ${book} ${currentChapter?.chapter_number}:`,
          err?.message || err
        );
        setInterlinearVerses({});
        setError(`Could not load ${effectiveSource} source text. ${err?.message || ''}`.trim());
      } finally {
        if (isMounted) setIsLoadingInterlinear(false);
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [book, currentChapter?.chapter_number, interlinearEnabled, effectiveSource, isNewTestament]);

  return {
    interlinearVerses,
    isLoadingInterlinear,
    effectiveSource,
    attribution,
    error,
    isOldTestament,
    isNewTestament,
    isRtlSource,
  };
}
