'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_SUGGESTIONS,
  buildContextMenuTemplate,
  installContextMenu,
} = require('../desktop/context-menu.cjs');

/**
 * The right-click menu.
 *
 * Electron ships none, so a misspelled word could be underlined in red and
 * still offer nothing when pressed, and no word could ever be added to the
 * dictionary. The case that matters most is the one with no suggestions at all
 * — a transliteration like "techelet" or "tzitzit" that Chromium has never seen
 * — because that is precisely when adding it to the dictionary is the only
 * useful thing the menu can do.
 */

const labels = (template) => template.map((item) => item.label || item.role || item.type);

function findByLabel(template, label) {
  return template.find((item) => item.label === label) || null;
}

test('offers the spelling suggestions Chromium already found', () => {
  const replaced = [];
  const template = buildContextMenuTemplate(
    { misspelledWord: 'techelet', dictionarySuggestions: ['telecheck', 'tercet'], isEditable: true },
    { replaceMisspelling: (word) => replaced.push(word) },
  );

  findByLabel(template, 'tercet').click();
  assert.deepEqual(replaced, ['tercet']);
});

test('can teach it a word it has never seen', () => {
  const added = [];
  const template = buildContextMenuTemplate(
    { misspelledWord: 'tzitzit', dictionarySuggestions: [], isEditable: true },
    { addToDictionary: (word) => added.push(word) },
  );

  const entry = findByLabel(template, 'Add to Dictionary');
  assert.ok(entry, 'a word with no suggestions offered no way into the dictionary');
  entry.click();
  assert.deepEqual(added, ['tzitzit']);
});

test('says so plainly when it has nothing to suggest', () => {
  const template = buildContextMenuTemplate(
    { misspelledWord: 'chilazon', dictionarySuggestions: [], isEditable: true },
    {},
  );
  const note = findByLabel(template, 'No spelling suggestions');
  assert.ok(note, 'an empty suggestion list left the menu opening on a bare divider');
  assert.equal(note.enabled, false);
});

test('does not turn a long suggestion list into a wall', () => {
  const many = Array.from({ length: 20 }, (_, index) => `guess-${index}`);
  const template = buildContextMenuTemplate(
    { misspelledWord: 'techelet', dictionarySuggestions: many, isEditable: true },
    {},
  );
  const suggestions = template.filter((item) => /^guess-/.test(item.label || ''));
  assert.equal(suggestions.length, MAX_SUGGESTIONS);
});

test('carries the ordinary editing commands, clipboard included', () => {
  const template = buildContextMenuTemplate({ isEditable: true, selectionText: 'techelet' }, {});
  const roles = labels(template);
  ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].forEach((role) => {
    assert.ok(roles.includes(role), `${role} is missing from the right-click menu`);
  });
});

test('offers copy on selected text that cannot be edited', () => {
  const template = buildContextMenuTemplate({ isEditable: false, selectionText: 'Mishneh Torah' }, {});
  const roles = labels(template);
  assert.ok(roles.includes('copy'));
  assert.ok(!roles.includes('paste'), 'read-only text offered to paste into itself');
  assert.ok(!roles.includes('cut'));
});

test('opens nothing at all on bare page furniture', () => {
  assert.deepEqual(buildContextMenuTemplate({ isEditable: false, selectionText: '' }, {}), []);
  assert.deepEqual(buildContextMenuTemplate({}, {}), []);
});

test('never opens, ends, or doubles up on a divider', () => {
  const template = buildContextMenuTemplate(
    { misspelledWord: 'tzitzit', dictionarySuggestions: [], isEditable: false, selectionText: '' },
    {},
  );
  const types = template.map((item) => item.type);
  assert.notEqual(types[0], 'separator');
  assert.notEqual(types[types.length - 1], 'separator');
  types.forEach((type, index) => {
    if (index === 0) return;
    assert.ok(!(type === 'separator' && types[index - 1] === 'separator'), 'two dividers in a row');
  });
});

test('replacing and dictionary-adding both happen in the main process', () => {
  // Neither call exists in the renderer, which is the whole reason this module
  // is wired from main.cjs rather than from the page.
  const calls = [];
  const webContents = {
    on(name, handler) { this.handler = name === 'context-menu' ? handler : this.handler; },
    replaceMisspelling: (word) => calls.push(['replace', word]),
    session: { addWordToSpellCheckerDictionary: (word) => calls.push(['add', word]) },
  };
  let poppedWindow = null;
  const Menu = {
    buildFromTemplate: (template) => ({ popup: ({ window }) => { poppedWindow = window; Menu.template = template; } }),
  };
  const window = { id: 'main' };

  installContextMenu({ Menu, webContents, window });
  assert.ok(webContents.handler, 'nothing listened for the right-click');

  webContents.handler({}, { misspelledWord: 'techelet', dictionarySuggestions: ['tercet'], isEditable: true });
  assert.equal(poppedWindow, window);

  findByLabel(Menu.template, 'tercet').click();
  findByLabel(Menu.template, 'Add to Dictionary').click();
  assert.deepEqual(calls, [['replace', 'tercet'], ['add', 'techelet']]);
});

test('stays out of the way when there is nothing to show', () => {
  let popped = false;
  const webContents = {
    on(name, handler) { this.handler = handler; },
    session: { addWordToSpellCheckerDictionary() {} },
  };
  const Menu = { buildFromTemplate: () => ({ popup: () => { popped = true; } }) };

  installContextMenu({ Menu, webContents, window: {} });
  webContents.handler({}, { isEditable: false, selectionText: '' });
  assert.equal(popped, false, 'an empty menu box opened on a plain right-click');
});
