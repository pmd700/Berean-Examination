import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  importKnowledgeFiles,
  prepareMarkdownNote,
  titleFromFileName,
} from '../src/components/knowledgeweb/massKnowledgeImport.js';
import { buildNoteBackupMarkdown } from '../src/lib/noteBackupMarkdown.js';

function file(name, text) {
  return { name, size: Buffer.byteLength(text), text: async () => text };
}

describe('Knowledge Web mass import', () => {
  it('turns each .berean into a separate web and each Markdown file into a separate note in selection order', async () => {
    let nextId = 1;
    const arrivals = [];
    const result = await importKnowledgeFiles([
      file('first.berean', '{}'),
      file('study-notes.md', '# Romans 9\n\nA note with **bold** text.'),
      file('second.berean', '{}'),
    ], {
      parseBerean: async (selected) => ({ web: { title: selected.name.startsWith('first') ? 'First Web' : 'Second Web' }, cards: [], connections: [], canvasObjects: [] }),
      createKnowledgeWeb: async (title) => ({ id: nextId++, title }),
      commitKnowledgeWeb: async (id, payload) => ({ web: { id, title: payload.web.title }, report: { accepted: { cards: 0 } } }),
      deleteKnowledgeWeb: async () => {},
      createNote: async (note) => ({ id: nextId++, ...note }),
      renderMarkdown: (markdown) => `<p>${markdown}</p>`,
      onImported: async (item) => { arrivals.push(`${item.kind}:${item.record.title}`); },
    });
    assert.deepEqual(arrivals, ['web:First Web', 'note:Romans 9', 'web:Second Web']);
    assert.equal(result.imported.length, 3);
    assert.equal(result.failed.length, 0);
    assert.equal(result.imported[1].record.content, '<p>A note with **bold** text.</p>');
  });

  it('removes a newly-created empty web after a failed restore and continues importing later files', async () => {
    const deleted = [];
    const result = await importKnowledgeFiles([file('broken.berean', '{}'), file('good.md', 'Good')], {
      parseBerean: async () => ({ web: { title: 'Broken' } }),
      createKnowledgeWeb: async () => ({ id: 41, title: 'Broken' }),
      commitKnowledgeWeb: async () => { throw new Error('Damaged graph'); },
      deleteKnowledgeWeb: async (id) => { deleted.push(id); },
      createNote: async (note) => ({ id: 42, ...note }),
      renderMarkdown: (markdown) => `<p>${markdown}</p>`,
    });
    assert.deepEqual(deleted, [41]);
    assert.equal(result.failed[0].fileName, 'broken.berean');
    assert.equal(result.imported[0].record.title, 'good');
  });

  it('uses a clean filename fallback and strips hidden Knowledge Web restore machinery from Markdown notes', () => {
    assert.equal(titleFromFileName('my-study_notes.md'), 'my study notes');
    const prepared = prepareMarkdownNote('# Visible title\n\nBody\n<!-- BEREAN_KNOWLEDGE_WEB:BEGIN\nsecret-payload\nBEREAN_KNOWLEDGE_WEB:END -->', 'fallback.md');
    assert.equal(prepared.title, 'Visible title');
    assert.equal(prepared.markdown, 'Body');
  });

  it('restores the exact rich-note payload and title from a library export .md file', async () => {
    const title = 'First line\nSecond line';
    const richHtml = [
      '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>',
      '<details><summary>Reason</summary><p>Hidden</p></details>',
      '<img src="bex-media://image-1" alt="Chart">',
      '<div data-type="timegraph-embed" data-timegraph-id="42"></div>',
    ].join('');
    const markdown = buildNoteBackupMarkdown({ title, content: richHtml });
    let renderedProjection = false;

    const result = await importKnowledgeFiles([file('rich-note.md', markdown)], {
      createNote: async (note) => ({ id: 91, ...note }),
      renderMarkdown: () => {
        renderedProjection = true;
        return '<p>lossy projection</p>';
      },
    });

    assert.equal(result.failed.length, 0);
    assert.equal(result.imported[0].record.title, title);
    assert.equal(result.imported[0].record.content, richHtml);
    assert.equal(renderedProjection, false);
  });
});
