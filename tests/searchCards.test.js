import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Node has no DOMParser, so this run covers the regex fallback path; the
// DOMParser path is exercised in the browser.
import { searchCards, htmlToPlainText, MATCH_KIND } from '../src/components/knowledgeweb/searchCards.js';

const cards = [
  {
    id: 1,
    title: 'Positive Schism',
    tags: ['ecclesiology'],
    scripture_refs: ['1 Corinthians 1:10'],
    description: '<p>The sin of separation from a body <strong>to form</strong> a new one.</p>',
  },
  {
    id: 2,
    title: 'Jurisdiction',
    tags: ['missions'],
    scripture_refs: ['Romans 15:20'],
    description: '<p>I aspired to preach the gospel, not where Christ was already known by name.</p>',
  },
  {
    id: 3,
    title: 'Unrelated card',
    tags: [],
    scripture_refs: [],
    description: '<p>Nothing to see.</p><p>Ends here</p><p>and continues.</p>',
  },
];

describe('knowledge web card search', () => {
  it('finds a card by words inside its body, not just the title', () => {
    const hits = searchCards(cards, 'gospel');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].card.id, 2);
    assert.equal(hits[0].kind, MATCH_KIND.CONTENT);
  });

  it('shows the surrounding line so a body hit explains itself', () => {
    const [hit] = searchCards(cards, 'gospel');
    assert.equal(hit.snippet.match, 'gospel');
    assert.match(hit.snippet.before, /aspired to preach the $/);
    assert.match(hit.snippet.after, /^, not where Christ/);
  });

  it('ranks a title hit above a body hit for the same word', () => {
    const withBodyMention = [
      ...cards,
      { id: 4, title: 'Another', description: '<p>mentions Jurisdiction in passing</p>' },
    ];
    const hits = searchCards(withBodyMention, 'jurisdiction');
    assert.deepEqual(hits.map(h => h.card.id), [2, 4]);
    assert.equal(hits[0].kind, MATCH_KIND.TITLE);
    assert.equal(hits[1].kind, MATCH_KIND.CONTENT);
  });

  it('still matches tags and scripture references', () => {
    assert.equal(searchCards(cards, 'missions')[0].kind, MATCH_KIND.TAG);
    assert.equal(searchCards(cards, 'romans')[0].kind, MATCH_KIND.SCRIPTURE);
  });

  it('searches what the card shows, not its markup', () => {
    // "strong" is a tag name and "p" a tag; neither is readable text.
    assert.deepEqual(searchCards(cards, 'strong'), []);
    // Text split across formatting still reads as one phrase.
    assert.equal(searchCards(cards, 'body to form a new one')[0].card.id, 1);
  });

  it('keeps block boundaries apart instead of running words together', () => {
    assert.equal(htmlToPlainText('<p>Ends here</p><p>and continues.</p>'), 'Ends here and continues.');
    assert.deepEqual(searchCards(cards, 'hereand'), []);
  });

  it('returns nothing for an empty query', () => {
    assert.deepEqual(searchCards(cards, '   '), []);
  });
});
