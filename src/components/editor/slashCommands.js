import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { CalendarRange, File, Image as ImageIcon, Link2, Quote } from 'lucide-react';

export const slashCommandKey = new PluginKey('slashCommands');

/**
 * The editor's slash-command registry.
 *
 * Type "/" at the start of a word and this list becomes a filtered menu. To
 * add a command, add an entry here — the menu, its filtering and its keyboard
 * handling all read from this array, so nothing else needs to change.
 *
 *   id        stable key
 *   label     what the menu row reads
 *   hint      one line of detail under the label
 *   keywords  extra words that should match the typed query
 *   Icon      lucide icon for the row
 *   run       ({ editor, range }) — `range` covers the typed "/command" text,
 *             so a command normally deletes it before doing its work
 */
export const SLASH_COMMANDS = [
  {
    id: 'link',
    label: 'Link',
    hint: 'Link a note, knowledge web, or timeline',
    keywords: ['link', 'library', 'note', 'web', 'reference'],
    Icon: Link2,
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      openSlashPanel(editor, 'link');
    },
  },
  {
    id: 'image',
    label: 'Image',
    hint: 'Upload a file or embed a link',
    keywords: ['image', 'img', 'picture', 'photo', 'upload', 'embed'],
    Icon: ImageIcon,
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      openSlashPanel(editor, 'image');
    },
  },
  {
    id: 'file',
    label: 'File',
    hint: 'Attach a PDF, audio, video, or other file',
    keywords: ['file', 'attachment', 'pdf', 'document', 'audio', 'video'],
    Icon: File,
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      openSlashPanel(editor, 'file');
    },
  },
  {
    id: 'timegraph',
    label: 'Timegraph',
    hint: 'Insert a timeline of events',
    keywords: ['timegraph', 'timeline', 'time', 'graph', 'chronology', 'dates', 'history', 'events'],
    Icon: CalendarRange,
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      openSlashPanel(editor, 'timegraph');
    },
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Turn this paragraph into a quote',
    keywords: ['quote', 'blockquote', 'quotation'],
    Icon: Quote,
    run: ({ editor, range }) => {
      // Reuse the side menu's blockquote command and styling. One transaction
      // removes the slash text and wraps the paragraph, preserving its marks.
      const chain = editor.chain().focus().deleteRange(range);
      if (!editor.isActive('blockquote')) chain.setBlockquote();
      chain.run();
    },
  },
];

const EMPTY_STATE = { menu: null, panel: null, dismissedFrom: null };

// "/" only starts a command at the beginning of a word, so a URL or a date
// (24/7) never opens the menu. The query runs to the cursor.
const TRIGGER = /(?:^|\s)\/([\w-]*)$/;

export function getSlashState(editorState) {
  return slashCommandKey.getState(editorState) || EMPTY_STATE;
}

export function filterSlashCommands(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(command =>
    command.label.toLowerCase().includes(needle)
    || command.keywords.some(keyword => keyword.startsWith(needle)));
}

function sendMeta(editor, meta) {
  if (!editor) return;
  editor.view.dispatch(editor.state.tr.setMeta(slashCommandKey, meta).setMeta('addToHistory', false));
}

/** Open a command's own UI (the /image picker, and whatever comes next). */
export function openSlashPanel(editor, kind) {
  sendMeta(editor, { type: 'openPanel', panel: { kind, pos: editor.state.selection.from } });
}

export function closeSlashPanel(editor) {
  sendMeta(editor, { type: 'closePanel' });
}

export function dismissSlashMenu(editor) {
  sendMeta(editor, { type: 'dismissMenu' });
}

export function setSlashMenuIndex(editor, index) {
  sendMeta(editor, { type: 'setIndex', index });
}

export function runSlashCommand(editor, command) {
  const { menu } = getSlashState(editor.state);
  if (!menu || !command) return;
  command.run({ editor, range: { from: menu.from, to: menu.to } });
}

function detectTrigger(state) {
  const { selection } = state;
  if (!selection.empty) return null;

  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼');
  const match = TRIGGER.exec(textBefore);
  if (!match) return null;

  const query = match[1];
  return { query, from: $from.pos - (query.length + 1), to: $from.pos };
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    const extensionEditor = this.editor;

    return [
      new Plugin({
        key: slashCommandKey,

        state: {
          init: () => EMPTY_STATE,
          apply(tr, prev, _oldState, nextState) {
            const meta = tr.getMeta(slashCommandKey);

            if (meta?.type === 'openPanel') {
              return { menu: null, panel: meta.panel, dismissedFrom: null };
            }
            if (meta?.type === 'setIndex' && prev.menu) {
              return { ...prev, menu: { ...prev.menu, index: meta.index } };
            }
            if (meta?.type === 'dismissMenu') {
              return { ...prev, menu: null, dismissedFrom: prev.menu?.from ?? null };
            }

            let panel = meta?.type === 'closePanel' ? null : prev.panel;
            // Keep the panel pinned to its spot as the document shifts under it.
            if (panel && tr.docChanged) panel = { ...panel, pos: tr.mapping.map(panel.pos) };

            if (!meta && !tr.docChanged && !tr.selectionSet) {
              return panel === prev.panel ? prev : { ...prev, panel };
            }

            // A panel owns the screen while it's open; no menu underneath it.
            const trigger = panel ? null : detectTrigger(nextState);
            if (!trigger) return { menu: null, panel, dismissedFrom: null };

            // Escape dismissed this exact "/" — leave it dismissed until the
            // user types a fresh one rather than popping straight back up.
            if (prev.dismissedFrom === trigger.from) {
              return { menu: null, panel, dismissedFrom: prev.dismissedFrom };
            }

            const sameQuery = prev.menu?.from === trigger.from && prev.menu?.query === trigger.query;
            return {
              menu: { ...trigger, index: sameQuery ? prev.menu.index : 0 },
              panel,
              dismissedFrom: null,
            };
          },
        },

        props: {
          handleKeyDown(view, event) {
            const { menu, panel } = getSlashState(view.state);

            if (panel && event.key === 'Escape') {
              closeSlashPanel(extensionEditor);
              return true;
            }
            if (!menu) return false;

            if (event.key === 'Escape') {
              dismissSlashMenu(extensionEditor);
              return true;
            }

            const items = filterSlashCommands(menu.query);
            if (!items.length) return false;
            const index = Math.min(menu.index, items.length - 1);

            if (event.key === 'ArrowDown') {
              setSlashMenuIndex(extensionEditor, (index + 1) % items.length);
              return true;
            }
            if (event.key === 'ArrowUp') {
              setSlashMenuIndex(extensionEditor, (index - 1 + items.length) % items.length);
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              runSlashCommand(extensionEditor, items[index]);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

export default SlashCommands;
