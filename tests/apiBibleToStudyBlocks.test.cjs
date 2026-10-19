'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

async function getModule() {
  return await import('../src/lib/apiBibleToStudyBlocks.js');
}

test('extracts plain text and accurately computes wj token indices', async () => {
  const { computeWjTokens, convertApiBibleContentToBlocks } = await getModule();

  const mockData = {
    content: [
      {
        type: 'tag',
        name: 'para',
        attrs: { style: 'p' },
        items: [
          { type: 'tag', name: 'verse', attrs: { number: '1' } },
          { type: 'text', text: 'To the angel write: ' },
          {
            type: 'tag',
            name: 'char',
            attrs: { style: 'wj' },
            items: [
              { type: 'text', text: 'These are the words of Him who holds the seven stars.' },
            ],
          },
        ],
      },
    ],
  };

  const blocks = convertApiBibleContentToBlocks(mockData, 1);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'verse');
  assert.equal(blocks[0].verseNumber, 1);
  assert.equal(
    blocks[0].text,
    'To the angel write: These are the words of Him who holds the seven stars.'
  );

  // Verify that tokens inside "These are the words of Him who holds the seven stars." are in wjTokens
  const tokens = blocks[0].text.split(/(\s+)/);
  // tokens:
  // [0] 'To', [1] ' ', [2] 'the', [3] ' ', [4] 'angel', [5] ' ', [6] 'write:', [7] ' ',
  // [8] 'These', [9] ' ', [10] 'are', ...
  assert.equal(blocks[0].wjTokens.has(0), false); // 'To'
  assert.equal(blocks[0].wjTokens.has(2), false); // 'the'
  assert.equal(blocks[0].wjTokens.has(4), false); // 'angel'
  assert.equal(blocks[0].wjTokens.has(6), false); // 'write:'
  assert.equal(blocks[0].wjTokens.has(8), true);  // 'These'
  assert.equal(blocks[0].wjTokens.has(10), true); // 'are'
});

test('builds study chapter from multi-group batch results', async () => {
  const { buildStudyChapterFromBatch } = await getModule();
  const { parseScriptureQuery } = await import('../src/lib/scriptureReferences.js');

  const query = 'revelation 4:1; Col 1:1';
  const parsed = parseScriptureQuery(query);

  const batchResults = [
    {
      data: {
        content: [
          {
            type: 'tag',
            name: 'para',
            attrs: { style: 'p' },
            items: [
              { type: 'tag', name: 'verse', attrs: { number: '1' } },
              { type: 'text', text: 'After this I looked, and behold, a door standing open in heaven!' },
            ],
          },
        ],
      },
    },
    {
      data: {
        content: [
          {
            type: 'tag',
            name: 'para',
            attrs: { style: 'p' },
            items: [
              { type: 'tag', name: 'verse', attrs: { number: '1' } },
              { type: 'text', text: 'Paul, an apostle of Christ Jesus by the will of God.' },
            ],
          },
        ],
      },
    },
  ];

  const chapter = buildStudyChapterFromBatch(parsed, batchResults, 'BSB');
  assert.equal(chapter.book, 'Revelation');
  assert.equal(chapter.version, 'BSB');
  assert.ok(chapter.blocks.length >= 4); // header, verse, header, verse
  assert.equal(chapter.blocks[0].type, 'header');
  assert.equal(chapter.blocks[0].text, 'Revelation 4:1');
  assert.equal(chapter.blocks[1].type, 'verse');
  assert.equal(chapter.blocks[1].verseNumber, 1);
  assert.equal(chapter.blocks[2].type, 'header');
  assert.equal(chapter.blocks[2].text, 'Colossians 1:1');
  assert.equal(chapter.blocks[3].type, 'verse');
  assert.equal(chapter.blocks[3].verseNumber, 1);
});

test('robustly splits multiple verses and separates footnotes from verse text', async () => {
  const { convertApiBibleContentToBlocks } = await getModule();

  // Simulates Romans 3:1-2 AST with section header, verses 1 & 2, and footnote
  const mockChapterData = {
    content: [
      {
        name: 'para',
        type: 'tag',
        attrs: { style: 's1' },
        items: [{ type: 'text', text: 'God Remains Faithful' }],
      },
      {
        name: 'para',
        type: 'tag',
        attrs: { style: 'p' },
        items: [
          {
            name: 'char',
            type: 'tag',
            attrs: { style: 'v' },
            items: [{ type: 'text', text: '1' }],
          },
          {
            type: 'text',
            text: 'What, then, is the advantage of being a Jew? Or what is the value of circumcision?',
          },
          {
            name: 'char',
            type: 'tag',
            attrs: { style: 'v' },
            items: [{ type: 'text', text: '2' }],
          },
          {
            type: 'text',
            text: 'Much in every way. First of all, they have been entrusted with the very words of God.',
          },
          {
            name: 'note',
            type: 'tag',
            attrs: { style: 'f', caller: '+' },
            items: [
              { name: 'char', type: 'tag', attrs: { style: 'fr' }, items: [{ type: 'text', text: '3:2 ' }] },
              { name: 'char', type: 'tag', attrs: { style: 'ft' }, items: [{ type: 'text', text: 'Or the oracles of God.' }] },
            ],
          },
          {
            name: 'char',
            type: 'tag',
            attrs: { style: 'v' },
            items: [{ type: 'text', text: '3' }],
          },
          {
            type: 'text',
            text: 'What if some did not have faith? Will their lack of faith nullify God’s faithfulness?',
          },
        ],
      },
    ],
  };

  const blocks = convertApiBibleContentToBlocks(mockChapterData, 1);
  assert.equal(blocks.length, 4); // 1 header + 3 separate verses

  // Header
  assert.equal(blocks[0].type, 'header');
  assert.equal(blocks[0].text, 'God Remains Faithful');

  // Verse 1
  assert.equal(blocks[1].type, 'verse');
  assert.equal(blocks[1].verseNumber, 1);
  assert.equal(blocks[1].text, 'What, then, is the advantage of being a Jew? Or what is the value of circumcision?');
  assert.equal(blocks[1].notes.length, 0);

  // Verse 2
  assert.equal(blocks[2].type, 'verse');
  assert.equal(blocks[2].verseNumber, 2);
  assert.equal(blocks[2].text, 'Much in every way. First of all, they have been entrusted with the very words of God.');
  assert.equal(blocks[2].notes.length, 1);
  assert.equal(blocks[2].notes[0].caller, '+');
  assert.equal(blocks[2].notes[0].text, '3:2 Or the oracles of God.');
  assert.equal(blocks[2].notes[0].type, 'footnote');

  // Verse 3
  assert.equal(blocks[3].type, 'verse');
  assert.equal(blocks[3].verseNumber, 3);
  assert.equal(blocks[3].text, 'What if some did not have faith? Will their lack of faith nullify God’s faithfulness?');
  assert.equal(blocks[3].notes.length, 0);
});

test('preserves exact inline note offsets through leading whitespace and red-letter spans', async () => {
  const { convertApiBibleContentToBlocks } = await getModule();
  const tag = (name, attrs, items) => ({ type: 'tag', name, attrs, items });
  const text = text => ({ type: 'text', text });
  const note = (caller, body) => tag('note', { style: 'f', caller }, [
    tag('char', { style: 'fr' }, [text('16:18 ')]),
    tag('char', { style: 'ft' }, [text('Meaning: '), tag('char', { style: 'it' }, [text(body)])]),
  ]);
  const blocks = convertApiBibleContentToBlocks({ content: [tag('para', { style: 'p' }, [
    tag('verse', { number: '18' }),
    tag('char', { style: 'wj' }, [text('  Simon '), note('a', 'first'), text('Barjona, and '), note('b', 'second'),
      text('Peter'), note('c', 'third'), text('.  ')]),
  ])] });
  assert.equal(blocks[0].text, 'Simon Barjona, and Peter.');
  assert.deepEqual(blocks[0].notes.map(note => note.offset), [6, 19, 24]);
  assert.equal(blocks[0].text.slice(blocks[0].notes[0].offset).split(' ')[0], 'Barjona,');
  assert.deepEqual(blocks[0].notes[0].noteSegments, [{ type: 'text', text: 'Meaning: ' }, { type: 'italic', text: 'first' }]);
  assert.deepEqual([...blocks[0].wjTokens], [0, 2, 4, 6]);
});

test('inline markers never change scripture tokens, including punctuation and consecutive notes', async () => {
  const { buildInlineVerseParts } = await import('../src/lib/inlineVerseNotes.js');
  const text = 'Word, next.';
  const parts = buildInlineVerseParts(text, [{ offset: 4, caller: 'a' }, { offset: 4, caller: 'b' }, { offset: 6, caller: 'c' }]);
  assert.equal(parts.filter(part => part.type === 'text').map(part => part.text).join(''), text);
  assert.deepEqual(parts.map(part => part.type === 'text' ? part.text : `[${part.note.caller}]`), ['Word', '[a]', '[b]', ',', ' ', '[c]', 'next.']);
  assert.deepEqual(parts.filter(part => part.type === 'text').map(part => part.tokenIndex), [0, 0, 1, 2]);
  assert.deepEqual(buildInlineVerseParts(text, [{ caller: '*' }]).at(-1).note, { caller: '*' });
});
