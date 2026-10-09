import React from 'react';

function renderItem(item, key, options) {
  if (!item) return null;

  if (item.type === 'text') {
    return <React.Fragment key={key}>{item.text}</React.Fragment>;
  }

  if (item.type === 'tag') {
    const { name, attrs, items } = item;

    // Verse number
    if (name === 'verse') {
      const num = attrs?.number || (items && items[0]?.text);
      return (
        <sup key={key} className="scripture-reader__verse-number" aria-hidden="true">
          {num}
        </sup>
      );
    }

    // Character styles
    if (name === 'char') {
      const style = attrs?.style;
      if (style === 'wj') {
        return (
          <span key={key} className="scripture-reader__wj">
            {(items || []).map((child, i) => renderItem(child, `${key}-${i}`, options))}
          </span>
        );
      }
      if (style === 'add') {
        return (
          <span key={key} className="scripture-reader__add">
            {(items || []).map((child, i) => renderItem(child, `${key}-${i}`, options))}
          </span>
        );
      }
      if (style === 'f') {
        // Footnote
        return (
          <span key={key} className="text-xs text-blue-400 opacity-70 px-0.5 cursor-help" title="Footnote">
            *
          </span>
        );
      }
      return (
        <span key={key} className={`scripture-char scripture-char--${style || 'default'}`}>
          {(items || []).map((child, i) => renderItem(child, `${key}-${i}`, options))}
        </span>
      );
    }

    // Verse span container
    if (name === 'verse-span') {
      return (
        <span key={key} className="scripture-reader__verse-span" data-verse-id={attrs?.verseId}>
          {(items || []).map((child, i) => renderItem(child, `${key}-${i}`, options))}
        </span>
      );
    }

    // Paragraph blocks
    if (name === 'para') {
      const style = attrs?.style;
      if (style === 's1' || style === 's') {
        return (
          <h3 key={key} className="scripture-reader__section-title">
            {(items || []).map((child, i) => renderItem(child, `${key}-${i}`, options))}
          </h3>
        );
      }
      if (style === 'q1') {
        return (
          <p key={key} className="scripture-reader__poetry-q1">
            {(items || []).map((child, i) => renderItem(child, `${key}-${i}`, options))}
          </p>
        );
      }
      if (style === 'q2') {
        return (
          <p key={key} className="scripture-reader__poetry-q2">
            {(items || []).map((child, i) => renderItem(child, `${key}-${i}`, options))}
          </p>
        );
      }
      if (style === 'b') {
        return <div key={key} className="h-3" aria-hidden="true" />;
      }
      return (
        <p key={key} className="scripture-reader__para">
          {(items || []).map((child, i) => renderItem(child, `${key}-${i}`, options))}
        </p>
      );
    }

    // Fallback for any other tag
    return (
      <span key={key}>
        {(items || []).map((child, i) => renderItem(child, `${key}-${i}`, options))}
      </span>
    );
  }

  return null;
}

export default function ScriptureContentRenderer({ content, redLetters = true }) {
  if (!content) return null;

  // Content can be an array of JSON node objects or a string fallback
  if (Array.isArray(content)) {
    return (
      <div className="scripture-reader__rendered-content">
        {content.map((block, idx) => renderItem(block, `block-${idx}`, { redLetters }))}
      </div>
    );
  }

  if (typeof content === 'string') {
    return <p className="scripture-reader__para">{content}</p>;
  }

  return null;
}
