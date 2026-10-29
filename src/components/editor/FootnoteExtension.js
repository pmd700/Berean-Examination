import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const footnoteKey = new PluginKey('footnotes');

export const FOOTNOTE_CLASS = 'bex-footnote';
export const FOOTNOTE_ACTIVE_CLASS = 'bex-footnote--active';

/** Clicking a superscript: the page that owns the footer does the scrolling. */
export const FOOTNOTE_JUMP_EVENT = 'bex:footnote-jump';

/** A footnote was started or reopened and wants its composer on screen. */
export const FOOTNOTE_DRAFT_EVENT = 'bex:footnote-draft';

/**
 * Footnotes for long-form notes — numbered references that live in the text and
 * read out at the foot of the page.
 *
 * The reference is an inline atom node carrying its own body, so a footnote
 * travels with the sentence it belongs to: cut and paste the paragraph and the
 * note comes along, undo and it comes back, and the whole thing saves through
 * the same `content` string a note already persists.
 *
 * Numbers are never stored. They are derived from document order on every
 * transaction and painted on by a decoration, which is what makes deleting
 * footnote 2 renumber 3, 4 and 5 without touching the document. A page that
 * opens partway through a book is told how many footnotes precede it, so the
 * count runs continuously across the whole book the way a printed one does.
 */

let idCounter = 0;
function newFootnoteId() {
  idCounter += 1;
  return `fn-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Every footnote in a page, in reading order, already numbered. */
export function collectFootnotes(doc, offset = 0) {
  const found = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'footnote') return true;
    found.push({
      id: node.attrs.id,
      text: node.attrs.text || '',
      pos,
      number: offset + found.length + 1,
    });
    return true;
  });
  return found;
}

export function getFootnoteState(editorState) {
  return footnoteKey.getState(editorState) || { activeId: null, draftId: null, offset: 0 };
}

export const Footnote = Node.create({
  name: 'footnote',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-footnote-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-footnote-id': attrs.id } : {}),
      },
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-footnote-text') || '',
        renderHTML: (attrs) => (attrs.text ? { 'data-footnote-text': attrs.text } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // No text content: the visible digit is painted by the numbering decoration
    // in the editor, and by the exporter everywhere else. Storing the number
    // would only give us a second copy to keep correct.
    return ['sup', mergeAttributes(HTMLAttributes, {
      class: FOOTNOTE_CLASS,
      role: 'doc-noteref',
    })];
  },

  addCommands() {
    return {
      /** Drop a footnote reference at the caret and open it for writing. */
      addFootnote: () => ({ state, tr, dispatch }) => {
        const id = newFootnoteId();
        const node = state.schema.nodes.footnote.create({ id, text: '' });
        if (dispatch) {
          // Land after the selection so a footnote raised on a highlighted
          // phrase attaches to its end rather than replacing it.
          const at = state.selection.to;
          dispatch(tr
            .insert(at, node)
            .setMeta(footnoteKey, { activeId: id, draftId: id, editId: null }));
        }
        return true;
      },

      /** Rewrite a footnote's body. */
      updateFootnote: (id, text) => ({ state, tr, dispatch }) => {
        if (!id) return false;
        let touched = false;
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'footnote' || node.attrs.id !== id) return true;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, text });
          touched = true;
          return true;
        });
        if (touched && dispatch) dispatch(tr.setMeta(footnoteKey, { draftId: null }));
        return touched;
      },

      /** Remove a footnote reference and, with it, the note at the foot. */
      removeFootnote: (id) => ({ state, tr, dispatch }) => {
        if (!id) return false;
        const doomed = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'footnote' && node.attrs.id === id) doomed.push(pos);
          return true;
        });
        if (doomed.length === 0) return false;
        if (dispatch) {
          // Back to front: deleting shifts every position after it.
          doomed.reverse().forEach((pos) => { tr.delete(pos, pos + 1); });
          dispatch(tr.setMeta(footnoteKey, { activeId: null, draftId: null, editId: null }));
        }
        return true;
      },

      setActiveFootnote: (id) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(footnoteKey, { activeId: id }).setMeta('addToHistory', false));
        return true;
      },

      /** Edit an existing body in place at the foot of the page. */
      editFootnote: (id) => ({ tr, dispatch }) => {
        if (!id) return false;
        if (dispatch) {
          dispatch(tr.setMeta(footnoteKey, { activeId: id, draftId: null, editId: id }).setMeta('addToHistory', false));
        }
        return true;
      },

      clearFootnoteDraft: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(footnoteKey, { draftId: null }).setMeta('addToHistory', false));
        return true;
      },

      finishFootnoteEdit: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(footnoteKey, { editId: null }).setMeta('addToHistory', false));
        return true;
      },

      /**
       * How many footnotes precede this page. Set by the book so numbering
       * continues across pages instead of restarting on each one.
       */
      setFootnoteOffset: (offset) => ({ state, tr, dispatch }) => {
        const next = Math.max(0, Math.floor(Number(offset) || 0));
        if (getFootnoteState(state).offset === next) return false;
        if (dispatch) {
          dispatch(tr.setMeta(footnoteKey, { offset: next }).setMeta('addToHistory', false));
        }
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-f': () => this.editor.commands.addFootnote(),
    };
  },

  addProseMirrorPlugins() {
    const extensionEditor = this.editor;

    return [
      new Plugin({
        key: footnoteKey,

        state: {
          init: () => ({ activeId: null, draftId: null, editId: null, offset: 0 }),
          apply(tr, prev) {
            const meta = tr.getMeta(footnoteKey);
            if (!meta) return prev;
            return {
              activeId: 'activeId' in meta ? meta.activeId : prev.activeId,
              draftId: 'draftId' in meta ? meta.draftId : prev.draftId,
              editId: 'editId' in meta ? meta.editId : prev.editId,
              offset: 'offset' in meta ? meta.offset : prev.offset,
            };
          },
        },

        view() {
          return {
            update(view, prevState) {
              const before = footnoteKey.getState(prevState)?.draftId || null;
              const after = footnoteKey.getState(view.state)?.draftId || null;
              if (before === after || !after) return;
              view.dom.dispatchEvent(new CustomEvent(FOOTNOTE_DRAFT_EVENT, {
                bubbles: false,
                detail: { id: after },
              }));
            },
          };
        },

        props: {
          // The number, applied on every transaction rather than stored. This is
          // the only place a footnote's ordinal exists inside the editor.
          decorations(state) {
            const { activeId, offset } = footnoteKey.getState(state) || {};
            const decorations = [];
            let index = 0;
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'footnote') return true;
              index += 1;
              const attrs = { 'data-footnote-number': String((offset || 0) + index) };
              if (activeId && node.attrs.id === activeId) attrs.class = FOOTNOTE_ACTIVE_CLASS;
              decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs));
              return true;
            });
            return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
          },

          // Pressing a reference sends the reader to the note at the foot of
          // the page. The page owns that scroll, so this only announces it.
          handleClickOn(view, _pos, node, nodePos, event, direct) {
            if (!direct || node.type.name !== 'footnote') return false;
            event.preventDefault();
            const id = node.attrs.id;
            extensionEditor.commands.setActiveFootnote(id);
            view.dom.dispatchEvent(new CustomEvent(FOOTNOTE_JUMP_EVENT, {
              bubbles: false,
              detail: { id, pos: nodePos },
            }));
            return true;
          },
        },
      }),
    ];
  },
});

export default Footnote;
