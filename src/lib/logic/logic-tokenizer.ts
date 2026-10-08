export const LOGIC_TOKEN = Object.freeze({
  QUANTIFIER: 'QUANTIFIER',
  CONNECTIVE: 'CONNECTIVE',
  IDENTIFIER: 'IDENTIFIER',
  COMMA: 'COMMA',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  LBRACKET: 'LBRACKET',
  RBRACKET: 'RBRACKET',
  LBRACE: 'LBRACE',
  RBRACE: 'RBRACE',
  EQUALITY: 'EQUALITY',
  KATEX_COMMAND: 'KATEX_COMMAND',
  WHITESPACE: 'WHITESPACE',
  UNKNOWN: 'UNKNOWN',
});

const SYMBOL_TYPES = Object.freeze({
  '∀': LOGIC_TOKEN.QUANTIFIER,
  '∃': LOGIC_TOKEN.QUANTIFIER,
  '¬': LOGIC_TOKEN.CONNECTIVE,
  '∧': LOGIC_TOKEN.CONNECTIVE,
  '∨': LOGIC_TOKEN.CONNECTIVE,
  '→': LOGIC_TOKEN.CONNECTIVE,
  '↔': LOGIC_TOKEN.CONNECTIVE,
  '⊃': LOGIC_TOKEN.CONNECTIVE,
  '⊢': LOGIC_TOKEN.CONNECTIVE,
  '⊨': LOGIC_TOKEN.CONNECTIVE,
  '∴': LOGIC_TOKEN.CONNECTIVE,
  '∵': LOGIC_TOKEN.CONNECTIVE,
  '=': LOGIC_TOKEN.EQUALITY,
  '≠': LOGIC_TOKEN.EQUALITY,
  '≡': LOGIC_TOKEN.EQUALITY,
  '<': LOGIC_TOKEN.EQUALITY,
  '>': LOGIC_TOKEN.EQUALITY,
  '≤': LOGIC_TOKEN.EQUALITY,
  '≥': LOGIC_TOKEN.EQUALITY,
  ',': LOGIC_TOKEN.COMMA,
  '(': LOGIC_TOKEN.LPAREN,
  ')': LOGIC_TOKEN.RPAREN,
  '[': LOGIC_TOKEN.LBRACKET,
  ']': LOGIC_TOKEN.RBRACKET,
  '{': LOGIC_TOKEN.LBRACE,
  '}': LOGIC_TOKEN.RBRACE,
});

const COMMAND_SYMBOLS = Object.freeze({
  forall: '∀',
  exists: '∃',
  neg: '¬',
  land: '∧',
  wedge: '∧',
  lor: '∨',
  vee: '∨',
  to: '→',
  rightarrow: '→',
  implies: '→',
  leftrightarrow: '↔',
  iff: '↔',
  supset: '⊃',
  vdash: '⊢',
  models: '⊨',
  therefore: '∴',
  because: '∵',
  ne: '≠',
  neq: '≠',
  equiv: '≡',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
});

const KATEX_COMMANDS = new Set(['boxed', 'text', 'boxtext', ';']);

function isIdentifierCharacter(character: string) {
  return /[\p{L}\p{N}_']/u.test(character);
}

export type LogicToken = {
  type: string;
  value: string;
  raw: string;
  offset: number;
};

export function tokenizeLogic(input: string): LogicToken[] {
  const source = String(input ?? '');
  const tokens: LogicToken[] = [];

  for (let index = 0; index < source.length;) {
    const character = source[index];

    if (/\s/u.test(character)) {
      const start = index;
      while (index < source.length && /\s/u.test(source[index])) index += 1;
      const raw = source.slice(start, index);
      tokens.push({ type: LOGIC_TOKEN.WHITESPACE, value: raw, raw, offset: start });
      continue;
    }

    if (character === '\\') {
      const start = index;
      index += 1;
      if (source[index] === ';') {
        index += 1;
      } else {
        while (index < source.length && /[A-Za-z]/.test(source[index])) index += 1;
      }
      const raw = source.slice(start, index);
      const command = raw.slice(1);
      const symbol = COMMAND_SYMBOLS[command as keyof typeof COMMAND_SYMBOLS];
      tokens.push({
        type: symbol
          ? SYMBOL_TYPES[symbol as keyof typeof SYMBOL_TYPES]
          : KATEX_COMMANDS.has(command)
            ? LOGIC_TOKEN.KATEX_COMMAND
            : LOGIC_TOKEN.UNKNOWN,
        value: symbol || raw,
        raw,
        offset: start,
      });
      continue;
    }

    const symbolType = SYMBOL_TYPES[character as keyof typeof SYMBOL_TYPES];
    if (symbolType) {
      tokens.push({ type: symbolType, value: character, raw: character, offset: index });
      index += 1;
      continue;
    }

    if (isIdentifierCharacter(character)) {
      const start = index;
      while (index < source.length && isIdentifierCharacter(source[index])) index += 1;
      const raw = source.slice(start, index);
      tokens.push({ type: LOGIC_TOKEN.IDENTIFIER, value: raw, raw, offset: start });
      continue;
    }

    tokens.push({ type: LOGIC_TOKEN.UNKNOWN, value: character, raw: character, offset: index });
    index += 1;
  }

  return tokens;
}

export function isKnownLogicCommand(raw: string) {
  return raw.startsWith('\\')
    && (raw.slice(1) in COMMAND_SYMBOLS || KATEX_COMMANDS.has(raw.slice(1)));
}
