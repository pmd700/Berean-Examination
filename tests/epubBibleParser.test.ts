/**
 * Unit tests for the EPUB Bible parser + segment engine.
 * Run: `npx tsx tests/epubBibleParser.test.ts`
 *
 * No test framework is used (the project has none); we use node:assert and a
 * tiny runner so this stays a single `tsx`-runnable file.
 */

import assert from "node:assert";
import {
  parseFootnoteAsides,
  extractEvents,
  assembleChapters,
  parseChapterHead,
  decodeEntities,
  type ResolvedNote,
} from "../src/lib/bible-import/epubBibleParser";
import {
  buildSegmentLayout,
  segmentsToPlainText,
  type BibleSegment,
} from "@shared/bibleSegments";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

// NOTE: This is SYNTHETIC, invented content — NOT scripture from any
// copyrighted translation. It only exercises parser features (verse numbers,
// note markers, footnote asides, italics, small-caps divine name).
const ASIDES = `<html><body>
<aside id="f1-1" epub:type="footnote">
<a epub:type="noteref" href="x.html#source1-1"><span class="footnote1">a</span> <span class="footnote2">9:1\u00a0\u00a0\u00a0Lit <i class="calibre12">within the courts</i></span></a></aside>
<aside id="f1-2" epub:type="footnote">
<a epub:type="noteref" href="x.html#source1-2"><span class="footnote1">b</span> <span class="footnote2">9:1\u00a0\u00a0\u00a0Or <i class="calibre12">heralds</i></span></a></aside>
<aside id="f2-1" epub:type="footnote">
<a epub:type="noteref" href="x.html#source2-1"><span class="footnote1">c</span> <span class="footnote2">9:2\u00a0\u00a0\u00a0Heb uncertain</span></a></aside>
<aside id="f2-2" epub:type="footnote">
<a epub:type="noteref" href="x.html#source2-2"><span class="footnote1">d</span> <span class="footnote2">9:2\u00a0\u00a0\u00a0Or <i class="calibre12">gleaming</i></span></a></aside>
</body></html>`;

const footnoteMap = parseFootnoteAsides(ASIDES);

// Synthetic chapter (no copyrighted scripture). Marker `a` before the word
// "within"; marker `b` after the punctuation "court,"; two consecutive markers
// `c`,`d` glued before "Listen,"; italic supplied word "gleaming"; divine name
// LORD via small-caps.
const CHAPTER = `<html><body>
<p class="head">AVERON 9 <a href="x.html#bob" class="calibre7"><span class="small2">[Books]</span></a></p>
<p class="head2"><i class="calibre12">The Charge to the Watchers</i></p>
<p class="aleft">
<span class="small1"><b class="calibre9">1</b></span> Then the herald called out <small class="small1"><sup class="calibre14"><a id="source1-1" epub:type="noteref" href="x.html#f1-1">a</a></sup></small>within the inner court,<small class="small1"><sup class="calibre14"><a id="source1-2" epub:type="noteref" href="x.html#f1-2">b</a></sup></small> saying,
 <small class="small1"><sup class="calibre14">2</sup></small><small class="small1"><sup class="calibre14"><a id="source2-1" epub:type="noteref" href="x.html#f2-1">c</a></sup></small><small class="small1"><sup class="calibre14"><a id="source2-2" epub:type="noteref" href="x.html#f2-2">d</a></sup></small>Listen, seven guards carry the <i class="calibre12">gleaming</i> blade; and the L<span class="small1">ORD</span> stood near.</p>
</body></html>`;

const chapters = assembleChapters(extractEvents(CHAPTER, footnoteMap));
const ch = chapters[0];
const v1 = ch.verses.find((v) => v.verse === 1)!;
const v2 = ch.verses.find((v) => v.verse === 2)!;

function markers(v: { segments: BibleSegment[] }): BibleSegment[] {
  return v.segments.filter((s) => s.type === "noteMarker");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("epubBibleParser");

test("chapter head parses book + chapter and strips [Books]", () => {
  assert.deepStrictEqual(parseChapterHead("EZEKIEL 12 [Books]"), {
    book: "EZEKIEL",
    chapter: 12,
  });
  assert.deepStrictEqual(parseChapterHead("1 SAMUEL 5 [Books]"), {
    book: "1 SAMUEL",
    chapter: 5,
  });
  assert.deepStrictEqual(parseChapterHead("SONG OF SOLOMON 2"), {
    book: "SONG OF SOLOMON",
    chapter: 2,
  });
});

test("decodeEntities handles named + numeric entities", () => {
  assert.strictEqual(decodeEntities("a&amp;b &#65; &#x42;"), "a&b A B");
});

test("structure: one chapter, two verses, heading + paragraph flag", () => {
  assert.strictEqual(chapters.length, 1);
  assert.strictEqual(ch.book, "AVERON");
  assert.strictEqual(ch.chapter, 9);
  assert.strictEqual(ch.verses.length, 2);
  assert.strictEqual(v1.heading, "The Charge to the Watchers");
  assert.strictEqual(v1.startsParagraph, true);
  assert.strictEqual(v2.startsParagraph, false);
});

test("footnote aside resolves label, verseRef, italic body", () => {
  const note = footnoteMap.get("f1-1") as ResolvedNote;
  assert.strictEqual(note.label, "a");
  assert.strictEqual(note.verseRef, "9:1");
  assert.strictEqual(note.noteType, "Lit");
  assert.strictEqual(note.noteBody, "Lit within the courts");
  // case 6: footnote body preserves italics
  const ital = note.noteSegments.find((s) => s.type === "italic");
  assert.ok(ital, "expected an italic run in note body");
  assert.strictEqual(ital!.text, "within the courts");
});

test("plain text excludes verse numbers AND note marker labels", () => {
  assert.strictEqual(
    v1.plainText,
    "Then the herald called out within the inner court, saying,",
  );
  // Marker labels a/b never leak into reading text.
  assert.ok(!/\b[ab]\b/.test(v1.plainText));
  assert.strictEqual(
    v2.plainText,
    "Listen, seven guards carry the gleaming blade; and the LORD stood near.",
  );
});

test("stored plainText equals layout-derived plainText (token parity)", () => {
  for (const v of [v1, v2]) {
    const layout = buildSegmentLayout(v.segments);
    assert.strictEqual(layout.plainText, v.plainText);
    assert.strictEqual(segmentsToPlainText(v.segments), v.plainText);
  }
});

test("case 1: marker before a word sits at that word's token start", () => {
  const layout = buildSegmentLayout(v1.segments);
  const idx = layout.tokens.indexOf("within");
  assert.ok(idx > 0, "expected a 'within' token");
  const offset = layout.tokenStartOffsets[idx];
  const here = layout.markersByOffset.get(offset) || [];
  assert.strictEqual(here.length, 1);
  assert.strictEqual(here[0].text, "a");
});

test("case 2: marker after punctuation attaches right after the comma", () => {
  const layout = buildSegmentLayout(v1.segments);
  // "court," then marker b then " saying,". The marker offset equals the
  // length of plainText up to and including the comma after "court".
  const offset = layout.plainText.indexOf("court,") + "court,".length;
  const here = layout.markersByOffset.get(offset) || [];
  assert.strictEqual(here.length, 1);
  assert.strictEqual(here[0].text, "b");
});

test("case 3: multiple consecutive markers share one offset", () => {
  const layout = buildSegmentLayout(v2.segments);
  const idx = layout.tokens.indexOf("Listen,");
  const offset = layout.tokenStartOffsets[idx];
  const here = layout.markersByOffset.get(offset) || [];
  assert.strictEqual(here.length, 2);
  assert.deepStrictEqual(
    here.map((m) => m.text),
    ["c", "d"],
  );
});

test("case 4: italic supplied word is marked italic per-token", () => {
  const layout = buildSegmentLayout(v2.segments);
  const idx = layout.tokens.indexOf("gleaming");
  assert.ok(idx >= 0);
  const runs = layout.tokenRuns[idx];
  assert.ok(runs.every((r) => r.italic), "all runs of the word should be italic");
});

test("case 5: mid-verse superscript number starts a new verse", () => {
  // v2 only exists because the <sup>2</sup> created it; its first reading word
  // is "Listen," (markers contributed nothing).
  const layout = buildSegmentLayout(v2.segments);
  assert.strictEqual(layout.tokens[0], "Listen,");
  assert.ok(markers(v1).length === 2 && markers(v2).length === 2);
});

test("small-caps divine name renders L + small-caps ORD within one token", () => {
  const layout = buildSegmentLayout(v2.segments);
  const idx = layout.tokens.indexOf("LORD");
  assert.ok(idx >= 0, "expected a LORD token");
  const runs = layout.tokenRuns[idx];
  assert.deepStrictEqual(
    runs.map((r) => ({ t: r.text, sc: r.smallCaps })),
    [
      { t: "L", sc: false },
      { t: "ORD", sc: true },
    ],
  );
});

test("notes-hidden token stream is identical to notes-shown (zero drift)", () => {
  // Removing every marker must not change tokens or their offsets.
  const withMarkers = buildSegmentLayout(v1.segments);
  const withoutMarkers = buildSegmentLayout(
    v1.segments.filter((s) => s.type !== "noteMarker"),
  );
  assert.deepStrictEqual(withoutMarkers.tokens, withMarkers.tokens);
  assert.deepStrictEqual(
    withoutMarkers.tokenStartOffsets,
    withMarkers.tokenStartOffsets,
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
