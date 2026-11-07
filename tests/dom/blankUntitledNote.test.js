import { describe, expect, it } from 'vitest';
import { isBlankUntitledNote } from '@/components/notes/isBlankUntitledNote';
import { PAGE_BREAK, setPageTitle } from '@/components/notes/bookModel';

describe('blank untitled note deletion exception', () => {
  it('accepts empty default titles and empty editor scaffolding across pages', () => {
    for (const title of ['', '   ', 'Untitled Note']) {
      expect(isBlankUntitledNote({ title, content: setPageTitle('<p><br></p>', '') + PAGE_BREAK + '<p>&nbsp;</p>' })).toBe(true);
    }
  });
  it('protects titles, text and content on other pages', () => {
    for (const note of [
      { title: 'Research' }, { content: '<p>Hello</p>' },
      { content: '<p></p>' + PAGE_BREAK + '<p>Keep me</p>' },
      { content: setPageTitle('', 'Page title') },
    ]) expect(isBlankUntitledNote(note)).toBe(false);
  });
  it('protects non-text content and structural objects', () => {
    for (const content of ['<img src="photo.png">', '<table><tbody><tr><td></td></tr></tbody></table>', '<span data-footnote-id="1"></span>', '<details><summary></summary></details>', '<hr>']) {
      expect(isBlankUntitledNote({ content })).toBe(false);
    }
  });
});
