import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  mapEpubBook,
  parseEpubBibleArchive,
} from "../src/lib/bible-import/epubArchiveParser";

const zip = new JSZip();
zip.file("content.opf", `
  <package><manifest>
    <item id="chapter-one" href="text/chapter-one.html" />
  </manifest><spine>
    <itemref idref="chapter-one" />
  </spine></package>
`);
zip.file("text/chapter-one.html", `
  <html><body>
    <p class="head">GENESIS 1</p>
    <p class="head2"><i class="calibre12">An Invented Heading</i></p>
    <p class="aleft"><span class="small1"><b class="calibre9">1</b></span>
      An entirely invented archive-parser sentence.
    </p>
  </body></html>
`);

const parsed = await parseEpubBibleArchive(await zip.generateAsync({ type: "nodebuffer" }));
assert.equal(parsed.docCount, 1);
assert.equal(parsed.footnoteCount, 0);
assert.equal(parsed.chapters.length, 1);
assert.equal(parsed.chapters[0].book, "GENESIS");
assert.equal(parsed.chapters[0].chapter, 1);
assert.equal(parsed.chapters[0].verses[0].plainText, "An entirely invented archive-parser sentence.");
assert.equal(mapEpubBook(parsed.chapters[0].book), "Genesis");
assert.equal(mapEpubBook("not a Bible book"), null);

console.log("PASS: database-free whole-EPUB archive parser");
