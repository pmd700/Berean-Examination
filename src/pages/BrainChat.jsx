import { motion } from 'framer-motion';
import { Brain, Inbox, Search, ShieldCheck, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import BackToLibraryHomeButton from '@/components/navigation/BackToLibraryHomeButton';

export default function BrainChat() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(124,92,183,0.16),transparent_42%)]"
      />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-6 md:px-10">
        <BackToLibraryHomeButton />
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--accent-violet)]/30 bg-[var(--accent-violet)]/10">
          <Brain className="h-5 w-5 text-[var(--accent-violet)]" />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">Second Brain</p>
          <h1 className="text-base font-semibold">Brain Chat</h1>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-112px)] w-full max-w-6xl place-items-center px-6 pb-24 md:px-10">
        <motion.section
          initial={{ opacity: 0, y: 14, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-2xl rounded-[28px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/90 p-7 shadow-2xl shadow-black/20 backdrop-blur md:p-10"
        >
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-xs font-semibold text-emerald-200">
            <WifiOff className="h-3.5 w-3.5" />
            Online Mode off
          </div>

          <h2 className="max-w-xl text-3xl font-semibold tracking-tight md:text-4xl">
            Brain Chat is resting.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--text-secondary)] md:text-base">
            AI tools are unavailable while BEX is offline. Your private library still works locally and nothing is sent away.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              onClick={() => navigate('/BrainSearch')}
              className="h-12 justify-center gap-2 rounded-xl bg-[var(--accent-violet)] text-white hover:bg-[var(--accent-violet)]/90"
            >
              <Search className="h-4 w-4" />
              Search library
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/BrainInbox')}
              className="h-12 justify-center gap-2 rounded-xl border-[var(--border-subtle)] bg-transparent hover:bg-[var(--bg-elevated)]"
            >
              <Inbox className="h-4 w-4" />
              Open source inbox
            </Button>
          </div>

          <div className="mt-7 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-5 text-xs text-[var(--text-muted)]">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            The AI Spine is safely preserved for a future optional Online Mode.
          </div>
        </motion.section>
      </main>
    </div>
  );
}
