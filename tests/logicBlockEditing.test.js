import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const extension = fs.readFileSync(path.join(root, 'src/components/editor/LogicBlockExtension.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/logic/logic-renderer.css'), 'utf8');

test('logic characters belong to the shared editor, not an indivisible atom or source popup', () => {
  assert.match(extension, /content: 'text\*'/);
  assert.match(extension, /marks: '_'/);
  assert.match(extension, /selectable: false/);
  assert.doesNotMatch(extension, /atom: true|beginEdit|sourceEditor|contentEditable = 'false'/);
});

test('saved legacy formulas are imported and new formulas retain real marked text', () => {
  assert.match(extension, /getContent: \(element, schema\)/);
  assert.match(extension, /editableLogicContent\(source\)/);
  assert.match(extension, /data-logic-editable/);
  assert.match(extension, /editableLogicSource\(node\.textContent, node\.attrs\.presentation\)/);
});

test('editable formulas keep the existing math fonts instead of changing style on focus', () => {
  assert.match(css, /KaTeX_Math-Italic\.woff2/);
  assert.match(css, /KaTeX_Main-Regular\.woff2/);
  assert.match(css, /unicode-range:/);
  assert.doesNotMatch(css, /logic-renderer__source-editor|logic-renderer--editing/);
});
