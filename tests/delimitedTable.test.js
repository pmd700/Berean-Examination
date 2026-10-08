import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  delimitedTableToHtml,
  detectDelimitedTable,
  firstRowIsHeader,
} from '../src/components/editor/delimitedTable.js';

/**
 * Pasting a table that arrived as plain text.
 *
 * Two halves, and the second matters more. Recognising a CSV is easy; the hard
 * part is NOT recognising ordinary writing that happens to contain commas,
 * because a paragraph silently exploded into a grid is far more annoying than a
 * table that stayed text. The refusals below are the real specification.
 */

// The paste that prompted this, exactly as it comes off the clipboard.
const SIN_COUNTS = `category,verses,instances_gap0,instances_gap2,instances_gap5,chapters,books,OT,NT
Idolatry (+spiritual-adultery),559,436,344,298,250,39,513,46
Idolatry (strict),475,390,324,288,236,39,441,34
Deceit/false witness,284,266,245,225,203,50,192,92
Injustice/oppression,179,167,156,143,134,31,158,21
Bloodshed/violence,178,170,154,149,136,41,142,36
Pride/arrogance,157,145,136,126,117,38,126,31
Sexual immorality (literal),148,128,118,107,99,43,84,64
Unbelief/hard heart,114,105,95,87,73,28,53,61
Drunkenness,77,74,73,69,67,33,59,18
Greed/covetousness,54,52,49,47,46,27,21,33
Hypocrisy,40,36,33,33,30,10,14,26
Blasphemy of the Holy Spirit,6,3,3,3,3,3,0,6`;

describe('reading a pasted CSV', () => {
  it('reads the sin-counts paste as a 9-column table', () => {
    const table = detectDelimitedTable(SIN_COUNTS);
    assert.equal(table.delimiter, 'comma');
    assert.equal(table.columns, 9);
    assert.equal(table.body.length, 12);
  });

  it('takes the first row as the column names', () => {
    const table = detectDelimitedTable(SIN_COUNTS);
    assert.deepEqual(table.header, [
      'category', 'verses', 'instances_gap0', 'instances_gap2',
      'instances_gap5', 'chapters', 'books', 'OT', 'NT',
    ]);
    assert.deepEqual(table.body[0], ['Idolatry (+spiritual-adultery)', '559', '436', '344', '298', '250', '39', '513', '46']);
    assert.deepEqual(table.body.at(-1), ['Blasphemy of the Holy Spirit', '6', '3', '3', '3', '3', '3', '0', '6']);
  });

  it('reads tab-separated text, which is what a spreadsheet actually copies', () => {
    const table = detectDelimitedTable('name\tcount\nIdolatry\t559\nDeceit\t284');
    assert.equal(table.delimiter, 'tab');
    assert.equal(table.columns, 2);
  });

  it('reads semicolon-separated text', () => {
    const table = detectDelimitedTable('a;b;c\n1;2;3\n4;5;6');
    assert.equal(table.delimiter, 'semicolon');
    assert.equal(table.columns, 3);
  });

  it('prefers the tab when a field contains commas of its own', () => {
    // Shredding this with the comma would give a ragged, meaningless grid.
    const table = detectDelimitedTable('name\tnote\nJohn\tMatthew 12, Mark 3\nPaul\tRomans 1, 2');
    assert.equal(table.delimiter, 'tab');
    assert.equal(table.columns, 2);
    assert.deepEqual(table.body[0], ['John', 'Matthew 12, Mark 3']);
  });

  it('honours quoted fields, delimiter and all', () => {
    const table = detectDelimitedTable('name,role,age\n"Smith, John",Elder,42\n"Doe, Jane",Deacon,39');
    assert.equal(table.columns, 3);
    assert.deepEqual(table.body[0], ['Smith, John', 'Elder', '42']);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    const table = detectDelimitedTable('quote,count,books\n"He said ""no""",2,3\nOther,4,5');
    assert.equal(table.body[0][0], 'He said "no"');
  });

  it('keeps empty cells rather than closing the gap', () => {
    const table = detectDelimitedTable('a,b,c\n1,,3\n4,5,6');
    assert.deepEqual(table.body[0], ['1', '', '3']);
  });

  it('ignores blank lines between rows', () => {
    const table = detectDelimitedTable('a,b,c\n\n1,2,3\n\n4,5,6\n');
    assert.equal(table.body.length, 2);
  });

  it('handles Windows line endings', () => {
    const table = detectDelimitedTable('a,b,c\r\n1,2,3\r\n4,5,6');
    assert.equal(table.body.length, 2);
  });
});

describe('deciding whether the first row is a header', () => {
  it('treats words above numbers as a header', () => {
    assert.equal(firstRowIsHeader([['category', 'verses'], ['Idolatry', '559']]), true);
  });

  it('treats an all-numeric grid as having no header', () => {
    // Every row is data; promoting the first would lose a row of numbers.
    const table = detectDelimitedTable('1,2,3\n4,5,6\n7,8,9');
    assert.equal(table.header, null);
    assert.equal(table.body.length, 3);
  });

  it('still calls it a header when a label row carries one stray number', () => {
    assert.equal(firstRowIsHeader([['name', 'q1', 'q2'], ['Idolatry', '559', '436']]), true);
  });

  it('treats a single row as a header', () => {
    assert.equal(firstRowIsHeader([['a', 'b']]), true);
  });
});

describe('refusing to turn writing into a table', () => {
  const refusals = {
    'a single line': 'Idolatry, deceit, pride, and violence',
    'prose with commas on every line':
      'The first point, however, is simple.\nThe second point, likewise, follows.\nThe third, finally, concludes.',
    'a ragged shape': 'a,b,c\n1,2\n3,4,5',
    'two comma columns, which prose reaches too easily':
      'Matthew 12, Mark 3\nLuke 11, Luke 12\nJohn 1, John 2',
    'a list with no delimiter at all': 'Idolatry\nDeceit\nPride',
    'lines where only some carry the delimiter': 'a,b,c\nplain sentence here\n1,2,3',
    'empty text': '',
    'a paragraph holding one long sentence per line':
      'Idolatry compresses the most of any category, and 559 verses collapse to 344. That is a 38% reduction.,x,y\nDeceit barely compresses at all, because it is scattered one-liners. Proverbs mostly.,x,y',
  };

  Object.entries(refusals).forEach(([label, text]) => {
    it(`leaves ${label} as text`, () => {
      assert.equal(detectDelimitedTable(text), null);
      assert.equal(delimitedTableToHtml(text), null);
    });
  });

  it('refuses a comma grid with no column of figures in it', () => {
    // The rule that carries the most weight. Structurally this is a perfect
    // 3x3 grid; what makes it writing is that no column holds numbers.
    assert.equal(detectDelimitedTable('name,email,role\nJohn,j@x.com,Elder\nJane,ja@x.com,Deacon'), null);
    // The same data separated by tabs is trusted, because only a spreadsheet
    // puts tabs on the clipboard.
    const tabbed = detectDelimitedTable('name\temail\trole\nJohn\tj@x.com\tElder\nJane\tja@x.com\tDeacon');
    assert.equal(tabbed.columns, 3);
  });

  it('leaves a markdown table to the handler that understands it', () => {
    // That one reads the alignment row and the bold/links inside each cell;
    // this one would treat the dashes as another row of data.
    const markdown = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    assert.equal(detectDelimitedTable(markdown), null);
  });

  it('refuses a grid too wide to have been meant as one', () => {
    const row = Array.from({ length: 80 }, (_, i) => `c${i}`).join(',');
    assert.equal(detectDelimitedTable(`${row}\n${row}`), null);
  });

  it('survives being handed something that is not text', () => {
    assert.equal(detectDelimitedTable(null), null);
    assert.equal(detectDelimitedTable(undefined), null);
    assert.equal(detectDelimitedTable(42), null);
  });
});

describe('the markup handed to the editor', () => {
  it('builds a header row and one body row per line', () => {
    const html = delimitedTableToHtml(SIN_COUNTS);
    assert.match(html, /^<table class="rt-table"><tbody>/);
    assert.equal((html.match(/<tr>/g) || []).length, 13);
    assert.equal((html.match(/<th>/g) || []).length, 9);
    assert.equal((html.match(/<td>/g) || []).length, 9 * 12);
  });

  it('wraps every cell in a paragraph, which the editor schema requires', () => {
    const html = delimitedTableToHtml('a,b,c\n1,2,3');
    assert.match(html, /<th><p>a<\/p><\/th>/);
    assert.match(html, /<td><p>1<\/p><\/td>/);
  });

  it('holds an empty cell open instead of letting the row collapse', () => {
    const html = delimitedTableToHtml('a,b,c\n1,,3');
    assert.match(html, /<td><p>&nbsp;<\/p><\/td>/);
  });

  it('escapes cell content rather than letting it become markup', () => {
    const html = delimitedTableToHtml('a,b,c\n<script>alert(1)</script>,2,3');
    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;script&gt;/);
  });
});
