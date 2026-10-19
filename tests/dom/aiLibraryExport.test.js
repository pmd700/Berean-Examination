import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { buildAiLibraryMarkdown, prepareAiLibraryExport, readAiLibrarySnapshot } from '@/lib/aiLibraryExport';
import { richTextToAiMarkdown, referenceAnchor } from '@/lib/aiExportMarkdown';
import { buildKnowledgeWebMarkdown, parseKnowledgeWebMarkdown } from '@/components/knowledgeweb/markdownFileFormat';
import { listAllEntityRecords } from '@/lib/allLocalEntityRecords';
import { commentaryLinkHref } from '@/lib/commentaryLink';
import { encryptJson, encryptString } from '@/lib/webCrypto';

const empty = () => ({ notes: [], webs: [], cards: [], connections: [], objects: [], timelines: [], commentaries: [], studies: [], keywords: [], drawings: [], mindLinks: [], folders: [], studyObjects: [], studyConnections: [] });
const entityTypes = { MindNote: 'notes', KnowledgeWeb: 'webs', Timegraph: 'timelines', Keyword: 'keywords', Annotation: 'commentaries', StudyChapter: 'studies', WebCard: 'cards', WebConnection: 'connections', CanvasObject: 'objects', Drawing: 'drawings', MindLink: 'mindLinks', WebFolder: 'folders', StudyCanvasObject: 'studyObjects', StudyConnection: 'studyConnections' };
const entities = snapshot => Object.fromEntries(Object.entries(entityTypes).map(([type, key]) => [type, { listPage: vi.fn(async ({ cursor, limit }) => {
  const records = snapshot[key].filter(row => Number(row.id) > (cursor || 0)).slice(0, limit);
  return { records, nextCursor: records.length === limit ? records.at(-1).id : null };
}) }]));
afterEach(() => { vi.unstubAllGlobals(); delete window.bexDesktop; });

describe('one readable AI library document', () => {
  it('preserves every book page, hidden body, author commentary, edition, keyword, timeline event, card and canvas object with resolvable references', () => {
    const snapshot = empty();
    const annotation = { id: 6, book: 'Matthew', chapter_number: 16, start_verse: 18, end_verse: 19, version: 'API:a761ca71e0b3ddcf-01', selected_text: 'Scripture anchor.', content: '<p>AUTHOR_ARGUMENT_FINAL.</p>' };
    snapshot.notes = [{ id: 1, title: 'A book', content: '<!--bex-page-title:First--><details><summary>Closed heading</summary><div data-type="detailsContent"><p>HIDDEN_MATERIAL.</p></div></details><!--bex-page-break--><!--bex-page-title:Second--><p><a href="' + commentaryLinkHref(annotation) + '">Commentary evidence</a> <span data-keyword-id="3">Word</span></p>' }];
    snapshot.webs = [{ id: 2, title: 'Web', description: '<p>WEB_DESCRIPTION.</p>' }];
    snapshot.cards = [{ id: 8, web_id: 2, title: 'Position A', description: '<ol><li>FIRST_CARD_ITEM.</li><li>SECOND_CARD_ITEM.</li></ol>' }, { id: 9, web_id: 2, title: 'Position B', description: '<p>OTHER_CARD.</p>' }];
    snapshot.objects = [{ id: 4, web_id: 2, object_type: 'text', content: '<p>CANVAS_TEXT.</p>' }];
    snapshot.connections = [{ id: 5, web_id: 2, from_card_id: 8, to_card_id: 9, has_arrow: true, label: 'contradicts' }];
    snapshot.timelines = [{ id: 10, title: 'Ancient chronology', events: [
      { id: 'later', title: 'Later', start: { year: 2, precision: 'year' }, description: '<p>LATER_DESCRIPTION.</p>', links: [{ kind: 'note', id: 1 }] },
      { id: 'earlier', title: 'Early', start: { year: 0, precision: 'approximate' }, end: { year: 1, precision: 'year' }, description: '<p>EARLIER_DESCRIPTION.</p>', links: [{ kind: 'web-card', id: 8 }] },
      { id: 'same', title: 'Same date', start: { year: 0, precision: 'year' }, description: '<p>EQUAL_DATE_DESCRIPTION.</p>' },
      { id: 'unknown', title: 'No date', start: 'uncertain', description: '<p>UNDATED_REMAINS.</p>' },
    ] }];
    snapshot.commentaries = [annotation];
    snapshot.keywords = [{ id: 3, title: 'Petra', category: 'Greek', explanation: '<p>KEYWORD_DEFINITION.</p>' }];
    const result = buildAiLibraryMarkdown(snapshot, { exportedAt: '2026-10-14T18:00:00Z' });
    for (const phrase of ['HIDDEN_MATERIAL.', 'FIRST_CARD_ITEM.', 'SECOND_CARD_ITEM.', 'OTHER_CARD.', 'CANVAS_TEXT.', 'EARLIER_DESCRIPTION.', 'EQUAL_DATE_DESCRIPTION.', 'UNDATED_REMAINS.', 'KEYWORD_DEFINITION.', 'AUTHOR_ARGUMENT_FINAL.', 'API:a761ca71e0b3ddcf-01', 'NASB 2020', 'contradicts']) expect(result.text).toContain(phrase);
    expect(result.text).toContain(commentaryLinkHref(annotation));
    expect(result.text).toContain('c. 1 BCE');
    expect(result.text).toContain('Same start-date group');
    expect(result.text).toContain('do not imply causation');
    expect(result.text).toContain('Unparsed: "uncertain"');
    expect(result.text).toContain(`id="${referenceAnchor('commentary:6')}"`);
    expect(result.text).toContain('keyword mention');
    expect(result.text).not.toContain('BEREAN_KNOWLEDGE_WEB:BEGIN');
    expect(result.text).not.toContain('BEX_NOTE_BACKUP');
    expect(result.counts).toMatchObject({ notes: 1, pages: 2, webs: 1, cards: 2, timelines: 1, events: 4, commentaries: 1, keywords: 1 });
  });

  it('walks rich annotations, nested numbered lists, merged tables, formulas and all media references without hiding or duplicating attached text', () => {
    const context = { sourceId: 'note:1/page:1', relationships: [], assets: [] };
    const html = `<ol start="4"><li><p>First <span data-comment-id="c1" data-comment-text="&lt;p&gt;COMMENT_BODY.&lt;/p&gt;">anchor</span></p><ul><li>Nested bullet.</li></ul></li><li>Second <sup data-footnote-id="f1" data-footnote-text="&lt;p&gt;FOOTNOTE_BODY.&lt;/p&gt;"></sup></li></ol>
      <table><tr><th colspan="2">Heading</th></tr><tr><td><p>Cell one</p><p>Cell two</p></td><td><span data-tooltip-id="t1" data-tooltip-text="TOOLTIP_BODY.">Hint</span></td></tr></table>
      <p><span data-logic-source="∀x P(x)">formula</span><span data-pointer-id="p1" data-pointer-role="source">A</span><span data-pointer-id="p1" data-pointer-role="target">B</span></p>
      <div data-timegraph-id="5"></div><span data-drawing-id="7"></span><img src="data:image/png;base64,SECRET_BINARY" alt="Map caption"><div data-bex-file="true" data-file-url="bex-attachment://vault/abc" data-file-name="Evidence.pdf"></div>`;
    const text = richTextToAiMarkdown(html, context);
    expect(text).toContain('4. First'); expect(text).toContain('5. Second'); expect(text).toContain('Nested bullet.');
    expect(text).toContain('column span 2'); expect(text).toContain('Cell one\n\n  Cell two');
    for (const phrase of ['COMMENT_BODY.', 'FOOTNOTE_BODY.', 'TOOLTIP_BODY.']) expect(text.split(phrase)).toHaveLength(2);
    expect(text).toContain('source: A → target: B'); expect(text).toContain('∀x P(x)');
    expect(text).toContain('Evidence.pdf'); expect(text).toContain('Map caption'); expect(text).not.toContain('SECRET_BINARY');
    expect(context.relationships).toEqual(expect.arrayContaining([expect.objectContaining({ target: 'timeline:5' }), expect.objectContaining({ target: 'drawing:7' })]));
    expect(context.assets).toHaveLength(2);
  });

  it('reuses the web Markdown exporter without changing the ordinary exact-restore export', () => {
    const source = { web: { id: 1, title: 'Web' }, cards: [{ id: 1, title: 'A', description: '<p>Full card.</p>' }], connections: [], canvasObjects: [] };
    const normal = buildKnowledgeWebMarkdown(source);
    expect(parseKnowledgeWebMarkdown(normal)).toBeTruthy();
    const readable = buildKnowledgeWebMarkdown({ ...source, readableOnly: true });
    expect(readable).toContain('Full card.'); expect(readable).toContain('web:1/card:1'); expect(readable).not.toContain('BEREAN_KNOWLEDGE_WEB:BEGIN');
  });

  it('keeps code literal and indexes real reference links and balanced media URLs', () => {
    const context = { sourceId: 'note:1', relationships: [], assets: [] };
    const markdown = 'Example:\n```html\n<p>literal tag</p>\n\n\n[not a relationship](/notes/999)\n```\n\n[Real page][evidence]\n\n[evidence]: /notes/2?page=3\n\n![Diagram](https://example.test/map_(large).png)\n\n![Embedded][binary]\n\n[binary]: data:image/png;base64,SECRET_BINARY';
    const text = richTextToAiMarkdown(markdown, context);
    expect(text).toContain('<p>literal tag</p>\n\n\n[not a relationship](/notes/999)');
    expect(context.relationships).toEqual([expect.objectContaining({ target: 'note:2/page:3' })]);
    expect(context.assets).toEqual(expect.arrayContaining([expect.objectContaining({ reference: 'https://example.test/map_(large).png' })]));
    expect(text).not.toContain('SECRET_BINARY');
    const html = richTextToAiMarkdown('<p>Literal <code>a  `b`</code></p><pre><code>first\n\n\n  last &lt;p&gt;</code></pre>');
    expect(html).toContain('`` a  `b` ``');
    expect(html).toContain('first\n\n\n  last <p>');
  });

  it('distinguishes cards from routing points with the same ID and exports embedded canvas relationships', () => {
    const snapshot = empty();
    snapshot.webs = [{ id: 1, title: 'First web' }, { id: 2, title: 'Linked web' }];
    snapshot.cards = [{ id: 1, web_id: 1, title: 'Card one', description: 'Idea.' }];
    snapshot.objects = [{ id: 1, web_id: 1, object_type: 'point' }, { id: 2, web_id: 1, object_type: 'timegraph', timegraph_id: 8 }, { id: 3, web_id: 1, object_type: 'web_link', link_web_id: 2 }];
    snapshot.connections = [{ id: 1, web_id: 1, from_card_id: 1, from_kind: 'card', to_card_id: 1, to_kind: 'point', has_arrow: true, label: 'route' }];
    snapshot.timelines = [{ id: 8, title: 'Embedded chronology', events: [] }];
    const result = buildAiLibraryMarkdown(snapshot);
    expect(result.text).toContain('C1["Card one"]');
    expect(result.text).toContain('O1(("organization point 1"))');
    expect(result.text).toContain(`${referenceAnchor('web:1/card:1')}) → [web:1/object:1]`);
    expect(result.text).toContain('embedded timeline');
    expect(result.text).toContain('linked knowledge web');
    expect(result.warningCount).toBe(0);
  });

  it('preserves malformed date parts without fabricating a year or silently downgrading precision', () => {
    const snapshot = empty();
    snapshot.timelines = [{ id: 1, events: [{ id: 'missing', start: { year: null, precision: 'year' }, description: 'Unknown.' }, { id: 'invalid-end', start: { year: 33, precision: 'year' }, end: { year: 34, month: 2, day: 31, precision: 'exact' } }] }];
    const result = buildAiLibraryMarkdown(snapshot);
    expect(result.text).toContain('Start: Unparsed: {"year":null');
    expect(result.text).toContain('End: Unparsed: {"year":34,"month":2,"day":31');
    expect(result.text).toContain('end date unparsed or invalid');
    expect(result.warningCount).toBe(2);
  });

  it('does not drop unresolved references or duplicate saved event IDs silently', () => {
    const snapshot = empty();
    snapshot.notes = [{ id: 1, title: 'References', content: '<p><a href="/notes/999?page=2">Missing page</a></p>' }];
    const result = buildAiLibraryMarkdown(snapshot);
    expect(result.warningCount).toBe(1); expect(result.text).toContain('note:999/page:2'); expect(result.text).toContain('target missing');
    snapshot.timelines = [{ id: 3, events: [{ id: 'duplicate', description: 'A' }, { id: 'duplicate', description: 'B' }] }];
    expect(() => buildAiLibraryMarkdown(snapshot)).toThrow('Duplicate source ID');
    snapshot.timelines = [];
    snapshot.cards = [{ id: 4, web_id: 999, description: 'Orphaned idea.' }];
    expect(() => buildAiLibraryMarkdown(snapshot)).toThrow('no parent Knowledge Web');
  });

  it('uses the adopted API edition for older commentary records while preserving their original ID and locator', () => {
    const snapshot = empty();
    snapshot.studies = [{ id: 1, book: 'Matthew', chapter_number: 16, version: 'NASB1995', display_version: 'NASB1995', api_bible_id: 'b8ee27bcd1cae43a-01' }];
    snapshot.commentaries = [{ id: 7, book: 'Matthew', chapter_number: 16, start_verse: 18, end_verse: 18, version: 'NASB1995', content: 'OLDER_WRITING.' }];
    const result = buildAiLibraryMarkdown(snapshot);
    expect(result.text).toContain('Source ID: commentary:7');
    expect(result.text).toContain('Stored source locator: NASB1995');
    expect(result.text).toContain('Canonical edition identity: API:b8ee27bcd1cae43a-01');
    expect(result.text).toContain('&annotation_id=7&version=API%3Ab8ee27bcd1cae43a-01');
  });
});

describe('complete and current snapshot', () => {
  it('includes study cards and permanent verse relationships without copying downloaded Scripture', () => {
    const snapshot = empty();
    snapshot.studyObjects = [{ id: 5, object_type: 'card', title: 'My argument', content: '<p>A saved study idea.</p>', x: 0, y: 0 }];
    snapshot.studyConnections = [{ id: 9, from: { kind: 'verse', book: 'isaiah', chapter: 22, verse: 13 }, to: { kind: 'object', id: 5 }, label: 'Supports', style: 'curvy' }];
    const result = buildAiLibraryMarkdown(snapshot);
    expect(result.text).toContain('A saved study idea.');
    expect(result.text).toContain('Source ID: study-object:5');
    expect(result.text).toContain('Source ID: study-connection:9');
    expect(result.text).toContain('From: Verse isaiah 22:13');
    expect(result.text).toContain('To: study-object:5');
  });
  it('uses the atomic desktop snapshot and rejects incomplete responses without falling back to partial reads', async () => {
    const readLocalEntitySnapshot = vi.fn(async types => ({ ok: true, snapshot: Object.fromEntries(types.map(type => [type, type === 'MindNote' ? [{ id: 1, content: 'ATOMIC_WRITING.' }] : []])) }));
    window.bexDesktop = { isDesktop: true, readLocalEntitySnapshot };
    const result = await readAiLibrarySnapshot();
    expect(result.notes[0].content).toBe('ATOMIC_WRITING.');
    expect(readLocalEntitySnapshot.mock.calls[0][0]).toHaveLength(14);
    readLocalEntitySnapshot.mockResolvedValue({ ok: true, snapshot: { MindNote: [] } });
    await expect(readAiLibrarySnapshot()).rejects.toThrow('incomplete');
  });

  it('reads beyond a full page and rejects malformed cursors, duplicates and read failures', async () => {
    const snapshot = empty(); snapshot.notes = Array.from({ length: 1003 }, (_, i) => ({ id: i + 1, content: `NOTE_${i + 1}` }));
    const client = entities(snapshot);
    const read = await readAiLibrarySnapshot({ entities: client });
    expect(read.notes).toHaveLength(1003); expect(client.MindNote.listPage).toHaveBeenCalledTimes(2);
    await expect(listAllEntityRecords({ listPage: async () => ({ records: [{ id: 1 }, { id: 1 }], nextCursor: 1 }) })).rejects.toThrow('duplicate');
    await expect(listAllEntityRecords({ listPage: async () => ({ records: [], nextCursor: 0 }) })).rejects.toThrow('cursor');
    client.Keyword.listPage.mockRejectedValue(new Error('Disk read failed'));
    await expect(readAiLibrarySnapshot({ entities: client })).rejects.toThrow('Disk read failed');
  });

  it('flushes edits before reading and retries a changing snapshot instead of mixing versions', async () => {
    const snapshot = empty(); snapshot.notes = [{ id: 1, title: 'Saved', content: 'STALE_WRITING' }];
    const settle = vi.fn(async () => { snapshot.notes[0].content = settle.mock.calls.length === 1 ? 'FIRST_SAVE' : 'LATEST_SAVE'; });
    const revision = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValue(1);
    const result = await prepareAiLibraryExport({ entities: entities(snapshot), settle, revision });
    expect(settle).toHaveBeenCalledTimes(2); expect(result.text).toContain('LATEST_SAVE'); expect(result.text).not.toContain('STALE_WRITING'); expect(result.text).not.toContain('FIRST_SAVE');
  });

  it('requires every private web key and decrypts each web with its own key without exporting ciphertext', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const snapshot = empty();
    snapshot.webs = [{ id: 2, title: '🔒', is_private: true, enc_name: await encryptString(key, 'Private writing') }];
    snapshot.cards = [{ id: 3, web_id: 2, title: '🔒', description: '🔒', enc_payload: await encryptJson(key, { title: 'Private card', description: '<p>DECRYPTED_IDEA.</p>' }) }];
    const client = entities(snapshot);
    await expect(prepareAiLibraryExport({ entities: client, settle: async () => {}, getKey: () => null })).rejects.toMatchObject({ lockedWebs: [{ id: 2 }] });
    const result = await prepareAiLibraryExport({ entities: client, settle: async () => {}, getKey: () => key });
    expect(result.text).toContain('DECRYPTED_IDEA.'); expect(result.text).not.toContain(snapshot.cards[0].enc_payload); expect(result.text).not.toContain(snapshot.webs[0].enc_name); expect(result.text).not.toContain('🔒');
    snapshot.cards[0].enc_payload = 'bad cipher';
    await expect(prepareAiLibraryExport({ entities: client, settle: async () => {}, getKey: () => key })).rejects.toThrow('decrypt');
  });

  it('stops for failed pending saves and canceled exports before reading the library', async () => {
    const client = entities(empty());
    await expect(prepareAiLibraryExport({ entities: client, settle: async () => { throw new Error('Could not save commentary'); } })).rejects.toThrow('Could not save commentary');
    const abort = new AbortController(); abort.abort();
    await expect(prepareAiLibraryExport({ entities: client, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.MindNote.listPage).not.toHaveBeenCalled();
  });

  it('allows cancellation between collection pages and while converting a large library', async () => {
    const abort = new AbortController();
    const listPage = vi.fn(async () => { abort.abort(); return { records: [{ id: 1 }], nextCursor: 1 }; });
    await expect(listAllEntityRecords({ listPage }, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(listPage).toHaveBeenCalledTimes(1);
    const snapshot = empty();
    snapshot.notes = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, title: `Note ${i}`, content: '<p>Writing with a <strong>complex</strong> idea.</p>'.repeat(30) }));
    const conversionAbort = new AbortController();
    let cancelScheduled = false;
    await expect(prepareAiLibraryExport({ entities: entities(snapshot), settle: async () => {}, signal: conversionAbort.signal, onProgress: progress => {
      if (progress === 'Converting notes and book pages' && !cancelScheduled) { cancelScheduled = true; setTimeout(() => conversionAbort.abort(), 0); }
    } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelScheduled).toBe(true);
  });
});
