import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import RichTextEditor from './RichTextEditor';
import AnnotationPopover from './AnnotationPopover';
import { collectFootnotes, getFootnoteState } from './FootnoteExtension';

const COMPOSE_WIDTH = 340;

/**
 * Put the caret in the panel the moment it opens.
 *
 * The composer is raised by a keystroke, so the keys that follow have to land in
 * it — without this they go straight back into the page behind it. The focus
 * command only moves the editor's selection and defers its own DOM focusing, so
 * the element is focused explicitly as well, the same way the note title hands
 * the caret to the body on Enter.
 */
export function focusComposer(instance) {
  if (!instance) return;
  instance.commands.focus('end');
  instance.view.dom.focus();
}

function isEmptyBody(html) {
  const text = String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length === 0;
}

/**
 * The panel you type a footnote into.
 *
 * Unlike a tooltip there is no read popup to write: a footnote's whole point is
 * that it is already printed at the foot of the page. This only handles writing
 * one — raised fresh with ⌘⇧F, or reopened from the footer.
 *
 * The editor here is deliberately restricted to plain formatting: a footnote is
 * a citation or an aside, not a place for tables, images or embeds.
 */
export default function FootnoteComposer({ editor }) {
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

  const { draftId, offset } = editor ? getFootnoteState(editor.state) : {};
  const footnotes = React.useMemo(
    // `version` stands in for the mutable document; see TooltipLayer.
    () => (editor ? collectFootnotes(editor.state.doc, offset || 0) : []),
    [editor, version, offset],
  );

  const draft = draftId ? footnotes.find(item => item.id === draftId) : null;

  React.useEffect(() => {
    if (!draft) { draftIdRef.current = null; return; }
    if (draftIdRef.current === draft.id) return;
    draftIdRef.current = draft.id;
    settledIdRef.current = null;
    setDraftValue(draft.text || '');
  }, [draft]);

  if (!editor || !draft) return <AnimatePresence />;

  const save = () => {
    if (settledIdRef.current === draft.id) return;
    settledIdRef.current = draft.id;
    if (isEmptyBody(draftValue)) {
      // An unwritten footnote leaves a numbered marker pointing at nothing, so
      // saving an empty one removes the reference instead.
      editor.commands.removeFootnote(draft.id);
    } else {
      editor.commands.updateFootnote(draft.id, draftValue);
    }
    editor.commands.clearFootnoteDraft();
    editor.commands.focus();
  };

  const cancel = () => {
    if (settledIdRef.current === draft.id) return;
    settledIdRef.current = draft.id;
    if (isEmptyBody(draft.text)) editor.commands.removeFootnote(draft.id);
    editor.commands.clearFootnoteDraft();
    editor.commands.focus();
  };

  return (
    <AnimatePresence>
      <AnnotationPopover
        key={`footnote-compose-${draft.id}`}
        editor={editor}
        from={draft.pos}
        to={draft.pos + 1}
        width={COMPOSE_WIDTH}
        height={200}
        variant="compose"
        testId="footnote-composer"
        onDismiss={cancel}
      >
        <div className="p-2">
          <div className="flex items-center gap-1.5 px-1 pb-1.5">
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-violet-600/25 px-1 text-[10px] font-semibold text-violet-200">
              {draft.number}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-ink-soft">
              Footnote
            </span>
          </div>
          <div
            className="rounded-md border border-line bg-[#05070B] px-2 py-1.5 max-h-[240px] overflow-y-auto"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') { event.preventDefault(); cancel(); }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                save();
              }
            }}
            data-testid="input-footnote-text"
          >
            <RichTextEditor
              nested
              bare
              plainFormatting
              content={draftValue}
              onChange={setDraftValue}
              placeholder="Write a footnote…"
              onEditorReady={focusComposer}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={cancel}
              className="h-6 w-6 grid place-items-center rounded text-ink-soft hover:bg-white/[0.07] hover:text-white transition-colors"
              title="Cancel (Esc)"
              data-testid="button-footnote-cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={save}
              className="h-6 w-6 grid place-items-center rounded bg-violet-600/80 text-white hover:bg-violet-600 active:scale-95 transition-all"
              title="Save (⌘↵)"
              data-testid="button-footnote-save"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </AnnotationPopover>
    </AnimatePresence>
  );
}
