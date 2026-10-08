import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_YEAR,
  MAX_YEAR,
  PRECISION,
  eventSpan,
  formatDateRange,
  formatTimePoint,
  formatYear,
  fromYearValue,
  parseTimeInput,
  toYearValue,
} from '../src/lib/timegraph/timegraphDate.js';
import {
  axisTicks,
  createViewport,
  cursorReadout,
  focusedAxisTicks,
  clampYearsPerPixel,
  MAX_YEARS_PER_PIXEL,
  MIN_YEARS_PER_PIXEL,
  tickStep,
  viewportForRange,
  visibleRange,
  xToYear,
  yearToX,
  zoomAt,
  zoomFactorFromWheel,
} from '../src/lib/timegraph/timegraphScale.js';
import {
  estimateCardWidth,
  layoutEvents,
  packIntoLanes,
  eventsBounds,
  placementAt,
  requiredHeight,
} from '../src/lib/timegraph/timegraphLayout.js';
import {
  collectTags,
  createEvent,
  createHistory,
  duplicateEvent,
  filterEvents,
  moveEventToYear,
  normalizeEvent,
  normalizeTimegraph,
  pushHistory,
  redoHistory,
  removeEvent,
  undoHistory,
  upsertEvent,
} from '../src/lib/timegraph/timegraphModel.js';

describe('timegraph dates', () => {
  test('parses a plain year', () => {
    assert.deepEqual(parseTimeInput('1521'), {
      year: 1521, month: null, day: null, precision: PRECISION.YEAR,
    });
  });

  test('parses an exact day in several written forms', () => {
    const expected = { year: 1521, month: 1, day: 3, precision: PRECISION.EXACT };
    assert.deepEqual(parseTimeInput('3 jan 1521'), expected);
    assert.deepEqual(parseTimeInput('January 3, 1521'), expected);
    assert.deepEqual(parseTimeInput('1521-01-03'), expected);
  });

  test('parses an approximate date as "c."', () => {
    const point = parseTimeInput('c. 1514');
    assert.equal(point.precision, PRECISION.APPROXIMATE);
    assert.equal(point.year, 1514);
    assert.equal(formatTimePoint(point), 'c. 1514 CE');
  });

  test('BCE years use astronomical numbering so year zero exists', () => {
    // 1 BCE is astronomical year 0; 776 BCE is -775.
    assert.equal(parseTimeInput('1 BCE').year, 0);
    assert.equal(parseTimeInput('776 BCE').year, -775);
    assert.equal(formatYear(0), '1 BCE');
    assert.equal(formatYear(-775), '776 BCE');
    assert.equal(formatYear(33), '33 CE');
  });

  test('AD prefix and CE suffix both mean the common era', () => {
    assert.equal(parseTimeInput('AD 33').year, 33);
    assert.equal(parseTimeInput('33 CE').year, 33);
  });

  test('parses deep-time magnitudes', () => {
    const point = parseTimeInput('13.8 billion BCE');
    assert.equal(point.year, 1 - 13.8e9);
    assert.equal(formatTimePoint(point), 'c. 13.8 billion BCE');
  });

  test('accepts the full required range and clamps beyond it', () => {
    assert.equal(parseTimeInput('100 billion BCE').year, 1 - 100e9);
    assert.ok(parseTimeInput('100 billion BCE').year >= MIN_YEAR);
    assert.equal(normalizeEvent({ start: { year: 5e11 } }).start.year, MAX_YEAR);
  });

  test('rejects unreadable input rather than guessing', () => {
    assert.equal(parseTimeInput(''), null);
    assert.equal(parseTimeInput('sometime soon'), null);
    assert.equal(parseTimeInput('   '), null);
  });

  test('year values order correctly across the era boundary', () => {
    const bce = toYearValue(parseTimeInput('44 BCE'));
    const ce = toYearValue(parseTimeInput('33 CE'));
    assert.ok(bce < 0 && ce > 0 && bce < ce);
  });

  test('month and day advance the year fraction', () => {
    const jan = toYearValue({ year: 1500, month: 1, day: 1, precision: PRECISION.EXACT });
    const jul = toYearValue({ year: 1500, month: 7, day: 1, precision: PRECISION.EXACT });
    assert.equal(jan, 1500);
    assert.ok(jul > 1500.4 && jul < 1500.6);
  });

  test('fromYearValue round-trips an exact date', () => {
    const point = { year: 1521, month: 4, day: 18, precision: PRECISION.EXACT };
    const back = fromYearValue(toYearValue(point), PRECISION.EXACT);
    assert.deepEqual(back, point);
  });

  test('formats a range with both endpoints', () => {
    const label = formatDateRange(parseTimeInput('1517'), parseTimeInput('1521'));
    assert.equal(label, '1517 CE – 1521 CE');
  });

  test('an end equal to the start is a point, not a range', () => {
    const event = normalizeEvent({ title: 'x', start: '1517', end: '1517' });
    assert.equal(event.end, null);
    assert.equal(eventSpan(event).isRange, false);
  });

  test('a reversed range is drawn in order', () => {
    const span = eventSpan(normalizeEvent({ title: 'x', start: '1521', end: '1517' }));
    assert.equal(span.start, 1517);
    assert.equal(span.end, 1521);
    assert.equal(span.isRange, true);
  });
});

describe('timegraph scale', () => {
  test('pinching zooms faster without changing ordinary two-finger zoom', () => {
    const ordinaryOut = zoomFactorFromWheel(20);
    const pinchOut = zoomFactorFromWheel(20, { pinch: true });
    const ordinaryIn = zoomFactorFromWheel(-20);
    const pinchIn = zoomFactorFromWheel(-20, { pinch: true });

    assert.equal(ordinaryOut, Math.exp(20 * 0.0016));
    assert.ok(pinchOut > ordinaryOut);
    assert.ok(pinchIn < ordinaryIn);
  });

  const viewport = createViewport({ centerYear: 1500, yearsPerPixel: 0.5, width: 1000, height: 400 });

  test('year and pixel conversions are inverse', () => {
    assert.equal(yearToX(viewport, 1500), 500);
    assert.equal(Math.round(xToYear(viewport, 500)), 1500);
    assert.ok(Math.abs(xToYear(viewport, yearToX(viewport, 1234)) - 1234) < 1e-6);
  });

  test('zoom keeps the year under the cursor fixed', () => {
    const anchorX = 300;
    const before = xToYear(viewport, anchorX);
    const zoomed = zoomAt(viewport, anchorX, 0.5);
    assert.ok(Math.abs(xToYear(zoomed, anchorX) - before) < 1e-6);
    assert.ok(zoomed.yearsPerPixel < viewport.yearsPerPixel);
  });

  test('focal semantic zoom reveals finer ticks only near the cursor', () => {
    const focusedViewport = createViewport({
      centerYear: 2025.5,
      yearsPerPixel: 1 / 130,
      width: 1000,
      height: 400,
    });
    const focusX = 500;
    const details = focusedAxisTicks(focusedViewport, focusX, { radiusPx: 180 });
    const normalYears = new Set(axisTicks(focusedViewport).map((tick) => tick.year));

    assert.ok(details.length > 0, 'focused area has no extra detail');
    assert.ok(details.every((tick) => Math.abs(tick.x - focusX) <= 180));
    assert.ok(details.every((tick) => normalYears.has(tick.year) === false));
    assert.ok(details.some((tick) => /^(Jan|Apr|Jul|Oct)$/.test(tick.label)));
  });

  test('focal detail uses the normal linear date positions', () => {
    const focusedViewport = createViewport({
      centerYear: 2025.5,
      yearsPerPixel: 1 / 130,
      width: 1000,
      height: 400,
    });
    const details = focusedAxisTicks(focusedViewport, 500);
    assert.ok(details.length > 0);
    for (const tick of details) {
      assert.equal(tick.x, yearToX(focusedViewport, tick.year));
    }
  });

  test('the axis progresses from real days into a 24-hour UTC clock', () => {
    const dayViewport = createViewport({
      centerYear: 2026.62,
      yearsPerPixel: 0.8 / 365.2425 / 130,
      width: 1000,
      height: 400,
    });
    assert.equal(tickStep(dayViewport).unit, 'day');
    assert.ok(axisTicks(dayViewport).some((tick) => /^\d{1,2} [A-Z][a-z]{2} 2026$/.test(tick.label)));

    const start = toYearValue({
      year: 2026,
      month: 8,
      day: 15,
      precision: PRECISION.EXACT,
    });
    const fullDayViewport = createViewport({
      centerYear: start + 0.5 / 365,
      yearsPerPixel: 1 / 365 / 1000,
      width: 1000,
      height: 400,
    });
    const midnightTicks = axisTicks(fullDayViewport)
      .filter((tick) => tick.calendar?.hour === 0 && tick.calendar?.minute === 0);
    assert.ok(midnightTicks.some((tick) => tick.calendar.day === 15));
    assert.ok(midnightTicks.some((tick) => tick.calendar.day === 16));
    assert.ok(axisTicks(fullDayViewport).every((tick) => /UTC/.test(tick.label) === false));
    assert.ok(axisTicks(fullDayViewport).every((tick) => /^\d{1,2} [A-Z][a-z]{2} · \d{2}:\d{2}$/.test(tick.label)));
  });

  test('deep zoom reaches UTC minutes but never seconds', () => {
    const minute = 1 / (365.2425 * 24 * 60);
    const fiveMinuteViewport = createViewport({
      centerYear: 2026.62,
      yearsPerPixel: 4 * minute / 130,
      width: 1000,
      height: 400,
    });
    assert.deepEqual(
      { unit: tickStep(fiveMinuteViewport).unit, count: tickStep(fiveMinuteViewport).count },
      { unit: 'minute', count: 5 },
    );
    assert.ok(axisTicks(fiveMinuteViewport).every((tick) => /\d{1,2} [A-Z][a-z]{2} · \d{2}:\d{2}$/.test(tick.label)));
    assert.ok(axisTicks(fiveMinuteViewport).every((tick) => /UTC/.test(tick.label) === false));
    assert.ok(axisTicks(fiveMinuteViewport).every((tick) => /\d{2}:\d{2}:\d{2}/.test(tick.label) === false));

    const finestViewport = createViewport({
      centerYear: 2026.62,
      yearsPerPixel: MIN_YEARS_PER_PIXEL,
      width: 1000,
      height: 400,
    });
    assert.deepEqual(
      { unit: tickStep(finestViewport).unit, count: tickStep(finestViewport).count },
      { unit: 'minute', count: 1 },
    );
  });

  test('focal semantic zoom boosts five-minute detail to single minutes locally', () => {
    const minute = 1 / (365.2425 * 24 * 60);
    const focusedViewport = createViewport({
      centerYear: 2026.62,
      yearsPerPixel: 4 * minute / 130,
      width: 1000,
      height: 400,
    });
    const focusX = 500;
    const details = focusedAxisTicks(focusedViewport, focusX, { radiusPx: 180 });

    assert.ok(details.length > 0);
    assert.ok(details.every((tick) => tick.unit === 'minute'));
    assert.ok(details.every((tick) => Math.abs(tick.x - focusX) <= 180));
    assert.ok(details.some((tick) => tick.calendar.minute % 5 !== 0));
    assert.ok(details.every((tick) => /^\d{2}:\d{2}$/.test(tick.label)));
    assert.ok(details.every((tick) => /[A-Za-z]|UTC/.test(tick.label) === false));
    assert.ok(details.every((tick) => tick.x === yearToX(focusedViewport, tick.year)));
  });

  test('zoom is bounded at both ends', () => {
    assert.equal(clampYearsPerPixel(1e-12), MIN_YEARS_PER_PIXEL);
    assert.equal(clampYearsPerPixel(1e30), MAX_YEARS_PER_PIXEL);
    assert.equal(clampYearsPerPixel(0), 1);
    assert.equal(clampYearsPerPixel(NaN), 1);
  });

  test('viewportForRange frames the requested span', () => {
    const framed = viewportForRange(1400, 1600, { width: 1000, height: 400 });
    const range = visibleRange(framed);
    assert.ok(range.from < 1400 && range.to > 1600);
  });

  test('a single instant still gets a usable window', () => {
    const framed = viewportForRange(1521, 1521, { width: 1000 });
    assert.ok(visibleRange(framed).to > visibleRange(framed).from);
  });

  test('axis ticks stay bounded and ascending at every zoom', () => {
    for (const yearsPerPixel of [MIN_YEARS_PER_PIXEL, 0.01, 1, 1000, 1e6, MAX_YEARS_PER_PIXEL]) {
      const vp = createViewport({ centerYear: 0, yearsPerPixel, width: 1200 });
      const ticks = axisTicks(vp);
      assert.ok(ticks.length > 0, `no ticks at ${yearsPerPixel}`);
      assert.ok(ticks.length <= 240, `too many ticks at ${yearsPerPixel}`);
      for (let i = 1; i < ticks.length; i += 1) {
        assert.ok(ticks[i].year >= ticks[i - 1].year, `ticks unsorted at ${yearsPerPixel}`);
      }
    }
  });

  test('year zero is always ticked and labelled when on screen', () => {
    const vp = createViewport({ centerYear: 0, yearsPerPixel: 5, width: 1000 });
    const zero = axisTicks(vp).find((tick) => tick.year === 0);
    assert.ok(zero, 'year zero missing');
    assert.equal(zero.label, '0');
    assert.equal(zero.isZero, true);
  });

  test('axis labels are distinct at every zoom', () => {
    // A real bug this catches: scaling years to words from 1000 upward rendered
    // 1517, 1518 and 1519 all as "1.5 thousand", so the axis repeated one label.
    for (const [centerYear, yearsPerPixel] of [
      [1520, 0.01], [1520, 0.05], [1520, 1], [0, 5], [-4000, 20], [1e6, 5000],
    ]) {
      const vp = createViewport({ centerYear, yearsPerPixel, width: 1200 });
      const labels = axisTicks(vp).map((tick) => tick.label);
      assert.equal(
        new Set(labels).size,
        labels.length,
        `duplicate axis labels at ${centerYear}/${yearsPerPixel}: ${labels.slice(0, 6).join(' ')}`,
      );
    }
  });

  test('ordinary historical years stay literal on the axis', () => {
    const vp = createViewport({ centerYear: 1520, yearsPerPixel: 0.05, width: 1200 });
    const labels = axisTicks(vp).map((tick) => tick.label);
    assert.ok(labels.some((label) => /^15\d\d$/.test(label)), labels.slice(0, 5).join(','));
    assert.equal(labels.some((label) => /thousand/.test(label)), false);
  });

  test('the cursor readout labels deep time in words, not raw digits', () => {
    assert.equal(cursorReadout(1520, 2026).label, '1520 year');
    assert.match(cursorReadout(-2496454496, 2026).label, /billion BCE/);
  });

  test('deep-time labels are readable rather than digit soup', () => {
    const vp = createViewport({ centerYear: -1e9, yearsPerPixel: 1e6, width: 1000 });
    const labels = axisTicks(vp).map((tick) => tick.label);
    assert.ok(labels.some((label) => /billion|million/.test(label)), labels.slice(0, 4).join(','));
  });

  test('cursor readout describes distance from a reference year', () => {
    assert.equal(cursorReadout(1473, 2026).relative, '553 years ago');
    // Literal counts, matching the reference UI's "10883 years later".
    assert.equal(cursorReadout(3235, 2025).relative, '1210 years later');
    assert.equal(cursorReadout(12902, 2019).relative, '10883 years later');
    assert.equal(cursorReadout(2026, 2026).relative, 'this year');
    assert.equal(cursorReadout(2025, 2026).relative, '1 year ago');
  });

  test('deep time falls back to words in the readout', () => {
    assert.match(cursorReadout(-13.8e9, 2026).relative, /billion years ago/);
  });
});

describe('timegraph layout', () => {
  test('non-overlapping items share one lane', () => {
    const packed = packIntoLanes([
      { left: 0, right: 50 },
      { left: 100, right: 150 },
    ]);
    assert.deepEqual(packed.map((item) => item.lane), [0, 0]);
  });

  test('overlapping items stack instead of colliding', () => {
    const packed = packIntoLanes([
      { left: 0, right: 100 },
      { left: 10, right: 110 },
      { left: 20, right: 120 },
    ]);
    assert.deepEqual(packed.map((item) => item.lane), [0, 1, 2]);
  });

  test('a lane is reused once it is clear again', () => {
    const packed = packIntoLanes([
      { left: 0, right: 100 },
      { left: 10, right: 110 },
      { left: 200, right: 300 },
    ]);
    assert.deepEqual(packed.map((item) => item.lane), [0, 1, 0]);
  });

  test('above and below stack independently', () => {
    const events = [
      normalizeEvent({ id: 'a', title: 'A', start: '1500', position: 'above' }),
      normalizeEvent({ id: 'b', title: 'B', start: '1500', position: 'below' }),
    ];
    const vp = createViewport({ centerYear: 1500, yearsPerPixel: 1, width: 1000, height: 400 });
    const { placements, laneCount } = layoutEvents(events, vp);
    assert.equal(laneCount.above, 1);
    assert.equal(laneCount.below, 1);
    const above = placements.find((p) => p.id === 'a');
    const below = placements.find((p) => p.id === 'b');
    assert.ok(above.cardBottom < vp.height / 2, 'above card should sit over the axis');
    assert.ok(below.cardTop > vp.height / 2, 'below card should sit under the axis');
  });

  test('two same-year events on the same side are stacked, never overlapped', () => {
    const events = [
      normalizeEvent({ id: 'a', title: 'Exsurge Domine', start: '1520' }),
      normalizeEvent({ id: 'b', title: 'Decet Romanum Pontificem', start: '1521' }),
    ];
    const vp = createViewport({ centerYear: 1520, yearsPerPixel: 1, width: 1000, height: 400 });
    const { placements } = layoutEvents(events, vp);
    const [a, b] = ['a', 'b'].map((id) => placements.find((p) => p.id === id));
    const horizontallyOverlapping = a.left < b.left + b.width && b.left < a.left + a.width;
    assert.ok(horizontallyOverlapping, 'test needs them to contend for space');
    assert.notEqual(a.cardTop, b.cardTop, 'contending cards must not share a row');
  });

  test('a sized-up event grows its box and reserves its full visible height', () => {
    const baseWidth = estimateCardWidth('Luther Born', { scale: 1 });
    const largeWidth = estimateCardWidth('Luther Born', { scale: 2.5 });
    assert.equal(largeWidth, baseWidth * 2.5);

    const events = [
      normalizeEvent({ id: 'large', title: 'Luther Born', start: '1483', scale: 2.5 }),
      normalizeEvent({ id: 'next', title: 'Another event', start: '1483', scale: 1 }),
    ];
    const vp = createViewport({ centerYear: 1483, yearsPerPixel: 1, width: 1000, height: 400 });
    const { placements } = layoutEvents(events, vp);
    const large = placements.find((placement) => placement.id === 'large');
    const next = placements.find((placement) => placement.id === 'next');

    assert.equal(large.width, largeWidth);
    assert.equal(large.cardBottom - large.cardTop, 75);
    assert.ok(next.cardBottom <= large.cardTop - 12, 'large cards must keep breathing room');
    assert.equal(placementAt(placements, large.left + 2, large.cardTop + 2)?.id, 'large');
  });

  test('tagged cards reserve a separate lower line for their tags', () => {
    const events = [
      normalizeEvent({ id: 'plain', title: 'Plain', start: '1500' }),
      normalizeEvent({ id: 'tagged', title: 'Tagged', start: '1510', tags: ['person'] }),
    ];
    const vp = createViewport({ centerYear: 1505, yearsPerPixel: 1, width: 1000, height: 400 });
    const { placements } = layoutEvents(events, vp);
    const plain = placements.find((placement) => placement.id === 'plain');
    const tagged = placements.find((placement) => placement.id === 'tagged');

    assert.equal(plain.cardHeight, 30);
    assert.equal(plain.tagBandHeight, 0);
    assert.equal(tagged.cardHeight, 37);
    assert.equal(tagged.tagBandHeight, 7);
  });

  test('shared text size grows timeline cards and their tag reservation', () => {
    const events = [
      normalizeEvent({ id: 'scaled', title: 'Scaled', start: '1500', tags: ['person'] }),
    ];
    const vp = createViewport({ centerYear: 1500, yearsPerPixel: 1, width: 1000, height: 400 });
    const normal = layoutEvents(events, vp, { textScale: 1 }).placements[0];
    const enlarged = layoutEvents(events, vp, { textScale: 4 / 3 }).placements[0];

    assert.equal(normal.cardHeight, 37);
    assert.equal(enlarged.cardHeight, 37 * (4 / 3));
    assert.equal(enlarged.tagBandHeight, normal.tagBandHeight * (4 / 3));
  });

  test('height grows so the tallest stack is never clipped', () => {
    const shallow = requiredHeight({ above: 1, below: 1 });
    const deep = requiredHeight({ above: 9, below: 1 });
    assert.ok(deep > shallow);
  });

  test('lane count is capped so a thousand events on one pixel stay sane', () => {
    const items = Array.from({ length: 400 }, () => ({ left: 0, right: 100 }));
    const packed = packIntoLanes(items, { maxLanes: 64 });
    assert.equal(Math.max(...packed.map((item) => item.lane)), 63);
  });

  test('bounds cover every event including range ends', () => {
    const events = [
      normalizeEvent({ title: 'a', start: '1500' }),
      normalizeEvent({ title: 'b', start: '1600', end: '1700' }),
    ];
    assert.deepEqual(eventsBounds(events), { from: 1500, to: 1700 });
  });

  test('lays out 1000 events quickly', () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      normalizeEvent({ id: `e${i}`, title: `Event ${i}`, start: String(1000 + i) }));
    const vp = createViewport({ centerYear: 1500, yearsPerPixel: 2, width: 1400, height: 600 });
    const started = Date.now();
    for (let frame = 0; frame < 10; frame += 1) layoutEvents(events, vp);
    const perFrame = (Date.now() - started) / 10;
    assert.ok(perFrame < 16, `layout took ${perFrame}ms per frame`);
  });
});

describe('timegraph document', () => {
  test('a new timeline has no stored placeholder title', () => {
    assert.equal(normalizeTimegraph({}).title, '');
  });

  test('a new event lands on today with an empty editable title', () => {
    const event = createEvent();
    assert.equal(event.title, '');
    assert.equal(event.start.year, new Date().getFullYear());
    assert.equal(event.position, 'above');
    assert.equal(event.color, 'violet');
  });

  test('events are stored in chronological order', () => {
    let graph = normalizeTimegraph({ title: 'T' });
    graph = upsertEvent(graph, { id: 'late', title: 'Late', start: '1600' });
    graph = upsertEvent(graph, { id: 'early', title: 'Early', start: '1500' });
    assert.deepEqual(graph.events.map((e) => e.id), ['early', 'late']);
  });

  test('upsert replaces rather than duplicates', () => {
    let graph = normalizeTimegraph({ title: 'T' });
    graph = upsertEvent(graph, { id: 'a', title: 'First', start: '1500' });
    graph = upsertEvent(graph, { id: 'a', title: 'Renamed', start: '1500' });
    assert.equal(graph.events.length, 1);
    assert.equal(graph.events[0].title, 'Renamed');
  });

  test('duplicate makes an independent copy', () => {
    let graph = normalizeTimegraph({ events: [{ id: 'a', title: 'Original', start: '1500' }] });
    const result = duplicateEvent(graph, 'a');
    graph = result.timegraph;
    assert.equal(graph.events.length, 2);
    assert.notEqual(result.event.id, 'a');
    assert.equal(result.event.title, 'Original copy');
  });

  test('remove deletes only the named event', () => {
    let graph = normalizeTimegraph({
      events: [{ id: 'a', title: 'A', start: '1500' }, { id: 'b', title: 'B', start: '1600' }],
    });
    graph = removeEvent(graph, 'a');
    assert.deepEqual(graph.events.map((e) => e.id), ['b']);
  });

  test('deleting an event can be undone and redone exactly', () => {
    const original = normalizeTimegraph({
      events: [
        { id: 'keep', title: 'Keep', start: { year: 1200, precision: 'year' } },
        { id: 'delete', title: 'Delete', start: { year: 1300, precision: 'year' } },
      ],
    });
    let history = createHistory(original);
    history = pushHistory(history, removeEvent(original, 'delete'));
    assert.deepEqual(history.present.events.map((event) => event.id), ['keep']);

    history = undoHistory(history);
    assert.deepEqual(history.present.events.map((event) => event.id), ['keep', 'delete']);

    history = redoHistory(history);
    assert.deepEqual(history.present.events.map((event) => event.id), ['keep']);
  });

  test('dragging an event preserves its duration', () => {
    const event = normalizeEvent({ title: 'War', start: '1618', end: '1648' });
    const moved = moveEventToYear(event, 1700);
    assert.equal(moved.start.year, 1700);
    assert.equal(moved.end.year, 1730);
  });

  test('moving an event can be undone back to its exact year', () => {
    const original = normalizeTimegraph({
      events: [{ id: 'move', title: 'Move', start: '1618', end: '1648' }],
    });
    const moved = upsertEvent(original, moveEventToYear(original.events[0], 1700));
    let history = pushHistory(createHistory(original), moved);
    assert.equal(history.present.events[0].start.year, 1700);

    history = undoHistory(history);
    assert.equal(history.present.events[0].start.year, 1618);
    assert.equal(history.present.events[0].end.year, 1648);
  });

  test('dragging a point event keeps it a point', () => {
    const moved = moveEventToYear(normalizeEvent({ title: 'x', start: '1500' }), 1520);
    assert.equal(moved.start.year, 1520);
    assert.equal(moved.end, null);
  });

  test('malformed events are dropped, not rendered as year zero', () => {
    const graph = normalizeTimegraph({
      events: [
        { title: 'good', start: '1500' },
        { title: 'no date' },
        null,
        'nonsense',
      ],
    });
    assert.equal(graph.events.length, 1);
    assert.equal(graph.events[0].title, 'good');
  });

  test('unsafe media URLs are refused', () => {
    const event = normalizeEvent({
      title: 'x',
      start: '1500',
      media: [
        { kind: 'image', url: 'javascript:alert(1)' },
        { kind: 'image', url: 'https://example.test/a.png' },
      ],
    });
    assert.equal(event.media.length, 1);
    assert.equal(event.media[0].url, 'https://example.test/a.png');
  });

  test('unknown link kinds are refused', () => {
    const event = normalizeEvent({
      title: 'x',
      start: '1500',
      links: [{ kind: 'evil', id: '1' }, { kind: 'keyword', id: 'k1', label: 'Grace' }],
    });
    assert.deepEqual(event.links, [{ kind: 'keyword', id: 'k1', label: 'Grace' }]);
  });

  test('filters by text, tag and colour', () => {
    const events = [
      normalizeEvent({ title: 'Luther born', start: '1483', tags: ['people'], color: 'gold' }),
      normalizeEvent({ title: 'Exsurge Domine', start: '1520', tags: ['bulls'], color: 'violet' }),
    ];
    assert.equal(filterEvents(events, { query: 'luther' }).length, 1);
    assert.equal(filterEvents(events, { tags: ['bulls'] }).length, 1);
    assert.equal(filterEvents(events, { colors: ['gold'] }).length, 1);
    assert.equal(filterEvents(events, { query: 'luther', colors: ['violet'] }).length, 0);
    assert.equal(filterEvents(events, {}).length, 2);
  });

  test('disabled toolbar tags hide matching events but leave untagged events visible', () => {
    const events = [
      normalizeEvent({ title: 'Luther born', start: '1483', tags: ['people'] }),
      normalizeEvent({ title: 'Exsurge Domine', start: '1520', tags: ['documents', 'papal'] }),
      normalizeEvent({ title: 'Council', start: '1521' }),
    ];
    const visible = filterEvents(events, { hiddenTags: ['DOCUMENTS'] });

    assert.deepEqual(visible.map((event) => event.title), ['Luther born', 'Council']);
  });

  test('the Untagged toolbar switch hides only events without tags', () => {
    const events = [
      normalizeEvent({ title: 'Tagged', start: '1500', tags: ['people'] }),
      normalizeEvent({ title: 'No tag', start: '1501' }),
    ];

    assert.deepEqual(
      filterEvents(events, { hideUntagged: true }).map((event) => event.title),
      ['Tagged'],
    );
  });

  test('filtering can match a date label', () => {
    const events = [normalizeEvent({ title: 'x', start: '776 BCE' })];
    assert.equal(filterEvents(events, { query: 'bce' }).length, 1);
  });

  test('collects tags with counts, most used first', () => {
    const events = [
      normalizeEvent({ title: 'a', start: '1500', tags: ['reformation', 'people'] }),
      normalizeEvent({ title: 'b', start: '1501', tags: ['reformation'] }),
    ];
    assert.deepEqual(collectTags(events), [
      { tag: 'reformation', count: 2 },
      { tag: 'people', count: 1 },
    ]);
  });

  test('undo and redo walk the document history', () => {
    const first = normalizeTimegraph({ title: 'One' });
    let history = createHistory(first);
    const second = { ...first, title: 'Two' };
    history = pushHistory(history, second);
    assert.equal(history.present.title, 'Two');
    history = undoHistory(history);
    assert.equal(history.present.title, 'One');
    history = redoHistory(history);
    assert.equal(history.present.title, 'Two');
  });

  test('undo at the beginning and redo at the end are no-ops', () => {
    const history = createHistory(normalizeTimegraph({ title: 'Only' }));
    assert.equal(undoHistory(history).present.title, 'Only');
    assert.equal(redoHistory(history).present.title, 'Only');
  });

  test('a new edit clears the redo branch', () => {
    let history = createHistory({ title: 'A' });
    history = pushHistory(history, { title: 'B' });
    history = undoHistory(history);
    history = pushHistory(history, { title: 'C' });
    assert.equal(history.future.length, 0);
    assert.equal(history.present.title, 'C');
  });
});


test('tag filters merge case variants and count each event only once', () => {
  const events = [
    { ...normalizeEvent({ title: 'Born', start: '1484' }), tags: ['zwingli', 'Zwingli', ' zwingli '] },
    normalizeEvent({ title: 'Priest', start: '1506', tags: ['Zwingli'] }),
    normalizeEvent({ title: 'Other', start: '1510', tags: ['Knox'] }),
  ];
  assert.deepEqual(collectTags(events), [{ tag: 'zwingli', count: 2 }, { tag: 'Knox', count: 1 }]);
  assert.deepEqual(filterEvents(events, { tags: [' ZWINGLI '] }).map(e => e.title), ['Born', 'Priest']);
  assert.deepEqual(filterEvents(events, { hiddenTags: ['Zwingli'] }).map(e => e.title), ['Other']);
  // Removing the first spelling must not invalidate the selected filter.
  assert.deepEqual(collectTags(events.slice(1)), [{ tag: 'Knox', count: 1 }, { tag: 'Zwingli', count: 1 }]);
  assert.equal(filterEvents(events.slice(1), { tags: ['zwingli'] })[0].title, 'Priest');
});
