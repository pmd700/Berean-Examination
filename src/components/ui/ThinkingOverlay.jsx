import React from 'react';

export default function ThinkingOverlay({ visible, title = 'Thinking…', subtitle = 'Please wait while the app finishes this task.' }) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 backdrop-blur-md">
      <div className="mx-4 w-full max-w-sm rounded-3xl border border-white/15 bg-slate-950/75 px-8 py-8 text-center shadow-2xl">
        <div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center" role="status" aria-label="Working">
          <div className="relative h-20 w-20 animate-[spin_1.4s_linear_infinite] rounded-full border border-white/10 border-t-[#B99CFF] shadow-[0_0_35px_rgba(124,92,183,0.3)]">
            <div className="absolute inset-3 rounded-full border border-white/10 border-b-[#F3D983]" />
            <div className="absolute inset-7 rounded-full bg-brand-strong shadow-[0_0_18px_rgba(124,92,183,0.7)]" />
          </div>
        </div>
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{subtitle}</p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <span className="h-2 w-2 rounded-full bg-brand-strong animate-pulse" />
          <span className="h-2 w-2 rounded-full bg-brand-strong animate-pulse [animation-delay:200ms]" />
          <span className="h-2 w-2 rounded-full bg-brand-strong animate-pulse [animation-delay:400ms]" />
        </div>
      </div>
    </div>
  );
}
