import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { History, Save } from 'lucide-react';

// One-time explainer shown the first time a user clicks "Add to Version
// History". This is *deliberately* separate from the live autosave path so
// users understand that nothing they're doing right now is being lost — the
// version-history button is a manual "save a snapshot I can roll back to"
// action that should be used sparingly because each snapshot stores the
// full web payload.
export default function VersionHistoryIntroDialog({ open, onConfirm, onCancel }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel?.(); }}>
      <DialogContent
        className="sm:max-w-md bg-[#0F1218] border border-line text-gray-100"
        data-testid="dialog-version-history-intro"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="w-4 h-4 text-brand-strong" />
            About Version History
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
          <p>
            <span className="text-gray-100 font-semibold">This is separate from autosave.</span>
            {' '}Your work is already being saved automatically as you go — you do
            not need to click this button to keep your changes.
          </p>
          <p>
            "Add to Version History" creates a manual snapshot of your entire
            knowledge web that you can return to later, like a save point.
          </p>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-200/90 text-xs">
            We don&apos;t recommend clicking it often — each snapshot stores a
            full copy of the web and can take a meaningful amount of space over
            time. Use it for milestones, not for every small change.
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-200"
            data-testid="button-version-intro-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            className="bg-brand hover:bg-brand-strong text-white"
            data-testid="button-version-intro-confirm"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            Got it, save a version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
