import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const commentKey = new PluginKey('comments');

export const COMMENT_CLASS = 'bex-comment';
export const COMMENT_ACTIVE_CLASS = 'bex-comment--active';

/**
 * Comments, Notion-style, for the one canonical editor — so they work the same
 * in card descriptions, markdown notes and study notes.
 *
 * The anchor is a mark, which means comments ride along inside the document's
 * own HTML: they survive editing, move with their text, and save through the
 * same `content` string every surface already persists. The body text lives on
 * the mark too, so no surface needs a second field wired up for this to work.
 */

let idCounter = 0;
function newCommentId() {
  idCounter += 1;
  return `cmt-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Every comment in the document, in reading order, merged across split marks. */
export function collectComments(doc) {
  const byId = new Map();
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    node.marks.forEach((mark) => {
      if (mark.type.name !== 'comment' || !mark.attrs.id) return;
      const found = byId.get(mark.attrs.id);
      if (found) {
        // The same comment can span several text nodes once the user styles
        // part of it; keep the outer bounds and the full quote.
        found.from = Math.min(found.from, pos);
        found.to = Math.max(found.to, pos + node.nodeSize);
        found.quote += node.text || '';
      } else {
        byId.set(mark.attrs.id, {
          id: mark.attrs.id,
          text: mark.attrs.text || '',
          createdAt: mark.attrs.createdAt || null,
          quote: node.text || '',
          from: pos,
          to: pos + node.nodeSize,
        });
      }
    });
    return true;
  });
  return Array.from(byId.values()).sort((a, b) => a.from - b.from);
}

export function getCommentState(editorState) {
  return commentKey.getState(editorState) || { activeId: null, draftId: null };
}

export const Comment = Mark.create({
  name: 'comment',

  // Typing right after commented text shouldn't silently join the comment.
  inclusive: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-comment-id': attrs.id } : {}),
      },
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-comment-text') || '',
        renderHTML: (attrs) => (attrs.text ? { 'data-comment-text': attrs.text } : {}),
      },
      createdAt: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-at'),
        renderHTML: (attrs) => (attrs.createdAt ? { 'data-comment-at': attrs.createdAt } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      class: COMMENT_CLASS,
      // Read-only surfaces don't draw the sidebar, so carry the note in a
      // tooltip rather than leaving a highlight with nothing behind it.
      title: mark.attrs.text ? `Comment: ${mark.attrs.text}` : 'Comment',
    }), 0];
  },

  addCommands() {
    return {
      /** Comment the current selection and open it for writing. */
      addComment: () => ({ state, tr, dispatch }) => {
        const { from, to, empty } = state.selection;
        if (empty) return false;
        const id = newCommentId();
        if (dispatch) {
          dispatch(tr
            .addMark(from, to, state.schema.marks.comment.create({
              id,
              text: '',
              createdAt: new Date().toISOString(),
            }))
            .setMeta(commentKey, { activeId: id, draftId: id }));
        }
        return true;
      },

      /** Rewrite a comment's body, across every range that carries it. */
      updateComment: (id, text) => ({ state, tr, dispatch }) => {
        if (!id) return false;
        let touched = false;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return true;
          node.marks.forEach((mark) => {
            if (mark.type.name !== 'comment' || mark.attrs.id !== id) return;
            tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, text }));
            touched = true;
          });
          return true;
        });
        if (touched && dispatch) dispatch(tr.setMeta(commentKey, { draftId: null }));
        return touched;
      },

      /** Drop a comment, leaving the text it was attached to untouched. */
      removeComment: (id) => ({ state, tr, dispatch }) => {
        if (!id) return false;
        let touched = false;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return true;
          node.marks.forEach((mark) => {
            if (mark.type.name !== 'comment' || mark.attrs.id !== id) return;
            tr.removeMark(pos, pos + node.nodeSize, mark);
            touched = true;
          });
          return true;
        });
        if (touched && dispatch) dispatch(tr.setMeta(commentKey, { activeId: null, draftId: null }));
        return touched;
      },

      setActiveComment: (id) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(commentKey, { activeId: id }).setMeta('addToHistory', false));
        return true;
      },

      clearCommentDraft: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(commentKey, { draftId: null }).setMeta('addToHistory', false));
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-m': () => {
        this.editor.commands.addComment();
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extensionEditor = this.editor;

    return [
      new Plugin({
        key: commentKey,

        state: {
          init: () => ({ activeId: null, draftId: null }),
          apply(tr, prev) {
            const meta = tr.getMeta(commentKey);
            if (!meta) return prev;
            return {
              activeId: 'activeId' in meta ? meta.activeId : prev.activeId,
              draftId: 'draftId' in meta ? meta.draftId : prev.draftId,
            };
          },
        },

        props: {
          // The mark paints every comment; this deepens whichever one is in
          // focus so the highlight and its card in the margin read as a pair.
          decorations(state) {
            const { activeId } = commentKey.getState(state) || {};
            if (!activeId) return DecorationSet.empty;
            const decorations = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText) return true;
              if (node.marks.some(m => m.type.name === 'comment' && m.attrs.id === activeId)) {
                decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: COMMENT_ACTIVE_CLASS }));
              }
              return true;
            });
            return DecorationSet.create(state.doc, decorations);
          },

          // Clicking commented text brings its card forward.
          handleClick(view, pos) {
            const mark = view.state.doc.resolve(pos).marks().find(m => m.type.name === 'comment');
            const { activeId } = commentKey.getState(view.state) || {};
            const nextId = mark?.attrs.id || null;
            if (nextId !== activeId) extensionEditor.commands.setActiveComment(nextId);
            return false;
          },
        },
      }),
    ];
  },
});

export default Comment;
