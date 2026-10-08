import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import LogicRichHtml from '../logic/LogicRichHtml';
import RichTextEditor from './RichTextEditor';
import AnnotationPopover from './AnnotationPopover';
import { focusComposer } from './FootnoteComposer';
import { collectTooltips, getTooltipState } from './TooltipExtension';

const COMPOSE_WIDTH = 320;
const VIEW_WIDTH = 300;

/** An editor that only ever held an empty paragraph has nothing worth keeping. */
function isEmptyBody(html) {
  const text = String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length === 0 && !/<(img|table|hr|iframe)/i.test(String(html || ''));
}

/**
 * Everything a tooltip shows: the composer when one is being written, and the
 * popup when a reader presses the text.
 *
 * Both are driven straight off the editor's tooltip plugin state rather than
 * local React state, so undo, a click elsewhere, or the text being deleted all
 * close the panel without needing to be wired up individually.
 */
export default function TooltipLayer({ editor }) {
  const [version, setVersion] = React.useState(0);
  const [draftValue, setDraftValue] = React.useState('');
  const draftIdRef = React.useRef(null);
  /**
   * A draft is answered once and once only.
   *
   * Saving closes the panel, but the panel lives on through its exit animation,
   * and a press anywhere during that window used to reach `cancel` — which,
   * reading the pre-save body, deleted the annotation that had just been
   * written. Recording which draft has already been settled makes the second
   * answer a no-op no matter where it comes from.
   */
  const settledIdRef = React.useRef(null);

  React.useEffect(() => {
    if (!editor) return undefined;
    const bump = () => setVersion(value => value + 1);
    editor.on('transaction', bump);
    return () => { editor.off('transaction', bump); };
  }, [editor]);

  const { activeId, draftId } = editor ? getTooltipState(editor.state) : {};
  const tooltips = React.useMemo(
    () => (editor ? collectTooltips(editor.state.doc) : []),
    // `version` is the subscription: the document is mutable, so it can never
    // be a dependency itself — every transaction bumps this instead.
    [editor, version],
  );

  const draft = draftId ? tooltips.find(item => item.id === draftId) : null;
  const active = !draftId && activeId ? tooltips.find(item => item.id === activeId) : null;

  // Seed the composer once per tooltip, not on every keystroke — reseeding from
  // the mark would fight the user's typing.
  React.useEffect(() => {
    if (!draft) { draftIdRef.current = null; return; }
    if (draftIdRef.current === draft.id) return;
    draftIdRef.current = draft.id;
    settledIdRef.current = null;
    setDraftValue(draft.text || '');
  }, [draft]);

  if (!editor) return null;

  const saveDraft = () => {
    if (!draft || settledIdRef.current === draft.id) return;
    settledIdRef.current = draft.id;
    if (isEmptyBody(draftValue)) editor.commands.removeTooltip(draft.id);
    else editor.commands.updateTooltip(draft.id, draftValue);
    editor.commands.clearTooltipDraft();
    editor.commands.setActiveTooltip(null);
    editor.commands.focus();
  };

  const cancelDraft = () => {
    if (!draft || settledIdRef.current === draft.id) return;
    settledIdRef.current = draft.id;
    // Backing out of a tooltip that was never written removes the mark too,
    // otherwise the text would carry an invisible, empty aside forever.
    if (isEmptyBody(draft.text)) editor.commands.removeTooltip(draft.id);
    editor.commands.clearTooltipDraft();
    editor.commands.setActiveTooltip(null);
    editor.commands.focus();
  };

  return (
    <AnimatePresence>
      {draft && (
        <AnnotationPopover
          key={`tooltip-compose-${draft.id}`}
          editor={editor}
          from={draft.from}
          to={draft.to}
          width={COMPOSE_WIDTH}
          height={200}
          variant="compose"
          testId="tooltip-composer"
          onDismiss={cancelDraft}
        >
          <div className="p-2">
            <div className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-soft">
              Tooltip
            </div>
            <div
              className="rounded-md border border-line bg-[#05070B] px-2 py-1.5 max-h-[240px] overflow-y-auto"
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') { event.preventDefault(); cancelDraft(); }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  saveDraft();
                }
              }}
              data-testid="input-tooltip-text"
            >
              <RichTextEditor
                nested
                bare
                content={draftValue}
                onChange={setDraftValue}
                placeholder="Write a tooltip…"
                onEditorReady={focusComposer}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={cancelDraft}
                className="h-6 w-6 grid place-items-center rounded text-ink-soft hover:bg-white/[0.07] hover:text-white transition-colors"
                title="Cancel (Esc)"
                data-testid="button-tooltip-cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={saveDraft}
                className="h-6 w-6 grid place-items-center rounded bg-violet-600/80 text-white hover:bg-violet-600 active:scale-95 transition-all"
                title="Save (⌘↵)"
                data-testid="button-tooltip-save"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </AnnotationPopover>
      )}

      {active && (
        <AnnotationPopover
          key={`tooltip-view-${active.id}`}
          editor={editor}
          from={active.from}
          to={active.to}
          width={VIEW_WIDTH}
          fitContent
          height={120}
          variant="view"
          testId="tooltip-popup"
          onDismiss={() => editor.commands.setActiveTooltip(null)}
        >
          {/* One row, not three. A short aside is the common case, and stacking
              the controls under a rule turned "testing" into a card three lines
              tall with nothing in two of them. The buttons sit beside the text
              and the card only grows when the writing does. */}
          <div className="flex items-start gap-1.5 px-2.5 py-1.5">
            <div
              className="bex-annotation-body min-w-0 flex-1 max-h-[300px] overflow-y-auto py-0.5 text-[12px] leading-[1.45] text-ink"
              data-testid="text-tooltip-body"
            >
              <LogicRichHtml content={active.text || '<p>Empty tooltip.</p>'} />
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => editor.commands.editTooltip(active.id)}
                className="h-6 w-6 grid place-items-center rounded text-ink-soft hover:bg-white/[0.07] hover:text-white transition-colors"
                title="Edit tooltip"
                data-testid="button-tooltip-edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { editor.commands.removeTooltip(active.id); editor.commands.focus(); }}
                className="h-6 w-6 grid place-items-center rounded text-ink-soft hover:bg-red-900/25 hover:text-red-400 transition-colors"
                title="Delete tooltip"
                data-testid="button-tooltip-delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </AnnotationPopover>
      )}
    </AnimatePresence>
  );
}
