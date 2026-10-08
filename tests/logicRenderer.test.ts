import assert from 'node:assert/strict';
import test from 'node:test';
import { detectLogicInput, isProbablyLogic } from '../src/lib/logic/logic-detector';
import { logicToLatex } from '../src/lib/logic/logic-to-latex';
import { renderLogicToHtml } from '../src/lib/logic/logic-render';
import { preprocessLogicMarkdown } from '../src/lib/logic/logic-markdown';
import { isKnownLogicCommand, tokenizeLogic, LOGIC_TOKEN } from '../src/lib/logic/logic-tokenizer';

const UNICODE_FORMULA = '∀x∀y∀a[(Ch(x,y)∧C(y,x,a)∧L(a))→O(x,a)]';
const EXPECTED_LATEX = '\\forall x\\,\\forall y\\,\\forall a\\left[\\left(\\mathit{Ch}(x,y)\\land C(y,x,a)\\land L(a)\\right)\\to O(x,a)\\right]';
const RAW_PASTE = `[\n\n\\forall x\\forall y\\forall a[(Ch(x,y)\\land C(y,x,a)\\land L(a))\\rightarrow O(x,a)]\n\n]`;

test('converts the required quantified Unicode formula exactly', () => {
  assert.equal(logicToLatex(UNICODE_FORMULA), EXPECTED_LATEX);
});

test('preserves connective order and multi-letter predicate names', () => {
  assert.equal(logicToLatex('P∧Q'), 'P\\land Q');
  assert.equal(logicToLatex('¬P→Q'), '\\neg P\\to Q');
  assert.equal(logicToLatex('P↔Q'), 'P\\leftrightarrow Q');
  assert.equal(logicToLatex('Ch(x,y)'), '\\mathit{Ch}(x,y)');
});

test('recognizes David’s exact raw bracketed LaTeX paste as one display formula', () => {
  const detected = detectLogicInput(RAW_PASTE);
  assert.deepEqual(detected, {
    source: '\\forall x\\forall y\\forall a[(Ch(x,y)\\land C(y,x,a)\\land L(a))\\rightarrow O(x,a)]',
    sourceFormat: 'latex',
    display: 'block',
    explicit: true,
  });
  assert.equal(logicToLatex(detected!.source, { sourceFormat: 'latex' }), EXPECTED_LATEX);
});

test('recognizes explicit block and inline markup', () => {
  assert.equal(isProbablyLogic(':::logic\nP→Q\n:::'), true);
  assert.deepEqual(detectLogicInput('{{logic: P→Q}}'), {
    source: 'P→Q', sourceFormat: 'unicode', display: 'inline', explicit: true,
  });
});

test('does not classify ordinary prose containing one arrow', () => {
  assert.equal(isProbablyLogic('Open settings → then save your work'), false);
});

test('malformed delimiters and hostile commands fail visibly and safely', () => {
  assert.equal(isProbablyLogic('∀x(P(x)'), false);
  const hostile = renderLogicToHtml('P\\href{https://evil.invalid}{click}', {
    sourceFormat: 'latex', display: 'block',
  });
  assert.equal(hostile.ok, false);
  assert.match(hostile.error || '', /Unsupported logic command/);
  assert.equal(hostile.html, '');
});

test('KaTeX output includes visual HTML and accessible MathML', () => {
  const rendered = renderLogicToHtml(UNICODE_FORMULA, { display: 'block' });
  assert.equal(rendered.ok, true);
  assert.match(rendered.html, /class="katex"/);
  assert.match(rendered.html, /<math/);
  assert.match(rendered.html, /∀/);
});

test('Markdown becomes logic nodes before rendering while code fences remain literal', () => {
  const processed = preprocessLogicMarkdown(`Before\n\n${RAW_PASTE}\n\nInline {{logic: P→Q}}\n\n\`\`\`text\nP→Q\n\`\`\``);
  assert.match(processed, /<bex-logic format="latex" display="block">/);
  assert.match(processed, /<bex-logic format="unicode" display="inline">P%/);
  assert.match(processed, /```text\nP→Q\n```/);
  assert.equal((processed.match(/<bex-logic/g) || []).length, 2);
});

test('recognizes and normalizes safe direct boxed text', () => {
  assert.equal(isKnownLogicCommand('\\boxed'), true);
  assert.equal(isKnownLogicCommand('\\text'), true);
  assert.equal(isKnownLogicCommand('\\boxtext'), true);
  assert.equal(isKnownLogicCommand('\\;'), true);
  assert.equal(
    logicToLatex('\\boxed{\\text{Truth is objective.}}', { sourceFormat: 'latex' }),
    '\\boxed{\\;\\text{Truth is objective.}\\;}',
  );
  assert.equal(
    logicToLatex('\\boxed{\\;\\text{The lighthouse remained visible through the rain.}\\;}', { sourceFormat: 'latex' }),
    '\\boxed{\\;\\text{The lighthouse remained visible through the rain.}\\;}',
  );
});

test('raw boxtext paste expands through the safe KaTeX macro', () => {
  const raw = '[\n\\boxtext{Every valid argument preserves truth.}\n]';
  const detected = detectLogicInput(raw);
  assert.deepEqual(detected, {
    source: '\\boxtext{Every valid argument preserves truth.}',
    sourceFormat: 'latex',
    display: 'block',
    explicit: true,
  });
  assert.equal(isProbablyLogic('\\boxtext{Truth is objective.}'), true);
  assert.ok(tokenizeLogic(detected!.source).some((token) => token.type === LOGIC_TOKEN.KATEX_COMMAND));

  const rendered = renderLogicToHtml(detected!.source, { sourceFormat: 'latex', display: 'block' });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.latex, '\\boxtext{Every valid argument preserves truth.}');
  assert.match(
    rendered.html.replace(/\u00a0/g, ' '),
    /<mtext>Every valid argument preserves truth\.<\/mtext>/,
  );
  assert.match(rendered.html, /class="[^"]*text[^"]*"/);
  assert.match(rendered.html, /class="[^"]*fbox[^"]*"/);
});

test('boxed text preserves ordinary spaces and punctuation', () => {
  const rendered = renderLogicToHtml('\\boxtext{Truth is objective, stable, and knowable.}', {
    sourceFormat: 'latex',
    display: 'block',
  });
  assert.equal(rendered.ok, true);
  assert.match(rendered.html, /Truth is objective, stable, and knowable\./);
  assert.doesNotMatch(rendered.latex, /mathit/);
});

test('boxed text rejects HTML, nested commands, paragraphs, and long statements', () => {
  for (const source of [
    '\\boxtext{<b>Truth</b>}',
    '\\boxtext{Truth \\href{https://evil.invalid}{click}}',
    '\\boxtext{First line\nSecond line}',
    `\\boxtext{${'x'.repeat(181)}}`,
  ]) {
    const rendered = renderLogicToHtml(source, { sourceFormat: 'latex', display: 'block' });
    assert.equal(rendered.ok, false);
    assert.equal(rendered.html, '');
  }
});

test('trustedLatex cannot bypass the safe command allowlist', () => {
  const rendered = renderLogicToHtml('\\href{https://evil.invalid}{click}', {
    sourceFormat: 'latex',
    display: 'block',
    trustedLatex: true,
  });
  assert.equal(rendered.ok, false);
  assert.match(rendered.error || '', /Unsupported logic command/);
});
