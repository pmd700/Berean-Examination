import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FindInEditor, findMatches, getFindState } from '@/components/editor/findInEditor';

/**
 * Find and replace, against a real document.
 *
 * The risk worth testing is not "does it find the word". It is that ignoring
 * diacritics changes the length of the text being searched, so a match found in
 * the folded string has to be measured back into document positions through a
 * map. Get that wrong and replace does not merely miss — it cuts the wrong
 * characters out of someone's writing.
 */

let editor;

function mount(content) {
  editor = new Editor({ extensions: [StarterKit, FindInEditor], content });
  return editor;
}

afterEach(() => { editor?.destroy(); editor = null; });
beforeEach(() => { editor = null; });

const text = () => editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');

function find(term, options) {
  if (options) editor.commands.setFindOptions(options);
  editor.commands.setFindTerm(term);
  return getFindState(editor.state);
}

describe('finding', () => {
  it('counts every occurrence, ignoring case by default', () => {
    mount('<p>You and you and YOU</p>');
    expect(find('you').matches).toHaveLength(3);
  });

  it('respects match case when asked', () => {
    mount('<p>You and you and YOU</p>');
    expect(find('you', { matchCase: true }).matches).toHaveLength(1);
  });

  it('matches across a bold word inside one paragraph', () => {
    mount('<p>the <strong>living</strong> word</p>');
    expect(find('living word').matches).toHaveLength(1);
  });

  it('never runs a match across a paragraph boundary', () => {
    mount('<p>the living</p><p>word</p>');
    expect(find('living word').matches).toHaveLength(0);
  });

  it('finds an accented word from its plain spelling', () => {
    mount('<p>a café on the corner</p>');
    expect(find('cafe').matches).toHaveLength(1);
    expect(find('cafe', { ignoreDiacritics: false }).matches).toHaveLength(0);
  });

  it('finds pointed Hebrew from its unpointed spelling', () => {
    // The pointed form carries its vowel as a separate combining mark, so the
    // folded text is shorter than the original — the case the map exists for.
    mount('<p>אַב and אב</p>');
    expect(find('אב').matches).toHaveLength(2);
  });

  it('takes a regular expression when told to', () => {
    mount('<p>vv.2 and vv.3 and vv.10</p>');
    expect(find('vv\\.\\d+', { regex: true }).matches).toHaveLength(3);
  });

  it('treats a half-typed expression as no matches, not a crash', () => {
    mount('<p>anything at all</p>');
    expect(() => find('(', { regex: true })).not.toThrow();
    expect(getFindState(editor.state).matches).toHaveLength(0);
  });

  it('reports matches as document positions the editor can act on', () => {
    mount('<p>techelet</p>');
    const [match] = findMatches(editor.state.doc, 'techelet');
    expect(editor.state.doc.textBetween(match.from, match.to)).toBe('techelet');
  });
});

describe('replacing', () => {
  it('replaces the match being stood on and leaves the rest', () => {
    mount('<p>you and you</p>');
    find('you');
    editor.commands.replaceFindMatch('we');
    expect(text()).toBe('we and you');
  });

  it('carries on down the document as it is pressed', () => {
    mount('<p>you and you and you</p>');
    find('you');
    editor.commands.replaceFindMatch('we');
    editor.commands.replaceFindMatch('we');
    expect(text()).toBe('we and we and you');
  });

  it('replaces every match at once', () => {
    mount('<p>you and you and you</p>');
    find('you');
    editor.commands.replaceAllFindMatches('we');
    expect(text()).toBe('we and we and we');
  });

  it('replaces all in one undoable step', () => {
    mount('<p>you and you and you</p>');
    find('you');
    editor.commands.replaceAllFindMatches('we');
    editor.commands.undo();
    expect(text()).toBe('you and you and you');
  });

  it('cuts exactly the accented word, not the letters beside it', () => {
    // Measured through the map: the pointed word is longer than what was
    // searched, so a replacement measured by folded index would eat a neighbour.
    mount('<p>a café here</p>');
    find('cafe');
    editor.commands.replaceFindMatch('bakery');
    expect(text()).toBe('a bakery here');
  });

  it('cuts a pointed Hebrew word whole, mark and all', () => {
    mount('<p>x אַב y</p>');
    find('אב');
    editor.commands.replaceFindMatch('Z');
    expect(text()).toBe('x Z y');
  });

  it('keeps the formatting the replaced word was wearing', () => {
    mount('<p>the <strong>living</strong> word</p>');
    find('living');
    editor.commands.replaceFindMatch('written');
    expect(editor.getHTML()).toContain('<strong>written</strong>');
  });

  it('works capture groups into the replacement', () => {
    mount('<p>Maimon, Moses</p>');
    find('(\\w+), (\\w+)', { regex: true });
    editor.commands.replaceFindMatch('$2 $1');
    expect(text()).toBe('Moses Maimon');
  });

  it('deletes the word when the replacement is empty', () => {
    mount('<p>a very long sentence</p>');
    find('very ');
    editor.commands.replaceAllFindMatches('');
    expect(text()).toBe('a long sentence');
  });

  it('does nothing at all when there is no match to replace', () => {
    mount('<p>unchanged</p>');
    find('missing');
    expect(editor.commands.replaceFindMatch('x')).toBe(false);
    expect(editor.commands.replaceAllFindMatches('x')).toBe(false);
    expect(text()).toBe('unchanged');
  });

  it('re-counts the remaining matches after a replacement', () => {
    mount('<p>you and you and you</p>');
    find('you');
    editor.commands.replaceFindMatch('we');
    expect(getFindState(editor.state).matches).toHaveLength(2);
  });
});
