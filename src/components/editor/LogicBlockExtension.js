import { Node, mergeAttributes } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { toast } from 'sonner';
import { detectLogicInput, detectLogicSourceFormat } from '@/lib/logic/logic-detector';
import { renderLogicToHtml } from '@/lib/logic/logic-render';
import { editableLogicContent, editableLogicSource } from '@/lib/logic/editable-logic';
import { tokenizeLogic } from '@/lib/logic/logic-tokenizer';

const CONTENT_SELECTOR = '.logic-renderer__content';

function formulaNode(type, source) {
  const { text, presentation } = editableLogicContent(source);
  return type.create({ presentation }, text ? type.schema.text(text) : null);
}

function enclosingFormula($pos, type) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === type) {
      return { node: $pos.node(depth), from: $pos.before(depth), to: $pos.after(depth) };
    }
  }
  return null;
}

export const LogicBlock = Node.create({
  // Keep the persisted name and HTML marker, but not the old atom behavior.
  // Its content is ordinary ProseMirror text: click, drag, highlight, clipboard,
  // deletion and undo all use the global editor, with no source-mode swap.
  name: 'logicBlock',
  group: 'inline',
  inline: true,
  content: 'text*',
  marks: '_',
  selectable: false,

  addAttributes() {
    return {
      presentation: {
        default: 'math',
        parseHTML: element => {
          const stored = element.getAttribute('data-logic-presentation');
          if (stored === 'math' || stored === 'text' || stored === 'boxed-text') return stored;
          return editableLogicContent(element.getAttribute('data-logic-source') || element.textContent || '').presentation;
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-bex-logic][data-logic-editable="true"]',
        contentElement: CONTENT_SELECTOR,
        preserveWhitespace: 'full',
      },
      ...['span[data-bex-logic]', 'div[data-bex-logic]'].map(tag => ({
        tag,
        getContent: (element, schema) => {
          // Import older formulas without copying KaTeX's duplicate HTML and
          // accessibility text. The original source is authoritative on import.
          const source = element.getAttribute('data-logic-source') || element.textContent || '';
          const { text } = editableLogicContent(source);
          return text ? Fragment.from(schema.text(text)) : Fragment.empty;
        },
      })),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const source = editableLogicSource(node.textContent, node.attrs.presentation);
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'logic-renderer logic-renderer--inline logic-renderer--editable',
        'data-bex-logic': 'inline',
        'data-logic-editable': 'true',
        'data-logic-presentation': node.attrs.presentation,
        'data-logic-source': source,
        'data-logic-format': node.attrs.presentation === 'math' ? 'unicode' : 'latex',
      }),
      ['span', { class: 'logic-renderer__content' }, 0],
    ];
  },

  addCommands() {
    return {
      // Only an explicit Cmd+L removes formatting. Clicking never does.
      toggleLogic: () => ({ state, tr, dispatch }) => {
        const type = state.schema.nodes.logicBlock;
        const { selection } = state;
        const current = enclosingFormula(selection.$from, type);
        const unformat = (from, to, node) => {
          if (dispatch) {
            const contentStart = from + 1;
            const start = Math.min(node.content.size, Math.max(0, selection.from - contentStart));
            const end = Math.min(node.content.size, Math.max(start, selection.to - contentStart));
            tr.replaceWith(from, to, node.content);
            tr.setSelection(TextSelection.create(tr.doc, from + start, from + end));
            dispatch(tr);
          }
          return true;
        };

        if (current && selection.to < current.to) return unformat(current.from, current.to, current.node);
        if (selection.node?.type === type) return unformat(selection.from, selection.to, selection.node);

        if (selection.empty) {
          const { $from } = selection;
          if ($from.nodeBefore?.type === type) {
            return unformat($from.pos - $from.nodeBefore.nodeSize, $from.pos, $from.nodeBefore);
          }
          if ($from.nodeAfter?.type === type) {
            return unformat($from.pos, $from.pos + $from.nodeAfter.nodeSize, $from.nodeAfter);
          }
          return false;
        }

        const selected = state.doc.textBetween(selection.from, selection.to, ' ', ' ').trim();
        if (!selected) return false;
        const detected = detectLogicInput(selected);
        const source = detected?.explicit ? detected.source : selected;
        const sourceFormat = detected?.explicit ? detected.sourceFormat : detectLogicSourceFormat(selected);
        const rendered = renderLogicToHtml(source, { sourceFormat });
        if (!rendered.ok) {
          toast.error("BEX couldn't typeset that as LaTeX", { description: rendered.error || undefined });
          return true;
        }

        if (dispatch) {
          dispatch(tr.replaceWith(selection.from, selection.to, formulaNode(type, source)));
        }
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-l': () => {
        this.editor.commands.toggleLogic();
        return true;
      },
      // Enter exits the inline formula and starts the next prose paragraph.
      Enter: () => {
        const { state } = this.editor;
        const formula = enclosingFormula(state.selection.$from, this.type);
        if (!formula) return false;
        return this.editor.chain().setTextSelection(formula.to).splitBlock().run();
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('bexLogicPaste'),
      props: {
        // Typing an existing supported command plus Space inserts its symbol.
        // Normal typing and native IME composition stay with ProseMirror.
        handleTextInput(view, from, to, text) {
          if (text !== ' ' || from !== to) return false;
          const $from = view.state.doc.resolve(from);
          if ($from.parent.type.name !== 'logicBlock') return false;
          const before = $from.parent.textBetween(0, $from.parentOffset);
          const command = /\\[A-Za-z]+$/u.exec(before)?.[0];
          if (!command) return false;
          const [token] = tokenizeLogic(command);
          if (!token || token.value === command) return false;
          view.dispatch(view.state.tr.insertText(token.value, from - command.length, to));
          return true;
        },
        handlePaste(view, event) {
          if (view.state.selection.$from.parent.type.spec.code) return false;
          // Let the normal HTML clipboard pipeline retain per-character marks.
          if (event.clipboardData?.getData('text/html')?.includes('data-logic-editable')) return false;
          const text = event.clipboardData?.getData('text/plain') || '';
          const detected = detectLogicInput(text);
          const { selection, schema } = view.state;
          const insideFormula = selection.$from.parent.type.name === 'logicBlock';
          if (!insideFormula && !detected?.explicit) return false;
          const source = detected?.explicit ? detected.source : text;
          if (!source) return false;

          event.preventDefault();
          if (insideFormula) {
            // Insert characters, never a nested formula inside a formula.
            view.dispatch(view.state.tr.insertText(editableLogicContent(source).text).scrollIntoView());
          } else {
            view.dispatch(view.state.tr.replaceSelectionWith(formulaNode(schema.nodes.logicBlock, source), false).scrollIntoView());
          }
          return true;
        },
      },
    })];
  },
});

export default LogicBlock;
