import { expect, it } from 'vitest';
import { parseHtmlOrTextContentToBlocks } from '@/lib/apiBibleToStudyBlocks';
import { buildInlineVerseParts } from '@/lib/inlineVerseNotes';

it('preserves the HTML publisher note position before a word and inside punctuation, accounting for whitespace', () => {
  const [verse] = parseHtmlOrTextContentToBlocks('<p><span class="v">18</span>  Simon <span class="f" caller="a">A publisher note</span><span class="wj">Barjona</span><span class="f" caller="b">Another publisher note</span>, next. </p>');
  expect(verse.text).toBe('Simon Barjona, next.');
  expect(verse.notes.map(note => note.offset)).toEqual([6, 13]);
  expect(buildInlineVerseParts(verse.text, verse.notes).map(part => part.type === 'text' ? part.text : `[${part.note.caller}]`).join('')).toBe('Simon [a]Barjona[b], next.');
  expect([...verse.wjTokens]).toEqual([2]);
});
