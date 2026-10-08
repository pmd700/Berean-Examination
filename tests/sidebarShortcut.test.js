import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSidebarToggleShortcut } from '../src/components/knowledgeweb/sidebarShortcut.js';

describe('Knowledge Web sidebar shortcut', () => {
  it('accepts Cmd + backslash on macOS', () => {
    assert.equal(isSidebarToggleShortcut({ metaKey: true, code: 'Backslash' }), true);
  });

  it('accepts Ctrl + backslash on Windows and Linux', () => {
    assert.equal(isSidebarToggleShortcut({ ctrlKey: true, key: '\\' }), true);
  });

  it('does not consume ordinary typing or modified pipe shortcuts', () => {
    assert.equal(isSidebarToggleShortcut({ key: '\\' }), false);
    assert.equal(isSidebarToggleShortcut({ metaKey: true, shiftKey: true, code: 'Backslash' }), false);
  });
});
