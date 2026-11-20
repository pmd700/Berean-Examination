import { useEffect, useId, useState } from 'react';

const DEFAULT_FOLDERS = [
  'Database',
  'Courses',
  'Media',
  'Imports',
  'Exports',
];

function readableError(error) {
  return error instanceof Error ? error.message : String(error);
}

export default function DesktopLibraryGate({ children }) {
  const desktopApi = typeof window !== 'undefined' ? window.bexDesktop : null;
  const renameHelpId = useId();
  const [status, setStatus] = useState(null);
  const [isChecking, setIsChecking] = useState(Boolean(desktopApi));
  const [isChoosing, setIsChoosing] = useState(false);
  const [isRenameHelpOpen, setIsRenameHelpOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!desktopApi) return undefined;

    let active = true;
    desktopApi.getLibraryStatus()
      .then((result) => {
        if (!result?.ok) throw new Error(result?.error || 'BEX could not check the library setting.');
        if (active) setStatus(result.status);
      })
      .catch((loadError) => {
        if (active) setError(readableError(loadError));
      })
      .finally(() => {
        if (active) setIsChecking(false);
      });

    return () => {
      active = false;
    };
  }, [desktopApi]);

  useEffect(() => {
    if (!isRenameHelpOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsRenameHelpOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isRenameHelpOpen]);

  if (!desktopApi) return children;

  if (isChecking) {
    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-[#0b0d14] text-slate-100">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 20%, rgba(124, 92, 183, 0.20), transparent 38%), linear-gradient(180deg, #10131d 0%, #090b11 100%)',
          }}
        />
        <div className="relative flex min-h-screen items-center justify-center px-6">
          <div className="text-center">
            <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-violet-400/25 border-t-violet-200" />
            <p className="text-sm text-slate-400">Checking your Berean Library…</p>
          </div>
        </div>
      </main>
    );
  }

  if (status?.available) return children;

  const rememberedPath = status?.path || null;
  const isMissing = Boolean(status?.configured);
  const folders = status?.folders || DEFAULT_FOLDERS;

  const chooseLibrary = async () => {
    setIsChoosing(true);
    setError('');

    try {
      const result = await desktopApi.chooseLibrary();
      if (!result?.ok) throw new Error(result?.error || 'BEX could not prepare that folder.');
      if (!result.canceled) setStatus(result.status);
    } catch (chooseError) {
      setError(readableError(chooseError));
    } finally {
      setIsChoosing(false);
    }
  };

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-x-hidden bg-[#0b0d14] px-5 py-8 text-slate-100 sm:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 12%, rgba(124, 92, 183, 0.22), transparent 35%), radial-gradient(circle at 85% 90%, rgba(201, 169, 78, 0.07), transparent 28%), linear-gradient(180deg, #10131d 0%, #090b11 100%)',
        }}
      />

      <section className="relative w-full max-w-4xl">
        <div className="rounded-3xl border border-white/10 bg-[#0a0d17]/95 p-6 shadow-2xl shadow-black/40 sm:p-8 lg:p-10">
          <header>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {isMissing ? 'Berean Library not found' : 'Choose your Berean Library'}
            </h1>
            <p className="mt-3 text-base leading-7 text-slate-400">
              {isMissing
                ? 'Choose the renamed or moved folder to continue.'
                : 'Choose where BEX will keep your local library.'}
            </p>
          </header>

          {rememberedPath && (
            <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Last known location
              </p>
              <p className="mt-1 break-all text-sm text-slate-300">{rememberedPath}</p>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-amber-300/35 bg-amber-300/[0.07] p-5">
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-300 font-black text-slate-950">
                !
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-amber-100">Protect your Berean Library</h2>
                <p className="mt-2 font-semibold text-white">Do not delete this folder.</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-white">Try not to rename or move this folder</p>
                  <span className="relative inline-flex">
                    <button
                      type="button"
                      aria-label="Why should I not rename this folder?"
                      aria-expanded={isRenameHelpOpen}
                      aria-controls={renameHelpId}
                      aria-describedby={isRenameHelpOpen ? renameHelpId : undefined}
                      onClick={() => setIsRenameHelpOpen((open) => !open)}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-amber-200/50 bg-amber-200/10 text-xs font-black text-amber-100 transition hover:bg-amber-200/20 focus:outline-none focus:ring-2 focus:ring-amber-200/70"
                      title="Why should I not rename this folder?"
                    >
                      ?
                    </button>
                    {isRenameHelpOpen && (
                      <span
                        id={renameHelpId}
                        role="tooltip"
                        className="absolute right-0 top-9 z-30 w-72 max-w-[75vw] rounded-xl border border-amber-200/25 bg-[#17130a] p-4 text-sm font-normal leading-6 text-amber-50 shadow-2xl shadow-black/60"
                      >
                        BEX remembers the folder&apos;s exact name and location. If either changes,
                        your files stay safe but BEX will ask you to choose the folder again.
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-7 border-t border-white/10 pt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Folders BEX creates
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {folders.map((folder) => (
                <div
                  key={folder}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-center text-sm font-medium text-slate-300"
                >
                  {folder}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-6 rounded-xl border border-rose-300/25 bg-rose-300/[0.07] px-4 py-3 text-sm text-rose-100"
            >
              {error}
            </div>
          )}

          <div className="mt-7 flex justify-end">
            <button
              type="button"
              onClick={chooseLibrary}
              disabled={isChoosing}
              className="rounded-xl bg-violet-500 px-6 py-3 font-bold text-white shadow-lg shadow-violet-950/30 transition hover:bg-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-wait disabled:opacity-60"
            >
              {isChoosing ? 'Preparing Library…' : 'Choose Berean Library'}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
