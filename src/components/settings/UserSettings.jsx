import React, { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAnnotationDisplayPreference } from '@/lib/annotationDisplayPreference';

function Preferences() {
  const { style, saveStyle, loading, error: readError } = useAnnotationDisplayPreference();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const choose = async value => {
    if (saving || value === style) return;
    setSaving(true); setError(''); setSaved(false);
    try { await saveStyle(value); setSaved(true); }
    catch (err) { setError(err.message || 'Your preference could not be saved. Please try again.'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-4">
    <fieldset disabled={loading || saving || Boolean(readError)} className="space-y-3">
      <legend className="mb-2 text-sm font-semibold text-ink">Scripture annotations</legend>
      {[
        ['gutter', 'Gutter cards', 'Keep commentary visible beside the Scripture. Drag the green dot to arrange each purple connector.'],
        ['hover', 'Underline & hover', 'Use the original style: hover over annotated text to read its commentary.'],
      ].map(([value, label, description]) => <label key={value}
        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${style === value ? 'border-brand/60 bg-brand/10' : 'border-line bg-surface'}`}>
        <input type="radio" name="annotation-display" value={value} checked={style === value} onChange={() => choose(value)} className="mt-1 accent-brand" />
        <span><span className="block text-sm font-medium text-ink">{label}{value === 'gutter' && <span className="ml-2 text-xs text-brand">Default</span>}</span>
          <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{description}</span></span>
      </label>)}
    </fieldset>
    {(error || readError) && <p role="alert" className="text-sm text-rose-400">{error || readError}</p>}
    <p role="status" aria-live="polite" className="text-xs text-ink-muted">{loading ? 'Loading preferences…' : saving ? 'Saving…' : saved ? 'Saved locally.' : 'Your annotations stay the same when you switch styles.'}</p>
  </div>;
}

// Home owns the only entry point; no account/authentication UI or global nav.
export default function UserSettings({ active = true }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  return <>
    <button type="button" onClick={() => setOpen(true)} title="User settings" aria-label="Open user settings"
      data-testid="home-user-settings" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-violet-300">
      <Settings2 className="h-4 w-4" />
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg border-line bg-surface text-ink">
        <DialogHeader><DialogTitle>User settings</DialogTitle><DialogDescription>Personalize your local BEX library.</DialogDescription></DialogHeader>
        {open && <Preferences />}
      </DialogContent>
    </Dialog>
  </>;
}
