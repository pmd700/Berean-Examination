import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Coloured text highlighting.
 *
 * Written here rather than pulled from @tiptap/extension-highlight because the
 * colour has to survive a round trip through saved HTML — notes are stored as
 * HTML, so a colour that does not parse back is a colour that vanishes the next
 * time the note is opened. The value is written BOTH as a data attribute (what
 * parses back) and as an inline style (what renders everywhere the editor is
 * not running: the read-only card preview, exports, print).
 */

export const HIGHLIGHT_MENU_EVENT = 'bex-highlight-menu';

export const HIGHLIGHT_COLORS = Object.freeze([
  { id: 'yellow', label: 'Yellow', value: 'rgba(234, 179, 8, 0.38)' },
  { id: 'orange', label: 'Orange', value: 'rgba(234, 122, 46, 0.38)' },
  { id: 'red', label: 'Red', value: 'rgba(225, 76, 76, 0.34)' },
  { id: 'pink', label: 'Pink', value: 'rgba(226, 96, 160, 0.34)' },
  { id: 'purple', label: 'Purple', value: 'rgba(139, 92, 246, 0.40)' },
  { id: 'blue', label: 'Blue', value: 'rgba(56, 132, 233, 0.36)' },
  { id: 'teal', label: 'Teal', value: 'rgba(45, 212, 191, 0.30)' },
  { id: 'green', label: 'Green', value: 'rgba(52, 168, 111, 0.34)' },
  { id: 'grey', label: 'Grey', value: 'rgba(148, 163, 184, 0.30)' },
]);

export const DEFAULT_HIGHLIGHT = HIGHLIGHT_COLORS[0].value;

export const Highlight = Mark.create({
  name: 'highlight',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      color: {
        default: DEFAULT_HIGHLIGHT,
        parseHTML: (element) => element.getAttribute('data-highlight') || DEFAULT_HIGHLIGHT,
        renderHTML: (attributes) => ({
          'data-highlight': attributes.color,
          // Browsers give <mark> elements a black foreground by default. Keep
          // the surrounding editor text colour so highlighting only paints the
          // background and white text remains white in the dark editor.
          style: `background-color: ${attributes.color}; color: inherit`,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setHighlight: (color) => ({ commands }) => commands.setMark(this.name, { color: color || DEFAULT_HIGHLIGHT }),
      unsetHighlight: () => ({ commands }) => commands.unsetMark(this.name),
      toggleHighlight: (color) => ({ commands }) => commands.toggleMark(this.name, { color: color || DEFAULT_HIGHLIGHT }),
    };
  },

  addKeyboardShortcuts() {
    const askForColour = () => {
      const { state, view } = this.editor;
      // Highlighting nothing is nothing: with an empty caret there is no text
      // to colour, so the menu would be asking about a selection that isn't.
      if (state.selection.empty) return false;

      view.dom.dispatchEvent(new CustomEvent(HIGHLIGHT_MENU_EVENT, { bubbles: true }));
      return true;
    };

    return {
      // Cmd+S is the browser's "save page" and Cmd+H is macOS's "hide
      // application"; returning true is what stops both from happening.
      'Mod-s': () => this.editor.commands.toggleStrike(),
      'Mod-h': askForColour,
      // A fallback that no operating system has already claimed — see the note
      // in the README of this feature: on macOS the App menu takes Cmd+H before
      // the page ever sees it.
      'Mod-Shift-h': askForColour,
    };
  },
});

export default Highlight;
