import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPagesMarkdown, pageToMarkdown } from '../src/components/notes/bookExport.js';
import { setPageTitle } from '../src/components/notes/bookModel.js';

// Exactly what the editor serializes: `<` and `>` inside an attribute value are
// not escaped, only `&` and `"` are.
const PAGE_ONE = '<p>The first claim<sup data-footnote-id="fn-1" data-footnote-text="<p>Bauckham, 122.</p>" class="bex-footnote"></sup>.</p>';
const PAGE_TWO = '<p>The second claim<sup data-footnote-id="fn-2" data-footnote-text="<p>Wright, 84.</p>" class="bex-footnote"></sup>.</p>';

describe('exporting pages as Markdown', () => {
  it('turns footnotes into real Markdown references with their bodies', () => {
    const markdown = pageToMarkdown(PAGE_ONE, 0);
    assert.match(markdown, /The first claim\[\^1\]\./);
    assert.match(markdown, /^\[\^1\]: Bauckham, 122\.$/m);
  });

  it('keeps the numbering when a page is exported out of the middle of a book', () => {
    const markdown = pageToMarkdown(PAGE_TWO, 11);
    assert.match(markdown, /\[\^12\]/);
    assert.match(markdown, /^\[\^12\]: Wright, 84\.$/m);
  });

  it('carries a tooltip across as an inline aside rather than dropping it', () => {
    const html = '<p>the <span data-tooltip-id="tip-1" data-tooltip-text="<p>Second Temple period</p>" class="bex-tooltip">Second Temple</span> era</p>';
    assert.match(pageToMarkdown(html), /the Second Temple\^\[Second Temple period\] era/);
  });

  it('leaves an ordinary span alone', () => {
    const html = '<p>plain <span class="whatever">text</span> here</p>';
    assert.match(pageToMarkdown(html), /plain text here/);
  });

  it('exports only the pages that were selected, under their real numbers', () => {
    const markdown = buildPagesMarkdown({
      title: 'On the Resurrection',
      pages: ['<p>One</p>', PAGE_ONE, '<p>Three</p>', PAGE_TWO],
      indices: [3, 1],
    });
    assert.match(markdown, /^# On the Resurrection$/m);
    assert.match(markdown, /^## Page 2$/m);
    assert.match(markdown, /^## Page 4$/m);
    assert.doesNotMatch(markdown, /^## Page 1$/m);
    assert.doesNotMatch(markdown, /^## Page 3$/m);
    // Page 4's footnote is the second in the book, so it stays note 2.
    assert.match(markdown, /^\[\^2\]: Wright, 84\.$/m);
  });

  it('exports the whole book when nothing in particular was selected', () => {
    const markdown = buildPagesMarkdown({ title: 'Notes', pages: ['<p>One</p>', '<p>Two</p>'], indices: [] });
    assert.match(markdown, /^## Page 1$/m);
    assert.match(markdown, /^## Page 2$/m);
  });

  it('uses each independent page title without leaking its metadata', () => {
    const markdown = buildPagesMarkdown({
      title: 'Book Title',
      pages: [
        setPageTitle('<p>First body</p>', 'Book Title'),
        setPageTitle('<p>Second body</p>', 'Evidence and Objections'),
      ],
      indices: [],
    });

    assert.match(markdown, /^# Book Title$/m);
    assert.match(markdown, /^## Evidence and Objections$/m);
    assert.doesNotMatch(markdown, /bex-page-title/);
  });

  it('leaves a one-page note without page headings it does not need', () => {
    const markdown = buildPagesMarkdown({ title: 'Notes', pages: ['<p>Only</p>'], indices: [0] });
    assert.doesNotMatch(markdown, /## Page/);
    assert.match(markdown, /Only/);
  });
});
