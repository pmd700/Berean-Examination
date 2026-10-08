import assert from "node:assert/strict";
import {
  parseBsbText,
  parseLsvText,
  parseNasb1995Text,
} from "../src/lib/bible-import/plainTextParsers";

const bsb = parseBsbText([
  "synthetic header one",
  "synthetic header two",
  "synthetic header three",
  "Genesis 1:1\tAn entirely invented BSB-format sentence.",
].join("\n"));
assert.deepEqual(bsb, [{
  translation: "BSB",
  book: "Genesis",
  chapter: 1,
  verse: 1,
  text: "An entirely invented BSB-format sentence.",
}]);

const lsv = parseLsvText([
  "Synthetic preface",
  "Gen 2:3 An entirely invented LSV-format sentence.",
  "Unknown 1:1 This unrecognized book must be ignored.",
].join("\n"));
assert.deepEqual(lsv, [{
  translation: "LSV",
  book: "Genesis",
  chapter: 2,
  verse: 3,
  text: "An entirely invented LSV-format sentence.",
}]);

const nasb = parseNasb1995Text([
  "Genesis 4 New American Standard Bible",
  "1 An entirely invented NASB-format line",
  "that continues here.",
  "",
  "2 Another invented line.",
].join("\n"));
assert.deepEqual(nasb, [
  {
    translation: "NASB1995",
    book: "Genesis",
    chapter: 4,
    verse: 1,
    text: "An entirely invented NASB-format line that continues here.",
  },
  {
    translation: "NASB1995",
    book: "Genesis",
    chapter: 4,
    verse: 2,
    text: "Another invented line.",
  },
]);

console.log("PASS: database-free BSB, LSV, and NASB plain-text parsers");
