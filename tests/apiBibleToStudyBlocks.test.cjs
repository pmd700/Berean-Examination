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
