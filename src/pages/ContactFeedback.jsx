import React, { useState } from 'react';
import { ArrowLeft, Check, Copy, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';

const CONTACT_EMAIL = 'simonbarjona@atomicmail.io';

export default function ContactFeedback() {
  const [copied, setCopied] = useState(false);

  const openEmail = async () => {
    try {
      const desktop = window.bexDesktop;
      if (desktop?.isDesktop && typeof desktop.openContactEmail === 'function') {
        const result = await desktop.openContactEmail();
        if (!result?.ok) throw new Error(result?.error || 'The email app could not be opened.');
        return;
      }
      window.location.href = `mailto:${CONTACT_EMAIL}?subject=Berean%20Examination%20Feedback`;
    } catch (error) {
      toast.error(error.message || 'The email app could not be opened.');
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('The email address could not be copied.');
    }
  };

  return (
    <div className="min-h-screen bg-app text-white">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-8">
        <Button
          variant="ghost"
          onClick={() => window.history.back()}
          className="mb-16 w-fit text-[#A7AFC0] hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <motion.main
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="my-auto rounded-3xl border border-white/10 bg-surface p-8 text-center shadow-2xl sm:p-10"
        >
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand">
            <Mail className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Email David</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#A7AFC0]">
            Questions, bug reports, and suggestions are welcome.
          </p>

          <div className="mt-8 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-app px-4 py-3">
            <span className="truncate font-mono text-sm text-[#D9DDEA]">{CONTACT_EMAIL}</span>
            <button
              type="button"
              onClick={copyEmail}
              aria-label="Copy email address"
              className="rounded-lg p-2 text-[#A7AFC0] transition hover:bg-white/5 hover:text-white"
            >
              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          <Button
            type="button"
            onClick={openEmail}
            className="mt-5 h-12 w-full bg-brand text-white hover:bg-brand-strong"
          >
            <Mail className="mr-2 h-4 w-4" />
            Open Email App
          </Button>
          <p className="mt-4 text-xs text-[#6F788C]">
            Your email app opens a draft. Nothing is sent until you choose Send.
          </p>
        </motion.main>
      </div>
      <Toaster />
    </div>
  );
}
