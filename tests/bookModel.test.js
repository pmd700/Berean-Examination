import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PAGE_BREAK,
  countFootnotes,
  extractFootnotes,
  footnoteOffsets,
  getPageBody,
  getPageTitle,
  hasPageTitle,
  insertPageAfter,
  isBook,
  joinBookPages,
  movePage,
  numberFootnotesInHtml,
  pageIndexAfterMove,
  removePages,
  replacePage,
  replacePageBody,
  setPageTitle,
  splitBookPages,
} from '../src/components/notes/bookModel.js';

const footnote = (id, text = '') =>
  `<sup data-footnote-id="${id}"${text ? ` data-footnote-text="${text}"` : ''}></sup>`;

describe('splitting a note into pages', () => {
  it('treats a plain note as page one of a book nobody has split yet', () => {
    assert.deepEqual(splitBookPages('<p>Romans</p>'), ['<p>Romans</p>']);
    assert.equal(isBook(splitBookPages('<p>Romans</p>')), false);
  });

  it('returns one empty page for an empty or missing note', () => {
    assert.deepEqual(splitBookPages(''), ['']);
    assert.deepEqual(splitBookPages(null), ['']);
    assert.deepEqual(splitBookPages(undefined), ['']);
  });

  it('round-trips a book through join and split unchanged', () => {
    const pages = ['<p>One</p>', '<p>Two</p>', '<p>Three</p>'];
    assert.deepEqual(splitBookPages(joinBookPages(pages)), pages);
    assert.equal(isBook(pages), true);
  });

  it('keeps a blank page rather than collapsing it away', () => {
    const pages = ['<p>One</p>', '', '<p>Three</p>'];
    const stored = joinBookPages(pages);
    assert.equal(stored, `<p>One</p>${PAGE_BREAK}${PAGE_BREAK}<p>Three</p>`);
    assert.deepEqual(splitBookPages(stored), pages);
  });
});

describe('independent page titles', () => {
  it('keeps title metadata out of the rich-text body', () => {
    const page = setPageTitle('<p>Body</p>', 'Why “Torah” matters --> today');
    assert.equal(hasPageTitle(page), true);
    assert.equal(getPageTitle(page), 'Why “Torah” matters --> today');
    assert.equal(getPageBody(page), '<p>Body</p>');
  });

  it('supports legacy pages by using a fallback title', () => {
    assert.equal(hasPageTitle('<p>Old page</p>'), false);
    assert.equal(getPageTitle('<p>Old page</p>', 'Existing note title'), 'Existing note title');
  });

  it('renames only the selected page', () => {
    const pages = [
      setPageTitle('<p>One</p>', 'The Book'),
      setPageTitle('<p>Two</p>', 'Second Page'),
      setPageTitle('<p>Three</p>', 'Third Page'),
    ];
    const renamed = [...pages];
    renamed[1] = setPageTitle(renamed[1], 'A New Second Page');

    assert.equal(getPageTitle(renamed[0]), 'The Book');
    assert.equal(getPageTitle(renamed[1]), 'A New Second Page');
    assert.equal(getPageTitle(renamed[2]), 'Third Page');
  });

  it('preserves a page title when its editor body changes', () => {
    const pages = [setPageTitle('<p>Before</p>', 'Chapter One')];
    const changed = replacePageBody(pages, 0, '<p>After</p>');

    assert.equal(getPageTitle(changed[0]), 'Chapter One');
    assert.equal(getPageBody(changed[0]), '<p>After</p>');
    assert.equal(replacePageBody(changed, 0, '<p>After</p>'), changed);
  });
});

describe('footnote numbering across a book', () => {
  it('counts the footnotes on a page straight from its markup', () => {
    assert.equal(countFootnotes(`<p>a${footnote('fn-1')}b${footnote('fn-2')}</p>`), 2);
    assert.equal(countFootnotes('<p>nothing here</p>'), 0);
    assert.equal(countFootnotes(null), 0);
  });

  it('carries the count forward so page three continues where page two stopped', () => {
    const pages = [
      `<p>a${footnote('fn-1')}b${footnote('fn-2')}</p>`,
      `<p>c${footnote('fn-3')}</p>`,
      `<p>d${footnote('fn-4')}</p>`,
    ];
    assert.deepEqual(footnoteOffsets(pages), [0, 2, 3]);
  });

  it('numbers a page from its offset, not from one', () => {
    const found = extractFootnotes(`<p>a${footnote('fn-9')}b${footnote('fn-10')}</p>`, 6);
    assert.deepEqual(found.map(item => item.number), [7, 8]);
    assert.deepEqual(found.map(item => item.id), ['fn-9', 'fn-10']);
  });

  it('unescapes a footnote body that was stored in an attribute', () => {
    const html = `<p>x<sup data-footnote-id="fn-1" data-footnote-text="&lt;p&gt;Cited &amp;quot;here&amp;quot;&lt;/p&gt;"></sup></p>`;
    assert.equal(extractFootnotes(html)[0].text, '<p>Cited &quot;here&quot;</p>');
  });

  it('reads a body whose own tags are unescaped, which is what the editor writes', () => {
    // Attribute serialization escapes `&` and `"` and leaves `<`/`>` alone, so a
    // tag has to be matched a quoted run at a time — scanning to the first `>`
    // would truncate this footnote to "<p".
    const html = '<p>Paul<sup data-footnote-id="fn-1" data-footnote-text="<p>Bauckham, 122.</p>" class="bex-footnote"></sup></p>';
    const [found] = extractFootnotes(html);
    assert.equal(found.id, 'fn-1');
    assert.equal(found.text, '<p>Bauckham, 122.</p>');
    assert.match(numberFootnotesInHtml(html, 0), /data-footnote-text="<p>Bauckham, 122\.<\/p>"/);
  });

  it('leaves a superscript the writer typed themselves alone', () => {
    const html = '<p>E = mc<sup>2</sup> and a note' + footnote('fn-1') + '</p>';
    assert.equal(extractFootnotes(html).length, 1);
    assert.equal(countFootnotes(html), 1);
    assert.match(numberFootnotesInHtml(html, 0), /<sup>2<\/sup>/);
  });

  it('bakes the number into the markup for anything that is not the live editor', () => {
    const numbered = numberFootnotesInHtml(`<p>a${footnote('fn-1')}b${footnote('fn-2')}</p>`, 4);
    assert.match(numbered, /data-footnote-number="5">5<\/sup>/);
    assert.match(numbered, /data-footnote-number="6">6<\/sup>/);
  });

  it('does not stack a second number onto markup that already carries one', () => {
    const once = numberFootnotesInHtml(`<p>${footnote('fn-1')}</p>`, 0);
    const twice = numberFootnotesInHtml(once, 0);
    assert.equal((twice.match(/data-footnote-number/g) || []).length, 1);
  });
});

describe('adding and removing pages', () => {
  it('adds a blank page after the one being read and moves onto it', () => {
    const { pages, index } = insertPageAfter(['<p>One</p>', '<p>Two</p>'], 0);
    assert.deepEqual(pages, ['<p>One</p>', '', '<p>Two</p>']);
    assert.equal(index, 1);
  });

  it('deletes the selected pages and keeps the reader near where they were', () => {
    const { pages, index, removed } = removePages(['a', 'b', 'c', 'd'], [0, 1], 2);
    assert.deepEqual(pages, ['c', 'd']);
    assert.equal(index, 0);
    assert.equal(removed, 2);
  });

  it('never leaves a note with no page to write on', () => {
    const { pages, index } = removePages(['a', 'b'], [0, 1], 1);
    assert.deepEqual(pages, ['']);
    assert.equal(index, 0);
  });

  it('ignores a selection that names pages the book does not have', () => {
    const { pages, removed } = removePages(['a', 'b'], [7, -1], 0);
    assert.deepEqual(pages, ['a', 'b']);
    assert.equal(removed, 0);
  });

  it('clamps the landing page when everything after it was deleted', () => {
    const { index } = removePages(['a', 'b', 'c'], [1, 2], 2);
    assert.equal(index, 0);
  });

  it('replaces one page without disturbing the others', () => {
    const pages = ['a', 'b', 'c'];
    assert.deepEqual(replacePage(pages, 1, 'B'), ['a', 'B', 'c']);
    // An identical write returns the same array so React can skip the update.
    assert.equal(replacePage(pages, 1, 'b'), pages);
    assert.equal(replacePage(pages, 9, 'x'), pages);
  });

  it('moves a page to a new position', () => {
    assert.deepEqual(movePage(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
    assert.deepEqual(movePage(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
    assert.deepEqual(movePage(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
  });

  it('keeps the reader attached to the same page while pages move around it', () => {
    assert.equal(pageIndexAfterMove(0, 0, 2, 3), 2);
    assert.equal(pageIndexAfterMove(1, 0, 2, 3), 0);
    assert.equal(pageIndexAfterMove(1, 2, 0, 3), 2);
    assert.equal(pageIndexAfterMove(0, 2, 0, 3), 1);
  });
});
