import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { searchLocalLibrary } from '../src/lib/localGlobalSearch.js';
import { joinBookPages, setPageTitle } from '../src/components/notes/bookModel.js';

const records = {
  chapters: [{
    id: 11,
    book: 'Genesis',
    chapter_number: 1,
    version: 'BSB',
    raw_text: 'In the beginning God created the heavens and the earth.',
    notes: '<p>Creation establishes order.</p>',
  }],
  annotations: [{
    id: 21,
    book: 'Genesis',
    chapter_number: 1,
    version: 'BSB',
    start_verse: 3,
    selected_text: 'Let there be light',
    content: '<p>Light before the sun.</p>',
  }],
  keywords: [{ id: 31, title: 'Covenant', category: 'Theology', explanation: 'A binding promise.' }],
  webs: [
    { id: 41, title: 'Gospel Threads', is_private: false },
    { id: 42, title: 'Private Research', is_private: true },
  ],
  cards: [
    { id: 51, web_id: 41, title: 'Resurrection', description: 'The empty tomb.' },
    { id: 52, web_id: 42, title: 'Hidden finding', description: 'Never expose this.' },
  ],
  notes: [{
    id: 61,
    title: 'Council notes',
    content: '<p>The exact conciliar phrase belongs in this paragraph.</p>',
  }],
  timegraphs: [{
    id: 71,
    title: 'Reformation chronology',
    events: [{
      id: 'event-luther',
      title: 'Luther posts the theses',
      description: 'The Wittenberg door marks this exact moment.',
      tags: ['reformation'],
    }],
  }],
};

test('book results identify the matching page, including independent page titles', () => {
  const notes = [{ id: 4, title: 'Book', content: joinBookPages([
    '<p>Opening</p>',
    setPageTitle('<p>The conscience speaks.</p>', 'Witness'),
    '<p>A different page.</p>',
  ]) }];
  const body = searchLocalLibrary({ notes }, 'conscience')[0];
  assert.equal(body.matchPage, 1);
  assert.equal(body.matchText, 'conscience');
  assert.equal(body.matchField, 'body');
  const title = searchLocalLibrary({ notes }, 'Witness')[0];
  assert.equal(title.matchPage, 1);
  assert.equal(title.matchField, 'title');
  assert.equal(title.workspaceTitle, 'Book');
});

test('a scattered-word result carries the actual word shown in its snippet', () => {
  const result = searchLocalLibrary({ notes: [{ id: 1, title: 'Grace', content: '<p>A clear conscience.</p>' }] }, 'grace conscience')[0];
  assert.equal(result.matchText, 'grace');
  assert.match(result.description, /Grace/);
});

test('searches locally saved Study chapters and opens the exact chapter', () => {
  const result = searchLocalLibrary(records, 'creation')[0];
  assert.equal(result.type, 'Chapter');
  assert.equal(result.href, '/Study?chapter_id=11');
  assert.equal(result.description.includes('<p>'), false);
});

test('opens an annotation through its locally saved parent chapter', () => {
  const result = searchLocalLibrary(records, 'light before')[0];
  assert.equal(result.type, 'Annotation');
  assert.equal(result.href, '/Study?chapter_id=11');
});

test('opens the exact keyword record', () => {
  const result = searchLocalLibrary(records, 'binding promise')[0];
  assert.equal(result.type, 'Keyword');
  assert.equal(result.href, '/Keywords?keyword_id=31');
});

test('opens the exact public Knowledge Web card and excludes private web contents', () => {
  const publicResult = searchLocalLibrary(records, 'empty tomb')[0];
  assert.equal(publicResult.type, 'Web Card');
  assert.equal(publicResult.href, '/knowledge-webs/gospel-threads-41?web=41&card=51');
  assert.deepEqual(searchLocalLibrary(records, 'hidden finding'), []);
});

test('finds text inside a Note and remembers that the body matched', () => {
  const result = searchLocalLibrary(records, 'exact conciliar phrase')[0];
  assert.equal(result.type, 'Note');
  assert.equal(result.href, '/notes/council-notes-61');
  assert.equal(result.matchField, 'body');
});

test('finds one exact Timeline event and carries its destination id', () => {
  const result = searchLocalLibrary(records, 'Wittenberg door')[0];
  assert.equal(result.type, 'Timeline Event');
  assert.equal(result.href, '/timegraphs/reformation-chronology-71');
  assert.equal(result.targetId, 'event-luther');
  assert.equal(result.matchField, 'body');
  assert.equal(result.workspaceTitle, 'Reformation chronology');
});

test('ranks title matches first and enforces a result limit', () => {
  const expanded = {
    ...records,
    keywords: [
      ...records.keywords,
      { id: 32, title: 'Creation', explanation: 'Exact title.' },
    ],
  };
  const results = searchLocalLibrary(expanded, 'creation', 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 32);
});

test('the visible global search has no server or cloud-function call', async () => {
  const source = await readFile(
    new URL('../src/components/search/GlobalSearch.jsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /base44|globalSearch|functions\.invoke|\/api\//);
  assert.match(source, /platformEntities\.StudyChapter\.list/);
  assert.match(source, /platformEntities\.MindNote\.list/);
  assert.match(source, /platformEntities\.Timegraph\.list/);
  assert.match(source, /toLocaleLowerCase\(\) === 'f'/);
  assert.match(source, /searchLocalLibrary/);
});

test('New Tab embeds the search bar instead of the old instructional sentence', async () => {
  const source = await readFile(
    new URL('../src/pages/LibraryHome.jsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /LibrarySpotlightSearch/);
  assert.doesNotMatch(source, /Choose what this tab becomes/);
});
