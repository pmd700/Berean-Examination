import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  KeyRound,
  Laptop,
  LoaderCircle,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import './ActivationGate.css';

const SUCCESS_HOLD_MS = 1500;

function readableError(error) {
  return error instanceof Error ? error.message : String(error);
}

export default function DesktopActivationGate({ children }) {
  const desktopApi = typeof window !== 'undefined' ? window.bexDesktop : null;
  const successTimer = useRef(null);
  const [phase, setPhase] = useState(desktopApi ? 'checking' : 'activated');
  const [requestCode, setRequestCode] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!desktopApi) return undefined;

    let active = true;
    setPhase('checking');
    setError('');

    const loadActivation = async () => {
      try {
        const statusResult = await desktopApi.getActivationStatus();
        if (!statusResult?.ok) {
          throw new Error(statusResult?.error || 'BEX could not check activation.');
        }

        if (statusResult.status?.activated) {
          if (active) setPhase('activated');
          return;
        }

        const requestResult = await desktopApi.getActivationRequest();
        if (!requestResult?.ok || !requestResult.requestCode) {
          throw new Error(requestResult?.error || 'BEX could not create a request code.');
        }

        if (active) {
          setRequestCode(requestResult.requestCode);
          setPhase('ready');
        }
      } catch (loadError) {
        if (active) {
          setError(readableError(loadError));
          setPhase('ready');
        }
      }
    };

    loadActivation();

    return () => {
      active = false;
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, [desktopApi, retryKey]);

  const submitActivation = async (event) => {
    event.preventDefault();
    if (!activationCode.trim() || phase === 'submitting') return;

    setError('');
    setPhase('submitting');

    try {
      const result = await desktopApi.submitActivationCode(activationCode);
      if (!result?.ok) {
        throw new Error(result?.error || 'BEX could not confirm this activation.');
      }
      if (!result.status?.activated) {
        throw new Error('BEX could not confirm this activation.');
      }

      setActivationCode('');
      setPhase('success');
      successTimer.current = setTimeout(() => setPhase('activated'), SUCCESS_HOLD_MS);
    } catch (submitError) {
      setError(readableError(submitError));
      setPhase('ready');
    }
  };

  if (!desktopApi || phase === 'activated') return children;

  const isSubmitting = phase === 'submitting';

  return (
    <div className="bex-activation-gate fixed inset-0 z-[2000] overflow-y-auto bg-[#070910] text-white">
      <div className="bex-activation-aurora" aria-hidden="true" />
      <div className="bex-activation-grid" aria-hidden="true" />

      <main className="relative z-10 mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bex-activation-brand-mark">
              <img src="/logo.png" alt="" className="h-9 w-9 object-contain" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-200/80">
                BEX Launcher Official
              </p>
              <p className="mt-0.5 text-sm font-semibold text-slate-200">Berean Examination</p>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-1.5 text-xs font-semibold text-emerald-100 sm:flex">
            <WifiOff className="h-3.5 w-3.5" />
            Offline activation
          </div>
        </header>

        <div className="bex-activation-frame my-auto grid items-center gap-8 py-10 lg:grid-cols-[0.88fr_1.12fr] lg:gap-14">
          <section className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-300/[0.07] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-violet-200">
              <ShieldCheck className="h-4 w-4" />
              One-time setup
            </div>

            <h1 className="max-w-lg text-4xl font-semibold leading-[1.04] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
              Your study library.
              <span className="mt-2 block bg-gradient-to-r from-violet-300 via-white to-amber-200 bg-clip-text text-transparent">
                Fully offline.
              </span>
            </h1>

            <p className="mt-5 max-w-lg text-base leading-7 text-slate-400 sm:text-lg">
              Activate this Mac once, then Berean Examination opens locally without an account or licensing server.
            </p>

            <div className="mt-8 grid max-w-lg gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="bex-activation-proof">
                <Laptop className="h-4 w-4 text-violet-200" />
                <span>This Mac</span>
              </div>
              <div className="bex-activation-proof">
                <KeyRound className="h-4 w-4 text-amber-200" />
                <span>Full access</span>
              </div>
              <div className="bex-activation-proof">
                <WifiOff className="h-4 w-4 text-emerald-200" />
                <span>No Internet</span>
              </div>
            </div>
          </section>

          <section
            className="bex-activation-panel relative overflow-hidden rounded-[28px] border border-white/10 bg-[#0d101a]/95 shadow-2xl shadow-black/50"
            data-phase={phase}
            aria-busy={isSubmitting}
          >
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/70 to-transparent" />

            {phase === 'success' ? (
              <div className="bex-success-content flex min-h-[500px] flex-col items-center justify-center px-7 py-12 text-center sm:px-10">
                <div className="bex-success-orbit" aria-hidden="true">
                  <span className="bex-success-spark bex-success-spark-one" />
                  <span className="bex-success-spark bex-success-spark-two" />
                  <span className="bex-success-spark bex-success-spark-three" />
                  <span className="bex-success-spark bex-success-spark-four" />
                  <div className="bex-success-check">
                    <Check className="h-10 w-10" strokeWidth={2.4} />
                  </div>
                </div>
                <p className="mt-8 text-xs font-bold uppercase tracking-[0.24em] text-emerald-200">
                  Activation confirmed
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                  Welcome to Berean Examination
                </h2>
                <p className="mt-3 text-sm text-slate-400">Opening your local study library…</p>
              </div>
            ) : (
              <div className="p-6 sm:p-8 lg:p-9">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-200/80">
                    Activate this Mac
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    Complete the offline exchange
                  </h2>
                </div>

                {phase === 'checking' ? (
                  <div className="flex min-h-[380px] flex-col items-center justify-center text-center">
                    <LoaderCircle className="h-8 w-8 animate-spin text-violet-300" />
                    <p className="mt-4 text-sm text-slate-400">Checking this installation…</p>
                  </div>
                ) : (
                  <form onSubmit={submitActivation} className="mt-7">
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor="bex-request-code" className="text-sm font-semibold text-slate-100">
                          <span className="mr-2 text-violet-300">01</span>
                          Send this request code to David
                        </label>
                        <span className="text-[11px] font-medium text-slate-500">Click to select</span>
                      </div>
                      <input
                        id="bex-request-code"
                        value={requestCode || 'Request code unavailable'}
                        readOnly
                        onFocus={(event) => event.currentTarget.select()}
                        className="bex-request-code mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3.5 font-mono text-[12px] leading-5 text-violet-100 outline-none transition focus:border-violet-300/45 focus:ring-2 focus:ring-violet-400/10 sm:text-[13px]"
                        data-testid="activation-request-code"
                      />
                    </div>

                    <div className="my-6 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                    <div>
                      <label htmlFor="bex-activation-code" className="text-sm font-semibold text-slate-100">
                        <span className="mr-2 text-violet-300">02</span>
                        Paste the activation code David sends back
                      </label>
                      <textarea
                        id="bex-activation-code"
                        value={activationCode}
                        onChange={(event) => setActivationCode(event.target.value)}
                        maxLength={4096}
                        rows={4}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={isSubmitting}
                        placeholder="BEX-ACT-1…"
                        className="bex-activation-input mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3.5 font-mono text-[13px] leading-5 text-white outline-none transition placeholder:text-slate-700 focus:border-violet-300/45 focus:ring-2 focus:ring-violet-400/10 disabled:opacity-60"
                        data-testid="activation-code-input"
                      />
                    </div>

                    {error && (
                      <div
                        role="alert"
                        className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/[0.07] px-4 py-3 text-sm leading-5 text-rose-100"
                        data-testid="activation-error"
                      >
                        {error}
                        {!requestCode && (
                          <button
                            type="button"
                            onClick={() => setRetryKey((value) => value + 1)}
                            className="ml-2 font-bold text-white underline underline-offset-2"
                          >
                            Try again
                          </button>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting || !activationCode.trim()}
                      className="bex-confirm-button mt-5 flex h-13 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-violet-600 via-violet-500 to-indigo-500 px-5 py-3.5 font-bold text-white shadow-lg shadow-violet-950/40 transition hover:-translate-y-0.5 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-violet-300/70 focus:ring-offset-2 focus:ring-offset-[#0d101a] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
                      data-loading={isSubmitting}
                      data-testid="confirm-activation"
                    >
                      {isSubmitting ? (
                        <>
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          Verifying on this Mac…
                        </>
                      ) : (
                        <>
                          Confirm activation
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>

                    <p className="mt-4 text-center text-xs leading-5 text-slate-500">
                      No email, online account, or Internet connection is required.
                    </p>
                  </form>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
