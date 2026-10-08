import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';

/**
 * A background colour on table cells, which the grip menu's "Color" sets.
 *
 * The stock cell carries only `colwidth`, so the colour needs its own attribute
 * and its own round trip through HTML — notes are stored as HTML, and an
 * attribute that does not survive parsing is a colour that vanishes the next
 * time the note is opened.
 *
 * The value is written as an inline style rather than a class so the read-only
 * card preview, the exports and the editor all render it without needing to
 * know this extension exists.
 */

export const CELL_COLORS = Object.freeze([
  { id: 'default', label: 'Default', value: null },
  { id: 'grey', label: 'Grey', value: 'rgba(148, 163, 184, 0.16)' },
  { id: 'brown', label: 'Brown', value: 'rgba(146, 92, 47, 0.24)' },
  { id: 'orange', label: 'Orange', value: 'rgba(234, 122, 46, 0.20)' },
  { id: 'yellow', label: 'Yellow', value: 'rgba(229, 189, 72, 0.20)' },
  { id: 'green', label: 'Green', value: 'rgba(52, 168, 111, 0.20)' },
  { id: 'blue', label: 'Blue', value: 'rgba(56, 132, 233, 0.20)' },
  { id: 'purple', label: 'Purple', value: 'rgba(139, 92, 246, 0.22)' },
  { id: 'pink', label: 'Pink', value: 'rgba(226, 96, 160, 0.20)' },
  { id: 'red', label: 'Red', value: 'rgba(225, 76, 76, 0.20)' },
]);

const backgroundAttribute = {
  backgroundColor: {
    default: null,
    parseHTML: (element) => element.getAttribute('data-cell-color') || null,
    renderHTML: (attributes) => {
      if (!attributes.backgroundColor) return {};
      return {
        // Both: the attribute is what parses back, the style is what renders
        // everywhere the editor is not running.
        'data-cell-color': attributes.backgroundColor,
        style: `background-color: ${attributes.backgroundColor}`,
      };
    },
  },
};

export const TableCellWithBackground = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundAttribute };
  },
});

export const TableHeaderWithBackground = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundAttribute };
  },
});
