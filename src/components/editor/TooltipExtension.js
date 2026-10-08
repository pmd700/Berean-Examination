import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const tooltipKey = new PluginKey('tooltips');

export const TOOLTIP_CLASS = 'bex-tooltip';

/** The ⓘ that marks a tooltip and opens it. */
export const TOOLTIP_BADGE_CLASS = 'bex-tooltip-badge';

/** A tooltip was raised or reopened and wants its composer on screen. */
export const TOOLTIP_DRAFT_EVENT = 'bex:tooltip-draft';

/** Tooltipped text was pressed; the popover should open over it. */
export const TOOLTIP_OPEN_EVENT = 'bex:tooltip-open';

/**
 * Tooltips — an aside attached to a phrase, marked by an ⓘ rather than by
 * disturbing the writing.
 *
 * Mechanically this is close to a comment: a mark that carries its own body, so
 * the aside rides inside the document's HTML and needs no second field to
 * persist. The difference is one of presentation, and it is the point of the
 * feature. A comment tints its words, underlines them, and draws a card in the
 * margin, so the whole zone it covers is spelled out on the page. A tooltip
 * leaves the prose itself completely untouched — no wash, no rule, no zone —
 * and puts a single small ⓘ at the end of the phrase instead.
 *
 * The badge is the affordance: it is visible at rest and opens the aside when
 * pressed. Nothing about this depends on hovering.
 */

let idCounter = 0;
function newTooltipId() {
  idCounter += 1;
  return `tip-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Every tooltip in the document, in reading order, merged across split marks. */
export function collectTooltips(doc) {
  const byId = new Map();
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    node.marks.forEach((mark) => {
      if (mark.type.name !== 'tooltip' || !mark.attrs.id) return;
      const found = byId.get(mark.attrs.id);
      if (found) {
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

export function getTooltipState(editorState) {
  return tooltipKey.getState(editorState) || { activeId: null, draftId: null };
}

/** The tooltip covering a position, if there is one. */
export function tooltipAt(state, pos) {
  return state.doc.resolve(pos).marks().find(mark => mark.type.name === 'tooltip') || null;
}

/** The first tooltip anywhere inside a range, if there is one. */
export function tooltipIdInRange(doc, from, to) {
  let found = null;
  doc.nodesBetween(from, to, (node) => {
    if (found || !node.isText) return true;
    const mark = node.marks.find(item => item.type.name === 'tooltip');
    if (mark?.attrs.id) found = mark.attrs.id;
    return true;
  });
  return found;
}

/**
 * Build the badge, with its own press handling.
 *
 * A widget lives outside the document, so ProseMirror's own click handling never
 * sees it — the element has to listen for itself. mousedown is swallowed so the
 * press does not first move the caret and collapse the selection behind it.
 */
function badgeElement(editor, id, isActive) {
  const badge = document.createElement('span');
  badge.className = isActive ? `${TOOLTIP_BADGE_CLASS} ${TOOLTIP_BADGE_CLASS}--active` : TOOLTIP_BADGE_CLASS;
  badge.setAttribute('data-tooltip-badge', id);
  badge.setAttribute('role', 'button');
  badge.setAttribute('aria-label', 'Open tooltip');
  badge.setAttribute('contenteditable', 'false');

  badge.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  badge.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    editor.commands.setActiveTooltip(id);
    editor.view.dom.dispatchEvent(new CustomEvent(TOOLTIP_OPEN_EVENT, {
      bubbles: false,
      detail: { id },
    }));
  });

  return badge;
}

export const Tooltip = Mark.create({
  name: 'tooltip',

  // Typing on from tooltipped text shouldn't silently extend the tooltip.
  inclusive: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-tooltip-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-tooltip-id': attrs.id } : {}),
      },
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-tooltip-text') || '',
        renderHTML: (attrs) => (attrs.text ? { 'data-tooltip-text': attrs.text } : {}),
      },
      createdAt: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-tooltip-at'),
        renderHTML: (attrs) => (attrs.createdAt ? { 'data-tooltip-at': attrs.createdAt } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-tooltip-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: TOOLTIP_CLASS }), 0];
  },

  addCommands() {
    return {
      /** Attach a tooltip to the selection and open it for writing. */
      addTooltip: () => ({ state, tr, dispatch }) => {
        const { from, to, empty } = state.selection;
        if (empty) return false;
        // Writing over an existing tooltip should reopen it, not stack a second
        // one on the same words. This scans the selection rather than resolving
        // its start: a position's marks are the ones on the character *before*
        // it, so selecting a tooltipped phrase reports the marks of whatever
        // precedes it — usually a space carrying nothing at all.
        const existingId = tooltipIdInRange(state.doc, from, to);
        if (existingId) {
          if (dispatch) {
            dispatch(tr.setMeta(tooltipKey, { activeId: existingId, draftId: existingId })
              .setMeta('addToHistory', false));
          }
          return true;
        }
        const id = newTooltipId();
        if (dispatch) {
          dispatch(tr
            .addMark(from, to, state.schema.marks.tooltip.create({
              id,
              text: '',
              createdAt: new Date().toISOString(),
            }))
            .setMeta(tooltipKey, { activeId: id, draftId: id }));
        }
        return true;
      },

      updateTooltip: (id, text) => ({ state, tr, dispatch }) => {
        if (!id) return false;
        let touched = false;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return true;
          node.marks.forEach((mark) => {
            if (mark.type.name !== 'tooltip' || mark.attrs.id !== id) return;
            tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, text }));
            touched = true;
          });
          return true;
        });
        if (touched && dispatch) dispatch(tr.setMeta(tooltipKey, { draftId: null }));
        return touched;
      },

      /** Drop a tooltip, leaving the words it was attached to untouched. */
      removeTooltip: (id) => ({ state, tr, dispatch }) => {
        if (!id) return false;
        let touched = false;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return true;
          node.marks.forEach((mark) => {
            if (mark.type.name !== 'tooltip' || mark.attrs.id !== id) return;
            tr.removeMark(pos, pos + node.nodeSize, mark);
            touched = true;
          });
          return true;
        });
        if (touched && dispatch) dispatch(tr.setMeta(tooltipKey, { activeId: null, draftId: null }));
        return touched;
      },

      setActiveTooltip: (id) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(tooltipKey, { activeId: id }).setMeta('addToHistory', false));
        return true;
      },

      editTooltip: (id) => ({ tr, dispatch }) => {
        if (!id) return false;
        if (dispatch) {
          dispatch(tr.setMeta(tooltipKey, { activeId: id, draftId: id }).setMeta('addToHistory', false));
        }
        return true;
      },

      clearTooltipDraft: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(tooltipKey, { draftId: null }).setMeta('addToHistory', false));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extensionEditor = this.editor;

    return [
      new Plugin({
        key: tooltipKey,

        state: {
          init: () => ({ activeId: null, draftId: null }),
          apply(tr, prev) {
            const meta = tr.getMeta(tooltipKey);
            if (!meta) return prev;
            return {
              activeId: 'activeId' in meta ? meta.activeId : prev.activeId,
              draftId: 'draftId' in meta ? meta.draftId : prev.draftId,
            };
          },
        },

        view() {
          return {
            update(view, prevState) {
              const before = tooltipKey.getState(prevState)?.draftId || null;
              const after = tooltipKey.getState(view.state)?.draftId || null;
              if (before === after || !after) return;
              view.dom.dispatchEvent(new CustomEvent(TOOLTIP_DRAFT_EVENT, {
                bubbles: false,
                detail: { id: after },
              }));
            },
          };
        },

        props: {
          /**
           * One ⓘ per tooltip, sitting at the end of the phrase it belongs to.
           *
           * A widget rather than part of the mark: a mark that straddles a bold
           * word is rendered as several spans, and drawing the badge from the
           * mark itself would put one after each of them. The widget is placed
           * from the merged range instead, so a tooltip always shows exactly one.
           */
          decorations(state) {
            const tooltips = collectTooltips(state.doc);
            if (tooltips.length === 0) return DecorationSet.empty;
            const { activeId } = tooltipKey.getState(state) || {};

            return DecorationSet.create(state.doc, tooltips.map(tooltip => Decoration.widget(
              tooltip.to,
              () => badgeElement(extensionEditor, tooltip.id, tooltip.id === activeId),
              // side 1 keeps the badge after the last character rather than
              // letting the caret land between the text and its own marker.
              { side: 1, key: `tooltip-badge-${tooltip.id}-${tooltip.id === activeId}` },
            )));
          },

          // Pressing the phrase opens its aside too — the badge is the marker,
          // not the only target.
          handleClick(view, pos, event) {
            const mark = tooltipAt(view.state, pos);
            if (!mark?.attrs.id) {
              if (getTooltipState(view.state).activeId) extensionEditor.commands.setActiveTooltip(null);
              return false;
            }
            event.preventDefault();
            extensionEditor.commands.setActiveTooltip(mark.attrs.id);
            view.dom.dispatchEvent(new CustomEvent(TOOLTIP_OPEN_EVENT, {
              bubbles: false,
              detail: { id: mark.attrs.id, pos },
            }));
            return true;
          },
        },
      }),
    ];
  },
});

export default Tooltip;
