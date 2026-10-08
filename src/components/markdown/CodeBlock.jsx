import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

// Clean code block with a language label and copy button. Used for every
// non-Mermaid fenced block.
export default function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);
  const source = (code || '').replace(/\n$/, '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div className="berean-md-card berean-code" data-testid="code-block">
      <div className="berean-code-head">
        <span className="berean-code-lang">{language || 'text'}</span>
        <button
          type="button"
          className="berean-md-toggle berean-code-copy"
          onClick={copy}
          data-testid="button-copy-code"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="berean-md-pre">
        <code className={language ? `language-${language}` : undefined}>{source}</code>
      </pre>
    </div>
  );
}
