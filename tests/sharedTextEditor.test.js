import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * There is one text editor in BEX, and every writing surface is that editor.
 *
 * This is what keeps the features equal: italics, toggles, find, LaTeX, lists,
 * slash commands, timegraph embeds and marquee selection are registered once, in
 * one extension list, so no surface can quietly end up with fewer of them.
 *
 * These are structural checks because that is exactly the failure mode worth
 * guarding: a new surface that builds its own editor, or an extension dropped
 * from the shared list, would leave the app working but unequal — which is
 * invisible until someone happens to try that feature on that page.
 */

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const editor = read('src/components/editor/TEXT_EDITOR_MACHINERY.jsx');

/** Every writing surface in the app, and what it is. */
const SURFACES = Object.freeze({
  'the Study page': 'src/pages/Study.jsx',
  // The page inside a note, which is what a note is written on.
  'markdown notes': 'src/components/notes/BookSurface.jsx',
  'Knowledge Web card descriptions': 'src/components/knowledgeweb/CardEditor.jsx',
  'the keywords form': 'src/components/keywords/KeywordForm.jsx',
  'the keywords page': 'src/pages/Keywords.jsx',
  'annotations': 'src/components/editor/AnnotationPopup.jsx',
  'comments': 'src/components/editor/CommentSidebar.jsx',
});

describe('one shared text editor', () => {
  for (const [label, file] of Object.entries(SURFACES)) {
    it(`${label} use the shared editor`, () => {
      const source = read(file);
      assert.match(
        source,
        /import TEXT_EDITOR_MACHINERY from/,
        `${file} does not import the shared editor`,
      );
      assert.match(source, /<TEXT_EDITOR_MACHINERY/, `${file} does not render the shared editor`);
    });
  }

  it('the note panel reaches the shared editor through its page, not around it', () => {
    const panel = read('src/components/knowledgeweb/NoteEditorPanel.jsx');
    assert.match(panel, /import BookSurface from/);
    assert.match(panel, /<BookSurface/);
    assert.doesNotMatch(panel, /from ['"]@tiptap\//);
  });

  it('has no second editor implementation', () => {
    // A second useEditor call anywhere else would be a parallel editor with its
    // own extension list, and the two would drift.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(relative); continue; }
        if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
        const source = read(relative);
        if (!/useEditor\s*\(/.test(source)) continue;
        if (relative.endsWith('src/components/editor/TEXT_EDITOR_MACHINERY.jsx')) continue;
        offenders.push(relative);
      }
    };
    walk('src');
    assert.deepEqual(offenders, [], `these files build their own editor: ${offenders.join(', ')}`);
  });
});

describe('local ⌘F routing', () => {
  const LOCAL_FIND_SURFACES = Object.freeze({
    'Knowledge Web descriptions': 'src/components/knowledgeweb/CardEditor.jsx',
    notes: 'src/components/notes/BookSurface.jsx',
    'Bible verse commentary': 'src/pages/Study.jsx',
    'keyword definitions': 'src/pages/Keywords.jsx',
  });

  for (const [label, file] of Object.entries(LOCAL_FIND_SURFACES)) {
    it(`${label} explicitly claim the shared editor finder`, () => {
      assert.match(
        read(file),
        /<TEXT_EDITOR_MACHINERY[\s\S]*?localFindShortcut[\s\S]*?\/>/,
        `${file} would fall through to global search while its editor is active`,
      );
    });
  }

  it('marks only opted-in editor roots for shortcut routing', () => {
    assert.match(editor, /localFindShortcut = false/);
    assert.match(editor, /data-bex-local-find-shortcut=\{localFindShortcut \? 'true' : undefined\}/);
  });

  it('uses an explicit local-first handoff so only one finder opens', () => {
    const globalSearch = read('src/components/search/GlobalSearch.jsx');
    const shortcut = read('src/lib/localFindShortcut.js');
    assert.match(shortcut, /new CustomEvent\(LOCAL_FIND_SHORTCUT_REQUEST[\s\S]*?cancelable: true/);
    assert.match(shortcut, /return !window\.dispatchEvent\(request\)/);
    assert.match(globalSearch, /if \(!event\.shiftKey && requestLocalFindShortcut\(\)\)[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?return;/);
    assert.match(editor, /window\.addEventListener\(LOCAL_FIND_SHORTCUT_REQUEST, onLocalFindRequest\)/);
    assert.match(editor, /if \(!editor \|\| !localFindShortcut\) return undefined/);
  });
});

describe('the shared extension list', () => {
  const extensions = editor.slice(
    editor.indexOf('extensions: ['),
    editor.indexOf('\n    ],', editor.indexOf('extensions: [')),
  );

  // Every text feature added over this project, and the extension that carries
  // it. If one is dropped from the list, it disappears from every surface at
  // once — which is the correct behaviour, but it should never be silent.
  const REQUIRED = Object.freeze({
    'bold, italic (⌘I), headings, lists, blockquote, history': 'StarterKit',
    'underline': 'Underline',
    'links': 'Link',
    'collapsible toggles with disclosure triangles': 'CollapsibleToggle',
    'tables': 'Table',
    'image upload and resize': 'ImageUpload',
    'keyword links': 'KeywordLink',
    'Bible site links': 'BibleSiteLink',
    'LaTeX / logic blocks (⌘L)': 'LogicBlock',
    'typography rules': 'TypographyRules',
    'timegraph embeds': 'TimegraphEmbed',
    'find in document (⌘F)': 'FindInEditor',
    'slash commands': 'SlashCommands',
  });

  for (const [feature, extension] of Object.entries(REQUIRED)) {
    it(`registers ${extension} — ${feature}`, () => {
      // Extensions a composer has no business loading — tables, embeds, slash
      // commands — are gated in place with richOnly(...) rather than moved, so
      // a registration reads either bare or wrapped.
      assert.match(
        extensions,
        new RegExp(`^\\s+(\\.\\.\\.richOnly\\()?${extension}[,.)]`, 'm'),
        `${extension} is missing from the shared list, so ${feature} is gone everywhere`,
      );
    });
  }

  it('adds marquee selection and comments outside nested editors only', () => {
    // A comment card is itself an editor. It gets no block-drag handle (there is
    // nothing to reorder in a two-line card) and no commenting on a comment.
    assert.match(extensions, /\.\.\.\(nested \? \[\] : \[BlockDrag, Comment\]\)/);
  });

  it('only the comment card asks to be nested', () => {
    for (const [label, file] of Object.entries(SURFACES)) {
      const source = read(file);
      const isNested = /<TEXT_EDITOR_MACHINERY[^>]*\n?\s*nested/s.test(
        source.slice(source.indexOf('<TEXT_EDITOR_MACHINERY'), source.indexOf('<TEXT_EDITOR_MACHINERY') + 300),
      );
      if (file.endsWith('CommentSidebar.jsx')) {
        assert.equal(isNested, true, 'the comment card should be nested');
      } else {
        assert.equal(isNested, false, `${label} should not be nested — it would lose features`);
      }
    }
  });

  it('nested changes only sizing, not which features exist', () => {
    // A comment card sizes to its content instead of opening a 60vh canvas.
    // That is the only styling difference, and it carries no behaviour.
    const classes = editor.slice(editor.indexOf('attributes: {'), editor.indexOf('onCreate:'));
    assert.match(classes, /nested\s*\?\s*'[^']*bex-nested-editor'/);
    assert.equal(
      /min-h-\[60vh\][^']*bex-nested-editor/.test(classes),
      false,
      'the nested variant should not carry a tall min-height',
    );
  });

  it('the prose classes cannot make one surface differ from another', () => {
    // The class strings differ (prose-sm on cards and keywords, plain prose on
    // notes), which would be a real typography split — except @tailwindcss/
    // typography is not installed, so every prose* class is inert. If it is ever
    // added, this fails and says so, because the surfaces would start diverging.
    const pkg = JSON.parse(read('package.json'));
    const installed = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.equal(
      Boolean(installed['@tailwindcss/typography']),
      false,
      'typography is installed: the prose / prose-sm split now changes text size per surface',
    );
  });
});

describe('undo belongs to the editor, not the page', () => {
  const blockDrag = read('src/components/editor/BlockDragExtension.js');
  const knowledgeWeb = read('src/pages/KnowledgeWeb.jsx');

  it('the editor claims undo while blocks are selected', () => {
    // A block selection releases the text caret, so ProseMirror's own keymap no
    // longer sees ⌘Z and the key arrives with document.body as its target. A
    // page-level handler that only skips contentEditable then ran the canvas
    // undo, which re-rendered and threw the reader to the top of the note.
    assert.match(blockDrag, /onBlockUndo = \(event\) => \{/);
    assert.match(blockDrag, /if \(!pluginState\.selected\.length\) return;/);
    assert.match(blockDrag, /const run = event\.shiftKey \? redo : undo;/);
  });

  it('stops the key so nothing further up also acts on it', () => {
    const handler = blockDrag.slice(
      blockDrag.indexOf('onBlockUndo = (event)'),
      blockDrag.indexOf('scheduleHide =', blockDrag.indexOf('onBlockUndo = (event)')),
    );
    assert.match(handler, /event\.preventDefault\(\)/);
    assert.match(handler, /event\.stopImmediatePropagation\(\)/);
  });

  it('registers and tears down the listener', () => {
    assert.match(blockDrag, /window\.addEventListener\('keydown', this\.onBlockUndo, true\)/);
    assert.match(blockDrag, /window\.removeEventListener\('keydown', this\.onBlockUndo, true\)/);
  });

  it('uses ProseMirror history, since the plugin view has no tiptap editor', () => {
    assert.match(blockDrag, /import \{ redo, undo \} from '@tiptap\/pm\/history'/);
  });

  it('the page hands every canvas command back when a note is open', () => {
    // Undo used to carve out this exception alone, which left copy, cut, paste
    // and Delete still acting on a canvas that is not even on screen. The guard
    // now covers the whole handler, and has to sit ahead of the first command.
    const handler = knowledgeWeb.slice(
      knowledgeWeb.indexOf('const handleKeyDown = (e) => {'),
      knowledgeWeb.indexOf("window.addEventListener('keydown', handleKeyDown)"),
    );
    const guard = handler.indexOf('if (activeNoteIdRef.current) return;');
    const firstCommand = handler.indexOf("if (isMod && (e.key === 'z' || e.key === 'Z'))");
    assert.ok(guard > -1, 'the canvas handler no longer bails out for an open note');
    assert.ok(
      guard < firstCommand,
      'the open-note guard must run before any canvas command claims the key',
    );
  });

  it('the page never runs canvas undo underneath a fullscreen card editor', () => {
    const undoBranch = knowledgeWeb.slice(
      knowledgeWeb.indexOf("if (isMod && (e.key === 'z' || e.key === 'Z'))"),
    ).slice(0, 1400);
    assert.match(undoBranch, /document\.querySelector\('\.kw-card-editor-fullscreen'\)/);
    assert.match(undoBranch, /if \(hasFullscreenCardEditor\) return;/);
  });

  it('leaves the clipboard to the note rather than to the cards behind it', () => {
    // Cmd+C/X/V reach this handler whenever focus is not literally inside the
    // editor — a block selection releases the caret, a popover button takes the
    // press, a freshly turned page has not been clicked into yet. Each of those
    // used to copy or paste cards instead of text.
    const handler = knowledgeWeb.slice(
      knowledgeWeb.indexOf('const handleKeyDown = (e) => {'),
      knowledgeWeb.indexOf("window.addEventListener('keydown', handleKeyDown)"),
    );
    const guard = handler.indexOf('if (activeNoteIdRef.current) return;');

    for (const command of [
      "if (isMod && (e.key === 'c' || e.key === 'C')",
      "if (isMod && (e.key === 'x' || e.key === 'X')",
      "if (isMod && (e.key === 'v' || e.key === 'V')",
      "if (e.key === 'Delete' || e.key === 'Backspace')",
    ]) {
      const at = handler.indexOf(command);
      assert.ok(at > -1, `${command} is no longer in the canvas handler`);
      assert.ok(guard < at, `${command} can still fire while a note is open`);
    }
  });

  it('keeps that flag current without re-binding the listener', () => {
    assert.match(knowledgeWeb, /const activeNoteIdRef = useRef\(null\);/);
    assert.match(knowledgeWeb, /activeNoteIdRef\.current = activeNoteId;/);
  });

  it('canvas undo keeps an open fullscreen card selected', () => {
    const restore = knowledgeWeb.slice(
      knowledgeWeb.indexOf('const applySnapshot = useCallback'),
      knowledgeWeb.indexOf('// Serialize graph replacements'),
    );
    assert.match(restore, /setSelectedCardId\(\(current\) => \(/);
    assert.match(restore, /nextCardIds\.has\(String\(current\)\) \? current : null/);
    assert.doesNotMatch(restore, /clearSelection\(\)/);
  });
});

describe('modifier-key commands belong to selected text, not the card canvas', () => {
  const blockDrag = read('src/components/editor/BlockDragExtension.js');
  const knowledgeWeb = read('src/pages/KnowledgeWeb.jsx');

  it('routes every modifier command back into a block-selected editor', () => {
    assert.match(blockDrag, /onBlockEditorShortcut = async \(event\) => \{/);
    assert.match(blockDrag, /this\.view\.focus\(\)/);
    assert.match(blockDrag, /this\.view\.dom\.dispatchEvent\(new KeyboardEvent\('keydown'/);
    assert.match(blockDrag, /event\.stopImmediatePropagation\(\)/);
    assert.match(blockDrag, /selectBlockTextRange = \(\{ keepBlockSelection = false \} = \{\}\) => \{/);
    assert.match(blockDrag, /TextSelection\.between/);
  });

  it('makes select-all operate on the editor document', () => {
    assert.match(blockDrag, /new AllSelection\(this\.view\.state\.doc\)/);
    assert.match(blockDrag, /setMeta\(blockDragPluginKey, \{ type: 'clear' \}\)/);
  });

  it('writes selected blocks through the clipboard event, never the permission-gated API', () => {
    // navigator.clipboard is refused outright in this app — the desktop process
    // denies every permission request — so copying blocks through it failed
    // every single time. The clipboard event needs no permission, which is why
    // ordinary text copying always worked. The comments explaining that history
    // name the old API, so this reads the code with the prose taken out.
    const code = blockDrag
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    assert.doesNotMatch(code, /navigator\.clipboard/);
    assert.doesNotMatch(code, /ClipboardItem/);
    assert.match(code, /event\.clipboardData\.setData\('text\/html'/);
    assert.match(code, /event\.clipboardData\.setData\('text\/plain'/);
  });

  it('listens for the copy on the document, not on the editor element', () => {
    // A whole-block selection deliberately releases the caret, so the event
    // fires against document.body and never reaches a listener on the editor.
    assert.match(blockDrag, /document\.addEventListener\('copy', this\.onCopy, true\)/);
    assert.match(blockDrag, /document\.addEventListener\('cut', this\.onCopy, true\)/);
    assert.match(blockDrag, /document\.removeEventListener\('copy', this\.onCopy, true\)/);
    assert.match(blockDrag, /document\.removeEventListener\('cut', this\.onCopy, true\)/);
  });

  it('asks for the clipboard event, because the browser will not raise one itself', () => {
    // With no selection at the moment the key was pressed the browser performs
    // no copy at all, and one made during the handler arrives too late for the
    // default action. execCommand raises the event synchronously instead.
    const branch = blockDrag.slice(
      blockDrag.indexOf("if ((key === 'c' || key === 'x')"),
      blockDrag.indexOf("if (key === 'v')"),
    );
    assert.match(branch, /this\.selectBlockTextRange\(\{ keepBlockSelection: true \}\)/);
    assert.match(branch, /document\.execCommand\(key === 'x' \? 'cut' : 'copy'\)/);
  });

  it('removes cut blocks itself, since the default was prevented', () => {
    assert.match(blockDrag, /if \(event\.type === 'cut'\) this\.deleteSelectedBlocks\(\)/);
  });

  it('leaves ⌘⇧C to the editor rather than treating it as a copy', () => {
    // Shift is not part of copy or cut. Without this the case-toggle shortcut
    // would put the blocks on the clipboard instead of recasing them.
    assert.match(blockDrag, /if \(\(key === 'c' \|\| key === 'x'\) && !event\.shiftKey\)/);
  });

  it('does not intercept trusted paste after returning focus to the editor', () => {
    const pasteBranch = blockDrag.slice(
      blockDrag.indexOf("if (key === 'v')"),
      blockDrag.indexOf('// The original event', blockDrag.indexOf("if (key === 'v')")),
    );
    assert.doesNotMatch(pasteBranch, /preventDefault/);
  });

  it('registers and removes the ownership listener', () => {
    assert.match(blockDrag, /window\.addEventListener\('keydown', this\.onBlockEditorShortcut, true\)/);
    assert.match(blockDrag, /window\.removeEventListener\('keydown', this\.onBlockEditorShortcut, true\)/);
  });

  it('the Knowledge Web also recognizes a visible block-selected editor', () => {
    assert.match(knowledgeWeb, /\.ProseMirror\.bex-block-selection-active/);
    assert.match(knowledgeWeb, /if \(isEditingText \|\| hasActiveTextBlocks\) return;/);
  });
});

describe('marquee selection never steals another widget press', () => {
  const blockDrag = read('src/components/editor/BlockDragExtension.js');

  it('uses the full height of both page margins as a marquee starting area', () => {
    const startGesture = blockDrag.slice(
      blockDrag.indexOf('startGutterGesture = (event)'),
      blockDrag.indexOf('releaseTextCaret()', blockDrag.indexOf('startGutterGesture = (event)')),
    );
    assert.match(startGesture, /const block = blockAtY\(this\.view, event\.clientY\)/);
    assert.doesNotMatch(startGesture, /editorRect/);
    assert.doesNotMatch(startGesture, /event\.clientY\s*[<>]/);
  });

  it('requires the press to land on the page surface', () => {
    // Floating UI is portaled to document.body, so it sits visually in the
    // margin while living outside the surface. Claiming those presses made the
    // comment box impossible to type in: preventDefault stopped it taking focus.
    assert.match(blockDrag, /if \(!surface\.contains\(event\.target\)\) return false;/);
  });

  it('leaves any other editable surface alone', () => {
    assert.match(blockDrag, /contenteditable="true"/);
    assert.match(blockDrag, /editable !== this\.view\.dom/);
  });

  it('still leaves gutter controls their own clicks', () => {
    assert.match(blockDrag, /GUTTER_CONTROL_SELECTOR/);
  });
});

describe('whole-block format chooser', () => {
  const editor = read('src/components/editor/TEXT_EDITOR_MACHINERY.jsx');
  const blockDrag = read('src/components/editor/BlockDragExtension.js');

  it('is owned by the shared editor used across BEX text surfaces', () => {
    assert.match(editor, /data-testid="single-block-format-menu"/);
    // A marquee alone remains selection-only. Clicking one selected handle
    // opens the chooser without collapsing the selected run.
    assert.match(editor, /blockFormatMenuIndex\(pluginState\)/);
    assert.match(editor, /blockFormatMenuSelection\(pluginState\)/);
    assert.match(editor, /selectedDraggableBlocks/);
    assert.match(blockDrag, /keepMarqueeSelection/);
    assert.match(blockDrag, /selected: keepMarqueeSelection \? pluginState\.selected : \[initialIndex\]/);
    assert.match(editor, /blockDragPluginKey\.getState\(editor\.state\)/);
  });

  it('offers only formats that are genuinely implemented', () => {
    for (const label of [
      'Text',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
      'Bulleted list',
      'Numbered list',
      'Toggle list',
      'Code',
      'Quote',
    ]) {
      assert.match(editor, new RegExp(`label: '${label}'`));
    }
    assert.doesNotMatch(editor, /label: 'Page'/);
    assert.doesNotMatch(editor, /label: 'Callout'/);
  });

  it('connects every row to a real undoable editor command', () => {
    assert.match(editor, /setParagraph\(\)/);
    assert.match(editor, /setHeading\(\{ level:/);
    assert.match(editor, /toggleBulletList\(\)/);
    assert.match(editor, /toggleOrderedList\(\)/);
    assert.match(editor, /setDetails\(\)/);
    assert.match(editor, /setCodeBlock\(\)/);
    assert.match(editor, /setBlockquote\(\)/);
    assert.match(editor, /chain\.run\(\)/);
  });

  it('does not lose the selected blocks when the portaled menu is pressed', () => {
    assert.match(blockDrag, /closest\?\.\('\[data-bex-block-format-menu\]'\)/);
  });
});
