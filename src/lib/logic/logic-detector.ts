import { LOGIC_TOKEN, tokenizeLogic } from './logic-tokenizer';

const STRONG_SYMBOL_RE = /[∀∃¬∧∨→↔⊃⊢⊨∴∵]/u;
const STRONG_COMMAND_RE = /\\(?:forall|exists|neg|land|wedge|lor|vee|to|rightarrow|implies|leftrightarrow|iff|supset|vdash|models|therefore|because|boxed|text|boxtext)\b/u;

export type DetectedLogic = {
  source: string;
  sourceFormat: 'unicode' | 'latex';
  display: 'inline' | 'block';
  explicit: boolean;
};

function normalizedLines(input: string) {
  return String(input ?? '').replace(/\r\n?/g, '\n').trim().split('\n');
}

function explicitLogic(input: string): DetectedLogic | null {
  const trimmed = String(input ?? '').replace(/\r\n?/g, '\n').trim();
  if (!trimmed) return null;

  const inline = /^\{\{logic:\s*([\s\S]*?)\s*\}\}$/iu.exec(trimmed);
  if (inline) {
    return {
      source: inline[1].trim(),
      sourceFormat: detectLogicSourceFormat(inline[1]),
      display: 'inline',
      explicit: true,
    };
  }

  const fenced = /^:::logic\s*\n([\s\S]*?)\n\s*:::\s*$/iu.exec(trimmed);
  if (fenced) {
    return {
      source: fenced[1].trim(),
      sourceFormat: detectLogicSourceFormat(fenced[1]),
      display: 'block',
      explicit: true,
    };
  }

  const texDisplay = /^\\\[\s*([\s\S]*?)\s*\\\]$/u.exec(trimmed);
  if (texDisplay) {
    return { source: texDisplay[1].trim(), sourceFormat: 'latex', display: 'block', explicit: true };
  }

  const dollarDisplay = /^\$\$\s*([\s\S]*?)\s*\$\$$/u.exec(trimmed);
  if (dollarDisplay) {
    return { source: dollarDisplay[1].trim(), sourceFormat: 'latex', display: 'block', explicit: true };
  }

  // ChatGPT-style raw copy: a standalone `[` line, formula, standalone `]` line.
  const lines = normalizedLines(trimmed);
  if (lines.length >= 3 && lines[0].trim() === '[' && lines.at(-1)?.trim() === ']') {
    const source = lines.slice(1, -1).join('\n').trim();
    return { source, sourceFormat: detectLogicSourceFormat(source), display: 'block', explicit: true };
  }

  return null;
}

export function hasBalancedLogicDelimiters(input: string) {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const token of tokenizeLogic(input)) {
    if ([LOGIC_TOKEN.LPAREN, LOGIC_TOKEN.LBRACKET, LOGIC_TOKEN.LBRACE].includes(token.type)) {
      stack.push(token.value);
    } else if ([LOGIC_TOKEN.RPAREN, LOGIC_TOKEN.RBRACKET, LOGIC_TOKEN.RBRACE].includes(token.type)) {
      if (stack.pop() !== pairs[token.value]) return false;
    }
  }
  return stack.length === 0;
}

export function detectLogicSourceFormat(input: string): 'unicode' | 'latex' {
  return /\\[A-Za-z]+/u.test(String(input ?? '')) ? 'latex' : 'unicode';
}

function heuristicLogic(input: string) {
  const source = String(input ?? '').trim();
  if (!source || /```|https?:\/\/|www\./iu.test(source)) return false;
  if (!hasBalancedLogicDelimiters(source)) return false;
  if (!STRONG_SYMBOL_RE.test(source) && !STRONG_COMMAND_RE.test(source)) return false;
  if (!/[\p{L}]/u.test(source)) return false;

  const tokens = tokenizeLogic(source).filter((token) => token.type !== LOGIC_TOKEN.WHITESPACE);
  const operatorCount = tokens.filter((token) =>
    token.type === LOGIC_TOKEN.QUANTIFIER || token.type === LOGIC_TOKEN.CONNECTIVE
  ).length;
  const identifiers = tokens.filter((token) => token.type === LOGIC_TOKEN.IDENTIFIER);
  const hasGrouping = tokens.some((token) =>
    [LOGIC_TOKEN.LPAREN, LOGIC_TOKEN.LBRACKET, LOGIC_TOKEN.LBRACE].includes(token.type)
  );
  const isShortProposition = identifiers.length > 0
    && identifiers.length <= 4
    && identifiers.every((token) => /^[A-Z](?:\d+)?$/u.test(token.value));

  return operatorCount >= 2 || hasGrouping || isShortProposition;
}

export function isProbablyLogic(input: string): boolean {
  const explicit = explicitLogic(input);
  if (explicit) return true;
  return heuristicLogic(input);
}

export function detectLogicInput(input: string): DetectedLogic | null {
  const explicit = explicitLogic(input);
  if (explicit) return explicit;

  const source = String(input ?? '').trim();
  if (!heuristicLogic(source)) return null;
  return {
    source,
    sourceFormat: detectLogicSourceFormat(source),
    display: 'block',
    explicit: false,
  };
}
