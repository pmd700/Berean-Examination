import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_SCOPES,
  TIMEGRAPH_FILE_KIND,
  docxParts,
  exportFileName,
  exportFrame,
  fromJson,
  resolveScope,
  toCsv,
  toJson,
  wrapSvg,
} from '../src/lib/timegraph/timegraphExport.js';
import { normalizeTimegraph } from '../src/lib/timegraph/timegraphModel.js';
import { createViewport, visibleRange } from '../src/lib/timegraph/timegraphScale.js';

function sampleGraph() {
  return normalizeTimegraph({
    title: 'Reformation',
    description: 'Key dates',
    events: [
      { id: 'a', title: 'Luther born', start: '10 nov 1483', tags: ['people'], color: 'gold' },
      { id: 'b', title: 'Exsurge Domine', start: '1520', position: 'below', marker: 'ring' },
      { id: 'c', title: 'Council of Trent', start: '1545', end: '1563', color: 'teal' },
      { id: 'd', title: 'First Olympiad', start: '776 BCE' },
      { id: 'e', title: 'Earth forms', start: 'c. 4.54 billion BCE' },
    ],
  });
}

describe('timegraph export scopes', () => {
  test('all includes every event and frames them', () => {
    const graph = sampleGraph();
    const scoped = resolveScope(graph, { scope: EXPORT_SCOPES.ALL });
    assert.equal(scoped.events.length, 5);
    assert.ok(scoped.from < -4e9);
    assert.ok(scoped.to >= 1563);
  });

  test('current view includes only what is on screen', () => {
    const graph = sampleGraph();
    const viewport = createViewport({ centerYear: 1520, yearsPerPixel: 0.1, width: 1000 });
    const scoped = resolveScope(graph, { scope: EXPORT_SCOPES.VIEW, viewport });
    const range = visibleRange(viewport);
    assert.ok(scoped.events.length > 0 && scoped.events.length < 5);
    for (const event of scoped.events) {
      assert.ok(event.start.year <= range.to + 1);
    }
    assert.equal(scoped.events.some((event) => event.id === 'e'), false);
  });

  test('a range spanning into view is included, not skipped', () => {
    const graph = sampleGraph();
    // A window inside Trent's 1545–1563 span but containing neither endpoint.
    const scoped = resolveScope(graph, { scope: EXPORT_SCOPES.RANGE, from: 1550, to: 1555 });
    assert.deepEqual(scoped.events.map((event) => event.id), ['c']);
  });

  test('selection exports exactly the chosen events', () => {
    const graph = sampleGraph();
    const scoped = resolveScope(graph, {
      scope: EXPORT_SCOPES.SELECTION,
      selectedIds: ['a', 'c'],
    });
    assert.deepEqual(scoped.events.map((event) => event.id), ['a', 'c']);
  });

  test('a custom range keeps its own bounds even when empty', () => {
    const scoped = resolveScope(sampleGraph(), {
      scope: EXPORT_SCOPES.RANGE, from: 1900, to: 1950,
    });
    assert.equal(scoped.events.length, 0);
    assert.equal(scoped.from, 1900);
    assert.equal(scoped.to, 1950);
  });
});

describe('timegraph export framing', () => {
  test('the frame grows so stacked cards are never cropped', () => {
    // Ten events on the same year force ten lanes.
    const crowded = normalizeTimegraph({
      events: Array.from({ length: 10 }, (_, i) => ({
        id: `x${i}`, title: `Simultaneous event number ${i}`, start: '1500',
      })),
    });
    const sparse = normalizeTimegraph({
      events: [{ id: 'y', title: 'Alone', start: '1500' }],
    });
    const crowdedFrame = exportFrame(crowded.events, { from: 1495, to: 1505 });
    const sparseFrame = exportFrame(sparse.events, { from: 1495, to: 1505 });
    assert.ok(
      crowdedFrame.height > sparseFrame.height,
      `crowded ${crowdedFrame.height} should exceed sparse ${sparseFrame.height}`,
    );
  });

  test('the frame grows for enlarged cards too', () => {
    const normal = normalizeTimegraph({
      events: Array.from({ length: 5 }, (_, i) => ({
        id: `normal-${i}`, title: `Event ${i}`, start: '1500', scale: 1,
      })),
    });
    const enlarged = normalizeTimegraph({
      events: Array.from({ length: 5 }, (_, i) => ({
        id: `large-${i}`, title: `Event ${i}`, start: '1500', scale: 2.5,
      })),
    });
    const normalFrame = exportFrame(normal.events, { from: 1495, to: 1505 });
    const enlargedFrame = exportFrame(enlarged.events, { from: 1495, to: 1505 });
    assert.ok(enlargedFrame.height > normalFrame.height);
  });

  test('the frame spans the requested years with padding on both sides', () => {
    const frame = exportFrame(sampleGraph().events, { from: 1500, to: 1600, width: 1600 });
    const range = visibleRange(frame);
    assert.ok(range.from < 1500, 'left edge should be padded');
    assert.ok(range.to > 1600, 'right edge should be padded');
  });
});

describe('timegraph JSON round trip', () => {
  test('export then import reproduces every event exactly', () => {
    const graph = sampleGraph();
    const { timegraph: restored, dropped } = fromJson(toJson(graph));
    assert.equal(dropped, 0);
    assert.equal(restored.title, graph.title);
    assert.equal(restored.description, graph.description);
    assert.equal(restored.events.length, graph.events.length);
    for (const original of graph.events) {
      const copy = restored.events.find((event) => event.id === original.id);
      assert.ok(copy, `${original.id} missing after round trip`);
      assert.deepEqual(copy, original);
    }
  });

  test('the saved view survives the round trip', () => {
    const graph = normalizeTimegraph({
      ...sampleGraph(),
      view: { centerYear: 1520, yearsPerPixel: 0.25 },
    });
    assert.deepEqual(fromJson(toJson(graph)).timegraph.view, {
      centerYear: 1520, yearsPerPixel: 0.25,
    });
  });

  test('the file declares its kind and version', () => {
    const parsed = JSON.parse(toJson(sampleGraph()));
    assert.equal(parsed.kind, TIMEGRAPH_FILE_KIND);
    assert.equal(parsed.version, 1);
    assert.ok(parsed.exported_at);
  });

  test('a bare timegraph object is accepted too', () => {
    const bare = JSON.stringify({ title: 'Bare', events: [{ title: 'x', start: '1500' }] });
    assert.equal(fromJson(bare).timegraph.events.length, 1);
  });

  test('exporting a subset writes only that subset', () => {
    const graph = sampleGraph();
    const scoped = resolveScope(graph, { scope: EXPORT_SCOPES.SELECTION, selectedIds: ['b'] });
    const parsed = JSON.parse(toJson(graph, { events: scoped.events }));
    assert.equal(parsed.timegraph.events.length, 1);
    assert.equal(parsed.timegraph.events[0].title, 'Exsurge Domine');
  });

  test('unreadable files are refused with a usable message', () => {
    assert.throws(() => fromJson('not json'), /not valid JSON/);
    assert.throws(() => fromJson('null'), /does not contain a timegraph/);
    assert.throws(() => fromJson('{"title":"x"}'), /no events list/);
    assert.throws(
      () => fromJson(JSON.stringify({ kind: TIMEGRAPH_FILE_KIND, version: 99, timegraph: { events: [] } })),
      /newer version/,
    );
  });

  test('import reports events it had to drop', () => {
    const text = JSON.stringify({
      kind: TIMEGRAPH_FILE_KIND,
      version: 1,
      timegraph: { title: 'Mixed', events: [{ title: 'ok', start: '1500' }, { title: 'no date' }] },
    });
    const result = fromJson(text);
    assert.equal(result.timegraph.events.length, 1);
    assert.equal(result.dropped, 1);
  });
});

describe('timegraph CSV', () => {
  test('writes a header and one row per event', () => {
    const csv = toCsv(sampleGraph().events);
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 6);
    assert.match(lines[0], /^title,description,start,end/);
  });

  test('quotes commas and escapes embedded quotes', () => {
    const csv = toCsv([{
      title: 'Diet of Worms, 1521',
      description: 'He said "here I stand"',
      start: { year: 1521, month: null, day: null, precision: 'year' },
      end: null, color: 'violet', position: 'above', align: 'center',
      marker: 'dot', scale: 1, tags: [], media: [], links: [],
    }]);
    assert.match(csv, /"Diet of Worms, 1521"/);
    assert.match(csv, /"He said ""here I stand"""/);
  });

  test('neutralises spreadsheet formula injection', () => {
    const csv = toCsv([{
      title: '=HYPERLINK("http://evil.test")',
      description: '', start: { year: 1500, month: null, day: null, precision: 'year' },
      end: null, color: 'violet', position: 'above', align: 'center',
      marker: 'dot', scale: 1, tags: [], media: [], links: [],
    }]);
    assert.match(csv, /'=HYPERLINK/);
  });

  test('BCE dates export in readable form alongside the numeric year', () => {
    const csv = toCsv(sampleGraph().events.filter((event) => event.id === 'd'));
    assert.match(csv, /776 BCE/);
    assert.match(csv, /-775/);
  });
});

describe('timegraph DOCX', () => {
  test('produces every part Word requires', () => {
    const parts = docxParts(sampleGraph(), sampleGraph().events);
    for (const name of [
      '[Content_Types].xml', '_rels/.rels',
      'word/_rels/document.xml.rels', 'word/document.xml',
    ]) {
      assert.ok(parts[name], `missing ${name}`);
      assert.match(parts[name], /^<\?xml/);
    }
  });

  test('includes the title and every event heading', () => {
    const graph = sampleGraph();
    const xml = docxParts(graph, graph.events)['word/document.xml'];
    assert.match(xml, /Reformation/);
    for (const event of graph.events) {
      assert.ok(xml.includes(event.title), `${event.title} missing from document.xml`);
    }
  });

  test('escapes XML so a title with markup cannot break the file', () => {
    const xml = docxParts({ title: 'A & B <tag>' }, [])['word/document.xml'];
    assert.match(xml, /A &amp; B &lt;tag&gt;/);
    assert.equal(xml.includes('<tag>'), false);
  });
});

describe('timegraph SVG wrapper', () => {
  test('adds a prolog, an explicit size and an opaque background', () => {
    const wrapped = wrapSvg('<svg width="100%" height="400"><g/></svg>', {
      width: 1600, height: 520,
    });
    assert.match(wrapped, /^<\?xml version="1\.0"/);
    assert.match(wrapped, /width="1600"/);
    assert.match(wrapped, /height="520"/);
    assert.match(wrapped, /<rect x="0" y="0" width="1600" height="520"/);
  });

  test('does not double up the XML prolog', () => {
    const wrapped = wrapSvg('<?xml version="1.0"?><svg width="10" height="10"></svg>', {
      width: 20, height: 20,
    });
    assert.equal(wrapped.match(/<\?xml/g).length, 1);
  });
});

describe('timegraph file names', () => {
  test('are safe, dated and carry the scope', () => {
    const name = exportFileName('Luther / Reformation!', 'png', EXPORT_SCOPES.VIEW);
    assert.match(name, /^Luther-Reformation-view-\d{4}-\d{2}-\d{2}\.png$/);
  });

  test('fall back to a default when the title is unusable', () => {
    assert.match(exportFileName('!!!', 'json', EXPORT_SCOPES.ALL), /^timegraph-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
