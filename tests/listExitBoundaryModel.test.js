import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { normalizeListExitBoundaries } from '../src/components/editor/ListExitBoundaryExtension.js';

const schema = getSchema([StarterKit]);
const paragraph = (text = '', marks = []) => schema.node(
  'paragraph',
  null,
  text ? schema.text(text, marks) : undefined,
);
const listItem = (...children) => schema.node('listItem', null, children);

describe('a passage pasted into a list item', () => {
  /**
   * The reported bug, at its root.
   *
   * Rich clipboard HTML routinely lands with everything after a list tucked
   * inside the final <li>. It reads perfectly — a list item renders its children
   * in order — and only shows itself when the writer presses Enter down there
   * and gets a numbered bullet, because Enter in a list item splits the *item*.
   */
  const heading = (text) => schema.node('heading', { level: 3 }, schema.text(text));
  const rule = () => schema.node('horizontalRule');

  const normalize = (doc) => {
    const state = EditorState.create({ schema, doc });
    return normalizeListExitBoundaries(state.tr);
  };

  it('lifts a stranded rule and everything after it out of the list', () => {
    const list = schema.node('orderedList', { start: 0 }, [
      listItem(paragraph('The context is about unbelieving cities')),
      listItem(paragraph('The father hides these things')),
      listItem(
        paragraph('No one can know the father'),
        rule(),
        heading('Matthew 11'),
        paragraph('11 And He answered them.'),
      ),
    ]);

    const { tr, changed } = normalize(schema.node('doc', null, [list]));
    assert.equal(changed, true);

    const kinds = [];
    tr.doc.forEach((node) => kinds.push(node.type.name));
    assert.deepEqual(kinds, ['orderedList', 'horizontalRule', 'heading', 'paragraph']);

    // The list keeps the three items that really were items.
    assert.equal(tr.doc.child(0).childCount, 3);
  });

  it('lifts a stranded heading even with no rule before it', () => {
    const list = schema.node('bulletList', null, [
      listItem(paragraph('a bullet'), heading('Matthew 11'), paragraph('a verse')),
    ]);

    const { tr, changed } = normalize(schema.node('doc', null, [list]));
    assert.equal(changed, true);

    const kinds = [];
    tr.doc.forEach((node) => kinds.push(node.type.name));
    assert.deepEqual(kinds, ['bulletList', 'heading', 'paragraph']);
  });

  it('leaves a genuine multi-paragraph list item alone', () => {
    // Several paragraphs in one item is ordinary writing, not a paste gone
    // wrong, and tearing it apart would destroy something deliberate.
    const list = schema.node('bulletList', null, [
      listItem(paragraph('first thought'), paragraph('second thought')),
    ]);

    assert.equal(normalize(schema.node('doc', null, [list])).changed, false);
  });

  it('leaves a nested list where it is', () => {
    const nested = schema.node('bulletList', null, [listItem(paragraph('sub point'))]);
    const list = schema.node('bulletList', null, [
      listItem(paragraph('point'), nested),
    ]);

    assert.equal(normalize(schema.node('doc', null, [list])).changed, false);
  });

  it('keeps the numbering of the items that survive', () => {
    const list = schema.node('orderedList', { start: 0 }, [
      listItem(paragraph('zero')),
      listItem(paragraph('one'), rule(), paragraph('loose')),
    ]);

    const { tr } = normalize(schema.node('doc', null, [list]));
    assert.equal(tr.doc.child(0).attrs.start, 0);
    assert.equal(tr.doc.child(0).childCount, 2);
  });
});

describe('rich-list exit boundary normalization', () => {
  it('lifts two empty paragraphs and all following blocks out of a list item', () => {
    const bold = schema.marks.bold.create();
    const list = schema.node('orderedList', { start: 1 }, [
      listItem(
        paragraph('The numbered argument'),
        paragraph(),
        paragraph(),
        paragraph('Williams quotation', [bold]),
        paragraph('13:04', [bold]),
      ),
    ]);
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [list]) });
    const normalized = normalizeListExitBoundaries(state.tr);

    assert.equal(normalized.changed, true);
    assert.deepEqual(
      Array.from({ length: normalized.tr.doc.childCount }, (_, index) => {
        const node = normalized.tr.doc.child(index);
        return [node.type.name, node.textContent];
      }),
      [
        ['orderedList', 'The numbered argument'],
        ['paragraph', ''],
        ['paragraph', ''],
        ['paragraph', 'Williams quotation'],
        ['paragraph', '13:04'],
      ],
    );
    assert.equal(normalized.tr.doc.child(3).firstChild.marks[0].type.name, 'bold');
  });

  it('leaves a single blank paragraph inside a list item alone', () => {
    const list = schema.node('bulletList', null, [
      listItem(paragraph('Main point'), paragraph(), paragraph('Continuation')),
    ]);
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [list]) });
    const normalized = normalizeListExitBoundaries(state.tr);

    assert.equal(normalized.changed, false);
    assert.equal(normalized.tr.doc.eq(state.doc), true);
  });

  it('continues ordered numbering correctly when later list items remain', () => {
    const list = schema.node('orderedList', { start: 4 }, [
      listItem(paragraph('Four'), paragraph(), paragraph(), paragraph('Independent')),
      listItem(paragraph('Five')),
    ]);
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [list]) });
    const normalized = normalizeListExitBoundaries(state.tr);

    assert.equal(normalized.tr.doc.child(0).attrs.start, 4);
    assert.equal(normalized.tr.doc.child(4).type.name, 'orderedList');
    assert.equal(normalized.tr.doc.child(4).attrs.start, 5);
    assert.equal(normalized.tr.doc.child(4).textContent, 'Five');
  });
});
