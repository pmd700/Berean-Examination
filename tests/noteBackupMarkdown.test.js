import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNoteBackupMarkdown,
  extractNoteBackupHtml,
  extractNoteBackupPayload,
  stripNoteBackupPayload,
} from '../src/lib/noteBackupMarkdown.js';

test('note backup is readable Markdown and losslessly retains rich editor HTML', () => {
  const richHtml = [
    '<h2>Evidence</h2>',
    '<p>Readable <strong>text</strong>.</p>',
    '<table><tbody><tr><td data-colwidth="240">A</td><td>B</td></tr></tbody></table>',
    '<details data-type="details"><summary>Reason</summary><p>Hidden text</p></details>',
    '<img src="bex-media://image-1" alt="Chart">',
    '<div data-type="timegraph-embed" data-timegraph-id="42"></div>',
  ].join('');

  const markdown = buildNoteBackupMarkdown({
    title: 'A rich note',
    content: richHtml,
  });

  assert.match(markdown, /^# A rich note/m);
  assert.match(markdown, /## Evidence/);
  assert.match(markdown, /Readable \*\*text\*\*/);
  assert.match(markdown, /BEX-RICH-NOTE-V1:BEGIN/);
  assert.equal(extractNoteBackupHtml(markdown), richHtml);
});

test('note backup preserves an exact multiline title and ignores colliding user markers', () => {
  const title = 'First line\nSecond line';
  const richHtml = '<p>Exact body</p>';
  const markdown = buildNoteBackupMarkdown({ title, content: richHtml });
  const withTrailingCollision = `${markdown}\n<!-- BEX-RICH-NOTE-V1:BEGIN -->\nnot-base64!\n<!-- BEX-RICH-NOTE-V1:END -->\n`;

  assert.deepEqual(extractNoteBackupPayload(withTrailingCollision), {
    version: 1,
    title,
    html: richHtml,
  });
});

test('empty notes remain valid Markdown without an empty hidden payload', () => {
  const markdown = buildNoteBackupMarkdown({ title: 'Empty', content: '' });
  assert.equal(markdown, '# Empty\n');
  assert.equal(extractNoteBackupHtml(markdown), null);
});

test('truncated BEX rich-note metadata is rejected instead of silently losing rich content', () => {
  assert.throws(
    () => extractNoteBackupPayload('# Readable fallback\n\n<!-- BEX-RICH-NOTE-V1:BEGIN -->\n'),
    /payload is incomplete/i,
  );
});

test('case and whitespace-normalized markers restore and strip through one shared grammar', () => {
  const exact = buildNoteBackupMarkdown({ title: 'Styled', content: '<p>Exact rich body</p>' });
  const normalized = exact
    .replace('<!-- BEX-RICH-NOTE-V1:BEGIN -->', '<!--   bex-rich-note-v1:begin   -->')
    .replace('<!-- BEX-RICH-NOTE-V1:END -->', '<!-- bex-rich-note-v1:end -->');

  assert.deepEqual(extractNoteBackupPayload(normalized), {
    version: 1,
    title: 'Styled',
    html: '<p>Exact rich body</p>',
  });
  assert.doesNotMatch(stripNoteBackupPayload(normalized), /bex-rich-note-v1/i);
});

test('empty notes preserve titles that Markdown headings would reinterpret', () => {
  for (const title of ['*Important*', '`code`', 'Ends with #', 'C#']) {
    assert.deepEqual(extractNoteBackupPayload(buildNoteBackupMarkdown({ title, content: '' })), {
      version: 1,
      title,
      html: '',
    });
  }
});
