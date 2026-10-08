'use strict';

/**
 * The right-click menu.
 *
 * Electron ships no context menu at all. The renderer's spellchecker was
 * running the whole time — every misspelling was underlined in red — but there
 * was nothing to show the suggestions it had already produced, so pressing a
 * flagged word did nothing and there was no way to teach it a word either.
 * Words like "techelet" and "tzitzit" stayed underlined forever.
 *
 * This builds the menu the platform would otherwise have given us: the
 * spelling suggestions Chromium found for the word under the cursor, a way to
 * add that word to the dictionary, and the ordinary editing commands — which
 * matter here beyond convenience, because they reach the clipboard through the
 * menu rather than through a permission this app deliberately refuses.
 */

/** How many suggestions to show before the list stops being a menu. */
const MAX_SUGGESTIONS = 8;

/**
 * The menu for one right-click, as a plain template.
 *
 * @param {object} params  Electron's context-menu params.
 * @param {object} actions
 * @param {(word: string) => void} actions.replaceMisspelling
 * @param {(word: string) => void} actions.addToDictionary
 * @returns {Array} a Menu.buildFromTemplate template, empty when there is
 *                  nothing worth showing.
 */
function buildContextMenuTemplate(params = {}, actions = {}) {
  const template = [];
  const misspelled = typeof params.misspelledWord === 'string' ? params.misspelledWord : '';
  const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : [];

  if (misspelled) {
    suggestions.slice(0, MAX_SUGGESTIONS).forEach((suggestion) => {
      template.push({
        label: suggestion,
        click: () => actions.replaceMisspelling?.(suggestion),
      });
    });

    // Chromium finds nothing for a genuinely unknown word — a proper noun, a
    // transliteration. That is exactly when adding it to the dictionary is the
    // thing the reader wants, so the entry appears with or without suggestions.
    if (suggestions.length === 0) {
      template.push({ label: 'No spelling suggestions', enabled: false });
    }

    template.push({ type: 'separator' });
    template.push({
      label: 'Add to Dictionary',
      click: () => actions.addToDictionary?.(misspelled),
    });
    template.push({ type: 'separator' });
  }

  const editable = params.isEditable === true;
  const hasSelection = typeof params.selectionText === 'string' && params.selectionText.trim().length > 0;

  if (editable || hasSelection) {
    if (editable) template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' });
    if (editable) template.push({ role: 'cut' });
    template.push({ role: 'copy' });
    if (editable) template.push({ role: 'paste' }, { role: 'pasteAndMatchStyle' });
    template.push({ role: 'selectAll' });
  }

  // A press on bare page furniture has nothing to offer; showing an empty box
  // is worse than showing nothing.
  return trimSeparators(template);
}

/** No menu should open, end, or double up on a divider. */
function trimSeparators(template) {
  const trimmed = [];
  template.forEach((item) => {
    if (item.type !== 'separator') { trimmed.push(item); return; }
    if (trimmed.length === 0) return;
    if (trimmed[trimmed.length - 1].type === 'separator') return;
    trimmed.push(item);
  });
  while (trimmed.length && trimmed[trimmed.length - 1].type === 'separator') trimmed.pop();
  return trimmed;
}

/**
 * Wire the menu onto a window's web contents.
 *
 * `replaceMisspelling` and `addWordToSpellCheckerDictionary` both live on the
 * contents/session rather than in the renderer, which is why this has to happen
 * in the main process.
 */
function installContextMenu({ Menu, webContents, window }) {
  webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, {
      replaceMisspelling: (suggestion) => webContents.replaceMisspelling(suggestion),
      addToDictionary: (word) => webContents.session.addWordToSpellCheckerDictionary(word),
    });
    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
}

module.exports = { MAX_SUGGESTIONS, buildContextMenuTemplate, installContextMenu };
