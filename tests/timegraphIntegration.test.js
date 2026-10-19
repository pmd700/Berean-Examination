import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Structural checks on how the Timegraph reaches the four places it has to work.
 *
 * Every rich-text surface in BEX shares one TEXT_EDITOR_MACHINERY, so the embed is
 * registered there exactly once instead of four times. That is the right design,
 * but it makes the integration invisible in each individual surface — nothing in
 * KeywordForm.jsx mentions Timegraph at all. These tests pin the chain that makes
 * it true, so a future refactor that gives one surface its own editor, or drops
 * the node from the shared list, fails here instead of silently removing the
 * feature from a page nobody thought to re-test.
 */

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const SURFACES = Object.freeze({
  'markdown notes': 'src/components/notes/BookSurface.jsx',
  'knowledge web cards': 'src/components/knowledgeweb/CardEditor.jsx',
  'keywords': 'src/components/keywords/KeywordForm.jsx',
});

describe('timegraph integration points', () => {
  for (const [label, file] of Object.entries(SURFACES)) {
    test(`${label} render the shared TEXT_EDITOR_MACHINERY`, () => {
      const source = read(file);
      assert.match(
        source,
        /import\s+TEXT_EDITOR_MACHINERY\s+from/,
        `${file} no longer imports TEXT_EDITOR_MACHINERY, so it would lose the Timegraph embed`,
      );
      assert.match(source, /<TEXT_EDITOR_MACHINERY/, `${file} does not render TEXT_EDITOR_MACHINERY`);
    });
  }

  test('the shared editor registers the Timegraph node', () => {
    const source = read('src/components/editor/TEXT_EDITOR_MACHINERY.jsx');
    assert.match(source, /import\s*\{\s*TimegraphEmbed\s*\}\s*from\s*'\.\/TimegraphEmbedExtension'/);
    // Present in the extensions array, not merely imported. The array's close is
    // matched at its own indentation: the first `],` after `extensions:` is the
    // nested `levels: [1, 2, 3, 4],` inside StarterKit's config.
    const start = source.indexOf('extensions:');
    const end = source.indexOf('\n    ],', start);
    assert.ok(start !== -1 && end > start, 'could not locate the extensions array');
    const extensions = source.slice(start, end);
    // Embeds are gated out of the small composers (tooltip and footnote bodies)
    // with richOnly(...), so the registration reads wrapped rather than bare.
    assert.match(
      extensions,
      /^\s+(\.\.\.richOnly\()?TimegraphEmbed[,)]/m,
      'TimegraphEmbed is imported but not registered',
    );
  });

  test('the shared editor mounts the insert picker', () => {
    const source = read('src/components/editor/TEXT_EDITOR_MACHINERY.jsx');
    assert.match(source, /<TimegraphInsertHost editor=\{editor\} \/>/);
  });

  test('the slash menu offers Timegraph and reaches the picker', () => {
    const source = read('src/components/editor/slashCommands.js');
    assert.match(source, /id: 'timegraph'/);
    assert.match(source, /openSlashPanel\(editor, 'timegraph'\)/);
    const host = read('src/components/editor/TimegraphInsertHost.jsx');
    assert.match(host, /panel\?\.kind === 'timegraph'/);
    assert.match(host, /insertTimegraph\(record\.id\)/);
  });

  test('the embed stores only a reference, never a copy of the events', () => {
    const source = read('src/components/editor/TimegraphEmbedExtension.jsx');
    // The node's attributes must be the id alone; anything else would let a
    // document hold a stale duplicate of the graph.
    const attributes = source.slice(
      source.indexOf('addAttributes()'),
      source.indexOf('parseHTML()'),
    );
    const declared = [...attributes.matchAll(/^\s{6}(\w+):\s*\{/gm)].map((match) => match[1]);
    assert.deepEqual(declared, ['timegraphId']);
    assert.equal(/events:/.test(attributes), false, 'the embed must not carry event data');
  });

  test('removing an embed deletes the node, not the timegraph', () => {
    const source = read('src/components/editor/TimegraphEmbedExtension.jsx');
    // The remove button must call tiptap's deleteNode and never the store's delete.
    assert.match(source, /onClick=\{deleteNode\}/);
    assert.equal(
      /deleteTimegraph/.test(source),
      false,
      'the embed must never call deleteTimegraph — that would destroy every other embed',
    );
  });

  test('deleting the object itself is only offered from the picker', () => {
    const picker = read('src/components/timegraph/TimegraphPicker.jsx');
    assert.match(picker, /deleteTimegraph/);
    // And it must be behind a confirmation.
    assert.match(picker, /confirmDelete/);
  });

  test('the entity is registered end to end in the encrypted store', () => {
    const store = read('desktop/local-entity-store.cjs');
    assert.match(store, /Timegraph: Object\.freeze\(\{/);
    assert.match(store, /table: 'local_timegraphs'/);
    // Validated on both write paths, not just create. Matching `this.` excludes
    // the method definition itself.
    const validatorCalls = store.match(/this\.validateTimegraph\(payload\)/g) || [];
    assert.equal(validatorCalls.length, 2, 'validateTimegraph must run on create and update');

    const database = read('desktop/database.cjs');
    assert.match(database, /name: 'encrypted_timegraphs'/);
    assert.match(database, /CREATE TABLE local_timegraphs/);
  });

  test('Timeline keeps its tab identity while creation lives on New tab', () => {
    const tabs = read('src/lib/WorkspaceTabs.jsx');
    assert.match(tabs, /TIMELINE: 'timeline'/);
    assert.match(tabs, /kind: TAB_KINDS\.TIMELINE/);
    assert.match(tabs, /kind: TAB_KINDS\.TIMELINE[\s\S]*?path: NEW_TAB_PATH/);
    // A default title, or a new tab would read "Workspace".
    assert.match(tabs, /\[TAB_KINDS\.TIMELINE\]: 'Timeline'/);
    // An icon, or the tab would fall back to the Study book.
    assert.match(read('src/components/tabs/TabBar.jsx'), /\[TAB_KINDS\.TIMELINE\]: TimelineGlyph/);
  });

  test('a timeline deep link resolves to a Timeline tab', () => {
    const tabs = read('src/lib/WorkspaceTabs.jsx');
    // A real editor deep link remains a Timeline. The retired list route takes
    // old bookmarks and sessions to the single New tab management surface.
    assert.match(tabs, /path\.startsWith\('\/timegraphs\/'\)\) return TAB_KINDS\.TIMELINE/);
    assert.match(tabs, /createPageUrl\('Timelines'\)\)\) return TAB_KINDS\.HOME/);

    const workspace = read('src/components/tabs/TabWorkspace.jsx');
    assert.match(workspace, /path="\/timegraphs\/:slugId"/);
    // And the URL→tab sync must count it as a deep link so the kind updates.
    assert.match(workspace, /browserPath\.startsWith\('\/timegraphs\/'\)/);
  });

  test('the Timeline route opens only the editor and retires its duplicate list', () => {
    const config = read('src/pages.config.js');
    assert.match(config, /import Timelines from '\.\/pages\/Timelines'/);
    assert.match(config, /"Timelines": Timelines,/);

    const page = read('src/pages/Timelines.jsx');
    // The editor remains real, but management now has one home in LibraryHome.
    assert.match(page, /<TimegraphEditor/);
    assert.match(page, /listTimegraphs/);
    assert.match(page, /useTabTitle/);
    assert.match(page, /path: NEW_TAB_PATH/);
    assert.doesNotMatch(page, /data-testid="timelines-library"/);
    assert.doesNotMatch(page, /data-testid="timelines-list"/);
    assert.doesNotMatch(page, /createTimegraph/);
    assert.doesNotMatch(page, /deleteTimegraph/);
  });

  test('Knowledge Web shortcut 6 places a live compressed Timeline link', () => {
    const toolbar = read('src/components/knowledgeweb/FloatingToolbar.jsx');
    assert.match(toolbar, /id: 'timegraph'.*label: 'Timeline'.*defaultKey: '6'/);
    assert.equal(/id: 'sketch'/.test(toolbar), false, 'the obsolete Sketch tool must not remain');

    const page = read('src/pages/KnowledgeWeb.jsx');
    assert.match(page, /<TimegraphPicker/);
    assert.match(page, /createCanvasObject\('timegraph'/);
    assert.match(page, /timegraph_id: picked\.id/);
    assert.match(page, /<CanvasTimegraph/);
    assert.match(page, /timegraphDeepLink\(graph\.id, graph\.title\)/);

    const miniature = read('src/components/knowledgeweb/CanvasTimegraph.jsx');
    assert.match(miniature, /useTimegraph\(obj\.timegraph_id\)/);
    assert.match(miniature, /renameTimegraph\(timegraph\.id, nextTitle\)/);
    assert.match(miniature, /Double-click to rename timeline/);
    assert.match(miniature, /onDoubleClick=\{handleDoubleClick\}/);
    assert.match(miniature, /Double-click to open timeline/);
    assert.doesNotMatch(miniature, /else onOpen\?\.\(timegraph\)/);
    assert.match(miniature, /fontFamily: 'inherit'/);
    assert.match(miniature, /<TimelineGlyph/);
    assert.match(miniature, /sampled\.map/);
    assert.equal(/<TimegraphEditor/.test(miniature), false, 'the canvas object must stay a compressed overview');

    assert.match(page, /const returnTo = \{/);
    assert.match(page, /kind: TAB_KINDS\.KNOWLEDGE_WEB/);
    assert.match(page, /existingTimelineTabs = tabs\.filter/);
    assert.match(page, /selectTab\(existingTimelineTab\.id\)/);
    assert.match(page, /existingTimelineTabs\.slice\(1\)\.forEach/);
    assert.match(page, /selectedObject\.object_type !== 'timegraph'/);

    const timelines = read('src/pages/Timelines.jsx');
    assert.match(timelines, /Go back to knowledge web/);
    assert.match(timelines, /selectTab\(knowledgeWebOrigin\.tabId\)/);
  });

  test('the event creator stays minimal and uses a phantom default title', () => {
    const panel = read('src/components/timegraph/TimegraphEventPanel.jsx');
    assert.match(panel, /placeholder="New event"/);
    assert.doesNotMatch(panel, /What happened, and why it matters/);
    assert.doesNotMatch(panel, /1521 · 3 jan 1521/);
    assert.doesNotMatch(panel, /Reads as/);
    assert.doesNotMatch(panel, /Years, months, days/);
    assert.doesNotMatch(panel, /alignments; affects the label inside the card/);
  });

  test('the editor measures its canvas after the timeline record loads', () => {
    const editor = read('src/components/timegraph/TimegraphEditor.jsx');
    assert.match(editor, /const hasTimegraph = Boolean\(timegraph\)/);
    assert.match(editor, /React\.useLayoutEffect/);
    assert.match(editor, /if \(hasTimegraph === false\) return undefined/);
    assert.match(editor, /window\.requestAnimationFrame\(measure\)/);
    assert.match(editor, /\[hasTimegraph, minHeight\]/);
  });

  test('the event panel exists only while an event is selected', () => {
    const editor = read('src/components/timegraph/TimegraphEditor.jsx');
    const panel = read('src/components/timegraph/TimegraphEventPanel.jsx');
    assert.match(editor, /\{selectedEvent && \(\s*<TimegraphEventPanel/);
    assert.match(panel, /if \(!event\) return null/);
    assert.doesNotMatch(panel, /timegraph-panel-empty/);
    assert.doesNotMatch(panel, /Select an event to edit it/);
  });

  test('timeline undo survives focus changes and E creates a new event', () => {
    const editor = read('src/components/timegraph/TimegraphEditor.jsx');
    assert.match(editor, /useIsActiveTab/);
    assert.match(editor, /window\.addEventListener\('keydown', handleKeyDown, true\)/);
    assert.match(editor, /historyRef\.current = next/);
    assert.match(editor, /event\.key === 'e'/);
    assert.match(editor, /title="New event \(E\)"/);
    assert.match(editor, /onDelete=\{\(id\) => \{\s*commit\(\(current\) => removeEvent\(current, id\)\)/);
  });

  test('timeline tags can be hidden from the toolbar and render on event cards', () => {
    const editor = read('src/components/timegraph/TimegraphEditor.jsx');
    const canvas = read('src/components/timegraph/TimegraphCanvas.jsx');
    assert.match(editor, /hiddenTags: \[\]/);
    assert.match(editor, /hideUntagged: false/);
    assert.match(editor, /<TagVisibilityRow[\s\S]*?tags=\{tags\}/);
    assert.match(editor, /<span>Untagged<\/span>/);
    assert.match(editor, /type="checkbox"/);
    assert.match(canvas, /bex-timegraph__card-tags/);
    assert.match(canvas, /cardTagText\(event\.tags\)/);
  });

  test('filtered timeline cards animate out and remaining lanes settle smoothly', () => {
    const canvas = read('src/components/timegraph/TimegraphCanvas.jsx');
    assert.match(canvas, /AnimatePresence, motion, useReducedMotion/);
    assert.match(canvas, /<AnimatePresence initial=\{false\}>/);
    assert.match(canvas, /<AnimatedTimegraphEvent/);
    assert.match(canvas, /animate=\{\{ y: cardY \}\}/);
    assert.match(canvas, /exit=\{reducedMotion/);
  });

  test('semantic zoom detail crossfades slowly into established axis ticks', () => {
    const canvas = read('src/components/timegraph/TimegraphCanvas.jsx');
    assert.match(canvas, /AXIS_DETAIL_FADE_TRANSITION/);
    assert.match(canvas, /duration: 0\.65/);
    assert.match(canvas, /key=\{`focus-tick-\$\{tick\.year\}`\}[\s\S]*?exit=\{\{ opacity: 0 \}\}/);
    assert.match(canvas, /key=\{`tick-\$\{tick\.year\}`\}[\s\S]*?initial=\{\{ opacity: reducedMotion \? 1 : 0 \}\}[\s\S]*?exit=\{\{ opacity: 0 \}\}/);
  });

  test('an unnamed timeline uses phantom text and supports double-click renaming', () => {
    const page = read('src/pages/Timelines.jsx');
    const store = read('src/lib/timegraph/timegraphStore.js');
    assert.match(page, /onDoubleClick=\{\(\) => setEditingTitle\(true\)\}/);
    assert.match(page, /placeholder="Unnamed timeline"/);
    assert.match(page, /Created on \{formatCreatedOn\(openGraph\.created_date\)\}/);
    assert.match(page, /await renameTimegraph\(openGraph\.id, nextTitle\)/);
    assert.match(store, /export async function renameTimegraph/);
    assert.doesNotMatch(page, /createTimegraph\(\{ title: 'Untitled timeline' \}\)/);
  });

  test('the store keeps one shared copy per timegraph id', () => {
    const source = read('src/lib/timegraph/timegraphStore.js');
    // A per-id listener set is what makes several mounted embeds update together.
    assert.match(source, /listeners: new Set\(\)/);
    assert.match(source, /export function useTimegraph/);
    assert.match(source, /export function updateTimegraph/);
  });
});
