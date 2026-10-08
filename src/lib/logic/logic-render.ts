import katex from 'katex';
import { logicToLatex } from './logic-to-latex';

export type LogicRenderOptions = {
  display?: 'inline' | 'block';
  sourceFormat?: 'unicode' | 'latex';
  trustedLatex?: boolean;
};

export function renderLogicToHtml(source: string, options: LogicRenderOptions = {}) {
  try {
    const latex = logicToLatex(source, {
      sourceFormat: options.sourceFormat || 'unicode',
      trustedLatex: options.trustedLatex === true,
    });
    const html = katex.renderToString(latex, {
      displayMode: options.display === 'block',
      throwOnError: false,
      trust: false,
      strict: 'warn',
      output: 'htmlAndMathml',
      macros: {
        '\\boxtext': '\\boxed{\\;\\text{#1}\\;}',
      },
    });
    return { ok: true as const, html, latex, error: null };
  } catch (error) {
    return {
      ok: false as const,
      html: '',
      latex: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
