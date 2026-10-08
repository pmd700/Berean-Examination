import { tokenizeLogic } from './logic-tokenizer';

export type LogicPresentation = 'math' | 'text' | 'boxed-text';

/** Adapt the existing logic vocabulary to real, editable text characters. */
export function editableLogicContent(input: string): { text: string; presentation: LogicPresentation } {
  const source = String(input ?? '');
  const boxText = /^\\boxtext\{([^{}]*)\}$/u.exec(source.trim());
  const boxedText = /^\\boxed\{\s*(?:\\;)?\s*\\text\{([^{}]*)\}\s*(?:\\;)?\s*\}$/u.exec(source.trim());
  const plainText = /^\\text\{([^{}]*)\}$/u.exec(source.trim());
  const textCommand = boxText || boxedText || plainText;
  if (textCommand) {
    return { text: textCommand[1], presentation: plainText ? 'text' : 'boxed-text' };
  }

  // Use the same command allowlist as KaTeX conversion. Unknown/incomplete
  // commands stay literal, never disappear or become executable markup.
  return {
    text: tokenizeLogic(source).map(token => token.raw === '\\;' ? '\u2004' : token.value).join(''),
    presentation: 'math',
  };
}

export function editableLogicSource(text: string, presentation: LogicPresentation = 'math') {
  if (presentation === 'boxed-text') return `\\boxtext{${text}}`;
  if (presentation === 'text') return `\\text{${text}}`;
  return text;
}
