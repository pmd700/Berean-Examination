import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';

export default function BackToMenu() {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  return <button type="button" aria-label="Back to menu" title="Back to main menu" disabled={busy} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-50" onClick={async () => {
    if (busy) return;
    setBusy(true);
    try { await flushPendingEditorSaves(); navigate('/LibraryHome'); }
    catch (error) { toast.error(error?.message || 'Could not save your work. Please retry before leaving.'); }
    finally { setBusy(false); }
  }}><ArrowLeft className="h-3.5 w-3.5" />{busy ? 'Saving…' : 'Back to menu'}</button>;
}
