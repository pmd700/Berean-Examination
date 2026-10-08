import { Mark, mergeAttributes, getTextBetween, getTextSerializersFromSchema } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { expandPointerEcho } from './pointerClipboard';
import { blockDragPluginKey } from './BlockDragExtension';
import { selectedDraggableBlocks } from './blockDragModel';
import { POINTER_MARK, collectPointers, completePointer, newPointerId, rangesOverlap, textRanges, validPointerId } from './pointerModel';

// Code remains plain text; this non-formatting anchor is the only allowed mark.
export const PointerCodeBlock = CodeBlock.extend({ marks: POINTER_MARK });

export const pointerKey = new PluginKey('pointers');
export const getPointerState = state => pointerKey.getState(state);
const hasText = (doc, ranges) => ranges.some(({ from, to }) => doc.textBetween(from, to, '').trim());
const draftDecorations = (doc, ranges) => DecorationSet.create(doc, ranges.map(({ from, to }) => Decoration.inline(from, to, { class: 'bex-pointer-draft' })));

function selectionRanges(state) {
  const selected = blockDragPluginKey.getState(state)?.selected;
  const blocks = selected?.length ? selectedDraggableBlocks(state.doc, selected) : [];
  return textRanges(state.doc, blocks.length
    ? blocks.map(block => ({ from: block.pos, to: block.end }))
    : state.selection.empty ? [] : [{ from: state.selection.from, to: state.selection.to }]);
}

/** Copying a complete connection makes a new one. Partial copies carry just prose. */
export function remapPastedPointers(slice) {
  const complete = collectPointers(slice.content).filter(completePointer);
  const ids = new Map(complete.map(pointer => [pointer.id, newPointerId()]));
  const walk = fragment => Fragment.fromArray(fragment.content.map(node => {
    const marks = node.marks.flatMap(mark => mark.type.name !== POINTER_MARK ? [mark]
      : ids.has(mark.attrs.id) ? [mark.type.create({ ...mark.attrs, id: ids.get(mark.attrs.id) })] : []);
    return (node.isLeaf ? node : node.copy(walk(node.content))).mark(marks);
  }));
  return new Slice(walk(slice.content), slice.openStart, slice.openEnd);
}

export const PointerAnchor = Mark.create({
  name: POINTER_MARK,
  priority: 110,
  inclusive: false,
  // Several pointers may share or overlap an endpoint without replacing each other.
  excludes: '',
  addAttributes() {
    return {
      id: { default: null, parseHTML: el => el.getAttribute('data-pointer-id'), renderHTML: attrs => ({ 'data-pointer-id': attrs.id }) },
      echoCopy: { default: false, parseHTML: el => el.getAttribute('data-pointer-echo') === 'true', renderHTML: attrs => attrs.echoCopy ? { 'data-pointer-echo': 'true' } : {} },
      role: { default: 'source', parseHTML: el => el.getAttribute('data-pointer-role'), renderHTML: attrs => ({ 'data-pointer-role': attrs.role }) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-pointer-id][data-pointer-role]', getAttrs: el =>
      validPointerId(el.getAttribute('data-pointer-id')) && ['source', 'target'].includes(el.getAttribute('data-pointer-role')) ? null : false }];
  },
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'bex-pointer-anchor' }), 0],
  addCommands() {
    const ui = meta => ({ tr, dispatch }) => {
      if (dispatch) dispatch(tr.setMeta(pointerKey, meta).setMeta('addToHistory', false));
      return true;
    };
    return {
      pointerStep: () => ({ state, tr, dispatch }) => {
        if (!this.editor.isEditable) return false;
        const ranges = selectionRanges(state);
        const current = getPointerState(state);
        if (ranges.some(range => !state.doc.resolve(range.from).parent.type.allowsMarkType(this.type))) {
          return ui({ notice: 'This block cannot hold a pointer. Please select another text block.' })({ tr, dispatch });
        }
        if (!hasText(state.doc, ranges)) return ui({ notice: 'Select text or a text block, then press ⌘P.' })({ tr, dispatch });
        const source = current.pending.find().map(({ from, to }) => ({ from, to }));
        if (!source.length) return ui({ pending: ranges, notice: null, activeId: null })({ tr, dispatch });
        if (rangesOverlap(source, ranges)) return ui({ notice: 'Choose different target text, then press ⌘P.' })({ tr, dispatch });
        const existing = current.pointers.find(pointer =>
          JSON.stringify(pointer.source.ranges) === JSON.stringify(source) && JSON.stringify(pointer.target.ranges) === JSON.stringify(ranges));
        if (existing) return ui({ pending: [], activeId: existing.id, notice: 'These texts are already connected.' })({ tr, dispatch });
        if (dispatch) {
          const id = newPointerId();
          for (const [role, spans] of [['source', source], ['target', ranges]]) {
            for (const { from, to } of spans) tr.addMark(from, to, this.type.create({ id, role }));
          }
          dispatch(closeHistory(tr).setMeta(pointerKey, { pending: [], activeId: id, notice: null }));
        }
        return true;
      },
      cancelPointer: () => ui({ pending: [], notice: null, activeId: null }),
      selectPointer: id => ui({ activeId: id, notice: null }),
      togglePointerEcho: id => ({ state, tr, dispatch }) => {
        if (!this.editor.isEditable) return false;
        const pointers = getPointerState(state).pointers;
        const pointer = pointers.find(item => item.id === id);
        if (!pointer) return false;
        const enabled = !pointer.echoCopy;
        // One placeholder can echo only one passage at a time.
        const conflicts = new Set(enabled ? pointers.filter(item => item.id !== id && item.echoCopy
          && rangesOverlap(item.source.ranges, pointer.source.ranges)).map(item => item.id) : []);
        if (dispatch) {
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            node.marks.filter(mark => mark.type === this.type && (mark.attrs.id === id || conflicts.has(mark.attrs.id)))
              .forEach(mark => {
                tr.removeMark(pos, pos + node.nodeSize, mark);
                tr.addMark(pos, pos + node.nodeSize, this.type.create({ ...mark.attrs, echoCopy: mark.attrs.id === id && enabled }));
              });
          });
          dispatch(closeHistory(tr));
        }
        return true;
      },
      removePointer: id => ({ state, tr, dispatch }) => {
        state.doc.descendants((node, pos) => {
          if (!node.isText) return;
          node.marks.filter(mark => mark.type === this.type && mark.attrs.id === id)
            .forEach(mark => tr.removeMark(pos, pos + node.nodeSize, mark));
        });
        if (!tr.docChanged) return false;
        if (dispatch) dispatch(closeHistory(tr).setMeta(pointerKey, { activeId: null }));
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const echoSlices = new WeakSet();
    return [new Plugin({
      key: pointerKey,
      state: {
        init: (_, state) => ({ pointers: collectPointers(state.doc).filter(completePointer), pending: DecorationSet.empty, notice: null, activeId: null }),
        apply(tr, prev) {
          const meta = tr.getMeta(pointerKey) || {};
          const pointers = tr.docChanged ? collectPointers(tr.doc).filter(completePointer) : prev.pointers;
          let pending = 'pending' in meta ? draftDecorations(tr.doc, meta.pending) : prev.pending.map(tr.mapping, tr.doc);
          let notice = 'notice' in meta ? meta.notice : prev.notice;
          if (prev.pending.find().length && !('pending' in meta) && !hasText(tr.doc, pending.find())) {
            pending = DecorationSet.empty;
            notice = 'Pointer cancelled because the source text was removed.';
          }
          const activeId = 'activeId' in meta ? meta.activeId : prev.activeId;
          return { pending, notice, pointers, activeId: pointers.some(pointer => pointer.id === activeId) ? activeId : null };
        },
      },
      appendTransaction(transactions, _old, state) {
        if (!transactions.some(tr => tr.docChanged)) return null;
        const orphanIds = new Set(collectPointers(state.doc).filter(pointer => !completePointer(pointer)).map(pointer => pointer.id));
        if (!orphanIds.size) return null;
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return;
          node.marks.filter(mark => mark.type.name === POINTER_MARK && orphanIds.has(mark.attrs.id))
            .forEach(mark => tr.removeMark(pos, pos + node.nodeSize, mark));
        });
        return tr.docChanged ? tr : null;
      },
      props: {
        decorations: state => getPointerState(state).pending,
        transformPasted: remapPastedPointers,
        transformCopied: (slice, view) => {
          const expanded = expandPointerEcho(slice, view.state.doc);
          if (expanded !== slice) echoSlices.add(expanded);
          return expanded;
        },
        // TipTap's default serializer reads the live selection instead of the
        // transformed slice. Override only Echo copies so both formats agree.
        clipboardTextSerializer: (slice, view) => {
          if (!echoSlices.has(slice)) return undefined;
          const doc = view.state.doc.type.create(null, slice.content);
          return getTextBetween(doc, { from: 0, to: doc.content.size }, {
            textSerializers: getTextSerializersFromSchema(view.state.schema),
          });
        },
        handleKeyDown(_view, event) {
          if (event.isComposing || !editor.isEditable) return false;
          if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
            event.preventDefault();
            if (!event.repeat) editor.commands.pointerStep();
            return true;
          }
          if (event.key === 'Escape') {
            const { pending, activeId, notice } = getPointerState(editor.state);
            if (pending.find().length || activeId || notice) { editor.commands.cancelPointer(); return true; }
          }
          return false;
        },
      },
    })];
  },
});
