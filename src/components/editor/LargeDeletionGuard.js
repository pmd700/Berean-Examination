import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { confirmDialog } from '@/components/ui/confirm-dialog';

export const LARGE_DELETION_THRESHOLD = 5000;

export const LargeDeletionGuard = Extension.create({
  name: 'largeDeletionGuard',
  priority: 10000,
  addOptions() {
    return { confirm: confirmDialog };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const ask = this.options.confirm;
    let pending = false;
    return [new Plugin({
      key: new PluginKey('largeDeletionGuard'),
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
          if (event.isComposing) return false;
          if (pending) return true;
          const { doc, selection } = view.state;
          if (selection.empty) return false;
          // Count the model, not visible DOM: collapsed toggle bodies are included.
          const characters = Array.from(doc.textBetween(selection.from, selection.to, '', '')).length;
          if (characters <= LARGE_DELETION_THRESHOLD) return false;
          event.preventDefault();
          pending = true;
          const originalSelection = selection.toJSON();
          Promise.resolve(ask({
            title: 'Delete selected note content?',
            description: `This removes ${characters.toLocaleString()} characters, including text inside collapsed dropdowns. The note itself will remain.`,
            confirmText: 'Delete content',
            confirmDelaySeconds: 5,
            cancelText: 'Keep',
            tone: 'danger',
          })).then(confirmed => {
            // Never apply a stale selection to content changed while the dialog was open.
            if (editor.isDestroyed || !view.state.doc.eq(doc)) return;
            const tr = view.state.tr.setSelection(Selection.fromJSON(view.state.doc, originalSelection));
            if (confirmed) tr.deleteSelection();
            view.dispatch(tr.scrollIntoView());
            view.focus();
          }).catch(() => {
            // A failed dialog must leave the note untouched.
          }).finally(() => { pending = false; });
          return true;
        },
      },
    })];
  },
});
