import { hasBalancedLogicDelimiters } from './logic-detector';
import { LOGIC_TOKEN, tokenizeLogic, type LogicToken } from './logic-tokenizer';

const SYMBOL_LATEX: Record<string, string> = Object.freeze({
  '∀': '\\forall',
  '∃': '\\exists',
  '¬': '\\neg',
  '∧': '\\land',
  '∨': '\\lor',
  '→': '\\to',
  '↔': '\\leftrightarrow',
  '⊃': '\\supset',
  '⊢': '\\vdash',
  '⊨': '\\models',
  '∴': '\\therefore',
  '∵': '\\because',
  '=': '=',
  '≠': '\\ne',
  '≡': '\\equiv',
  '<': '<',
  '>': '>',
  '≤': '\\le',
  '≥': '\\ge',
});

const OPEN_TYPES = new Set([LOGIC_TOKEN.LPAREN, LOGIC_TOKEN.LBRACKET, LOGIC_TOKEN.LBRACE]);
const MAX_SHORT_TEXT_LENGTH = 180;

function escapeShortText(value: string) {
  if (!value.trim()) throw new Error('Boxed text cannot be empty.');
  if (/\r|\n/u.test(value)) throw new Error('Boxed text must be one short line.');
  if (value.length > MAX_SHORT_TEXT_LENGTH) {
    throw new Error(`Boxed text must be ${MAX_SHORT_TEXT_LENGTH} characters or fewer.`);
  }
  if (/[<>]/u.test(value)) throw new Error('HTML-like content is not allowed in boxed text.');
  if (/\\/u.test(value)) throw new Error('Nested LaTeX commands are not allowed in boxed text.');

  return value
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\textasciitilde{}');
}

function normalizeShortTextCommand(source: string) {
  const boxText = /^\\boxtext\{([^{}]*)\}$/u.exec(source);
  if (boxText) return `\\boxtext{${escapeShortText(boxText[1])}}`;

  const boxedText = /^\\boxed\{\s*(?:\\;)?\s*\\text\{([^{}]*)\}\s*(?:\\;)?\s*\}$/u.exec(source);
  if (boxedText) return `\\boxed{\\;\\text{${escapeShortText(boxedText[1])}}\\;}`;

  const plainText = /^\\text\{([^{}]*)\}$/u.exec(source);
  if (plainText) return `\\text{${escapeShortText(plainText[1])}}`;

  if (/^\\(?:boxtext|boxed|text)\b/u.test(source)) {
    throw new Error('Boxed text must contain one short plain-text statement and no nested commands.');
  }
  return null;
}

function escapeUnknown(value: string) {
  return value
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\sim ');
}

function formatIdentifier(value: string) {
  if (value.length <= 1 || /^\d+$/u.test(value)) return value;
  return `\\mathit{${value.replace(/_/g, '\\_')}}`;
}

function previousSignificant(tokens: LogicToken[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor].type !== LOGIC_TOKEN.WHITESPACE) return tokens[cursor];
  }
  return null;
}

function previousPreviousSignificant(tokens: LogicToken[], index: number) {
  let seen = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor].type === LOGIC_TOKEN.WHITESPACE) continue;
    seen += 1;
    if (seen === 2) return tokens[cursor];
  }
  return null;
}

export type LogicToLatexOptions = {
  sourceFormat?: 'unicode' | 'latex';
  trustedLatex?: boolean;
};

export function logicToLatex(input: string, options: LogicToLatexOptions = {}) {
  const source = String(input ?? '').trim();
  if (!source) throw new Error('The logic expression is empty.');
  if (!hasBalancedLogicDelimiters(source)) throw new Error('The logic expression has unbalanced delimiters.');

  const shortTextCommand = normalizeShortTextCommand(source);
  if (shortTextCommand) return shortTextCommand;

  const tokens = tokenizeLogic(source);
  const delimiterStack: Array<{ value: string; scalable: boolean }> = [];
  let output = '';
  let pendingWhitespace = false;

  tokens.forEach((token, index) => {
    if (token.type === LOGIC_TOKEN.WHITESPACE) {
      pendingWhitespace = true;
      return;
    }

    const previous = previousSignificant(tokens, index);
    const previousPrevious = previousPreviousSignificant(tokens, index);

    if (token.type === LOGIC_TOKEN.UNKNOWN) {
      if (token.raw.startsWith('\\')) {
        throw new Error(`Unsupported logic command: ${token.raw}`);
      }
      output += escapeUnknown(token.value);
      pendingWhitespace = false;
      return;
    }

    if (token.type === LOGIC_TOKEN.KATEX_COMMAND) {
      output += token.raw;
      pendingWhitespace = false;
      return;
    }

    if (token.type === LOGIC_TOKEN.QUANTIFIER) {
      if (previous?.type === LOGIC_TOKEN.IDENTIFIER && previousPrevious?.type === LOGIC_TOKEN.QUANTIFIER) {
        output += '\\,';
      }
      output += `${SYMBOL_LATEX[token.value]} `;
      pendingWhitespace = false;
      return;
    }

    if (token.type === LOGIC_TOKEN.CONNECTIVE) {
      output += `${SYMBOL_LATEX[token.value]} `;
      pendingWhitespace = false;
      return;
    }

    if (token.type === LOGIC_TOKEN.EQUALITY) {
      output += `${SYMBOL_LATEX[token.value]} `;
      pendingWhitespace = false;
      return;
    }

    if (token.type === LOGIC_TOKEN.IDENTIFIER) {
      if (pendingWhitespace && previous?.type === LOGIC_TOKEN.IDENTIFIER) output += '\\ ';
      output += formatIdentifier(token.value);
      pendingWhitespace = false;
      return;
    }

    if (token.type === LOGIC_TOKEN.COMMA) {
      output = output.replace(/\s+$/u, '');
      output += ',';
      pendingWhitespace = false;
      return;
    }

    if (OPEN_TYPES.has(token.type)) {
      const isFunctionCall = token.type === LOGIC_TOKEN.LPAREN && previous?.type === LOGIC_TOKEN.IDENTIFIER;
      const scalable = !isFunctionCall;
      delimiterStack.push({ value: token.value, scalable });
      if (token.value === '(') output += scalable ? '\\left(' : '(';
      if (token.value === '[') output += '\\left[';
      if (token.value === '{') output += '\\left\\{';
      pendingWhitespace = false;
      return;
    }

    const opening = delimiterStack.pop();
    output = output.replace(/\s+$/u, '');
    if (token.value === ')') output += opening?.scalable ? '\\right)' : ')';
    if (token.value === ']') output += '\\right]';
    if (token.value === '}') output += '\\right\\}';
    pendingWhitespace = false;
  });

  return output.trim();
}
