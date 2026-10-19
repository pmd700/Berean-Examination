import { describe, it, expect, afterEach } from 'vitest';
import { selectedScriptureTokens } from '@/lib/scriptureSelection';

afterEach(() => document.body.replaceChildren());
function fixture() {
  document.body.innerHTML = `<main data-scripture-root="true"><div data-study-chapter-id="a"><p><span data-token-key="token-1-0-0"><i>First</i></span><span> </span><span data-token-key="token-1-2-0">word</span></p><p><span data-token-key="token-2-0-1">Second</span><span> </span><span data-token-key="token-2-2-1">verse</span></p></div><div data-study-chapter-id="b"><span data-token-key="token-1-0-2">Other chapter</span></div></main>`;
  return document.querySelector('main');
}
describe('Scripture selection token mapping', () => {
  it('resolves whole verses whose browser boundaries are container elements', () => {
    const root = fixture(), range = document.createRange();
    range.selectNodeContents(root.firstChild);
    expect(selectedScriptureTokens(range, root)).toEqual({ chapterId: 'a', startVerse: 1, startToken: 0, endVerse: 2, endToken: 2 });
  });
  it('accepts a selection ending on a space and excludes an untouched word at offset zero', () => {
    const root = fixture(), p = root.querySelector('p'), range = document.createRange();
    range.setStart(p.querySelector('i').firstChild, 1);
    range.setEnd(p.children[1].firstChild, 1);
    expect(selectedScriptureTokens(range, root)).toMatchObject({ startVerse: 1, startToken: 0, endToken: 0 });
    range.setEnd(p.children[2].firstChild, 0);
    expect(selectedScriptureTokens(range, root)).toMatchObject({ endToken: 0 });
  });
  it('does not highlight a neighbouring word for whitespace-only selections', () => {
    const root = fixture(), range = document.createRange();
    range.selectNodeContents(root.querySelector('p').children[1]);
    expect(selectedScriptureTokens(range, root)).toBeNull();
  });
  it('rejects cross-chapter selections even when verse numbers repeat', () => {
    const root = fixture(), range = document.createRange(); range.selectNodeContents(root);
    expect(selectedScriptureTokens(range, root)).toEqual({ crossChapter: true });
  });
  it('scopes selection to its own study reader, including when other tabs are mounted', () => {
    const root = fixture(), other = root.cloneNode(true); document.body.prepend(other);
    const range = document.createRange(); range.selectNodeContents(root.querySelector('p'));
    expect(selectedScriptureTokens(range, other)).toBeNull();
    expect(selectedScriptureTokens(range, root)).toMatchObject({ chapterId: 'a', startToken: 0, endToken: 2 });
  });
});
