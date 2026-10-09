/**
 * Converts API.Bible JSON content or passage responses into BEX Study blocks.
 * Tracks words-of-Jesus (wj) token indices so the Study engine can render
 * them in red letters while preserving all highlighting and annotation positions.
 */

export function tokenizeText(text) {
  return String(text || '').split(/(\s+)/);
}

/**
 * Extracts plain text and character spans marked as words of Jesus (style === 'wj')
 * from an API.Bible JSON AST node tree.
 */
function extractTextAndWjSpans(node, state = { text: '', inWj: false, wjSpans: [] }) {
  if (!node) return state;

  if (node.type === 'text' && typeof node.text === 'string') {
    const start = state.text.length;
    state.text += node.text;
    const end = state.text.length;
    if (state.inWj) {
      state.wjSpans.push({ start, end });
    }
    return state;
  }

  if (node.type === 'tag') {
    // If it's a verse marker tag, don't include its number in the verse body text
    if (node.name === 'verse') {
      return state;
    }

    const isWj = node.name === 'char' && node.attrs?.style === 'wj';
    const wasWj = state.inWj;
    if (isWj) state.inWj = true;

    if (Array.isArray(node.items)) {
      for (const child of node.items) {
        extractTextAndWjSpans(child, state);
      }
    }

    state.inWj = wasWj;
  }

  return state;
}

/**
 * Given plain text and wj character spans, identifies which token indices
 * in tokenizeText(text) fall inside words of Jesus.
 */
export function computeWjTokens(text, wjSpans) {
  const tokens = tokenizeText(text);
  const wjTokens = new Set();
  if (!wjSpans || wjSpans.length === 0) return wjTokens;

  let offset = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const tokStart = offset;
    const tokEnd = offset + tok.length;
    offset = tokEnd;

    // Check if non-whitespace token overlaps any wj span
    if (!/^\s+$/.test(tok) && tok.length > 0) {
      const overlaps = wjSpans.some((span) => tokStart < span.end && tokEnd > span.start);
      if (overlaps) {
        wjTokens.add(i);
      }
    }
  }

  return wjTokens;
}

/**
 * Extracts blocks ({ type: 'header', text } or { type: 'verse', verseNumber, text, wjTokens })
 * from an API.Bible content response.
 */
export function convertApiBibleContentToBlocks(data, defaultVerseNumber = 1) {
  if (!data) return [];

  const content = data.content;
  if (!content) return [];

  const blocks = [];

  // If content is an array of AST nodes
  if (Array.isArray(content)) {
    let currentVerseNum = defaultVerseNumber;
    let currentVerseNodes = [];

    const flushCurrentVerse = () => {
      if (currentVerseNodes.length === 0) return;
      const state = { text: '', inWj: false, wjSpans: [] };
      for (const node of currentVerseNodes) {
        extractTextAndWjSpans(node, state);
      }
      const cleanText = state.text.trim();
      if (cleanText) {
        const wjTokens = computeWjTokens(cleanText, state.wjSpans);
        blocks.push({
          type: 'verse',
          verseNumber: currentVerseNum,
          text: cleanText,
          wjTokens,
        });
      }
      currentVerseNodes = [];
    };

    for (const node of content) {
      if (node.type === 'tag') {
        // Section titles: para with style 's1', 's', 'ms1', etc.
        if (node.name === 'para' && /^(s|s\d|ms|ms\d)$/.test(node.attrs?.style || '')) {
          flushCurrentVerse();
          const titleState = { text: '', inWj: false, wjSpans: [] };
          extractTextAndWjSpans(node, titleState);
          const titleText = titleState.text.trim();
          if (titleText) {
            blocks.push({ type: 'header', text: titleText });
          }
          continue;
        }

        // Check if node contains verse markers inside items
        if (Array.isArray(node.items)) {
          for (const item of node.items) {
            if (item.type === 'tag' && item.name === 'verse') {
              flushCurrentVerse();
              const numParsed = parseInt(item.attrs?.number || '0', 10);
              if (numParsed > 0) {
                currentVerseNum = numParsed;
              }
            } else {
              currentVerseNodes.push(item);
            }
          }
          continue;
        }
      }

      currentVerseNodes.push(node);
    }

    flushCurrentVerse();
    return blocks;
  }

  // String fallback
  if (typeof content === 'string') {
    return [{
      type: 'verse',
      verseNumber: defaultVerseNumber,
      text: content.trim(),
      wjTokens: new Set(),
    }];
  }

  return blocks;
}

/**
 * Converts the full batch of parsed groups and fetched results into
 * a unified Study chapter object ready for consumption by Study.jsx.
 */
export function buildStudyChapterFromBatch(queryResult, batchResults, versionAbbr = 'BSB') {
  const blocks = [];
  const rawTextLines = [];

  let resultIdx = 0;
  for (const group of queryResult.groups) {
    // Add a section header for the reference group
    blocks.push({
      type: 'header',
      text: group.label,
    });
    rawTextLines.push(`### ${group.label}`);

    for (const req of group.requests) {
      const res = batchResults[resultIdx++];
      if (!res || !res.data) {
        if (res?.error) {
          blocks.push({
            type: 'header',
            text: `(Unavailable: ${res.error})`,
          });
        }
        continue;
      }

      // Default verse number from request id if available (e.g. "REV.4.1" -> 1)
      const idParts = req.id.split('.');
      const fallbackNum = parseInt(idParts[idParts.length - 1], 10) || 1;

      const unitBlocks = convertApiBibleContentToBlocks(res.data, fallbackNum);
      for (const b of unitBlocks) {
        blocks.push(b);
        if (b.type === 'header') {
          rawTextLines.push(`### ${b.text}`);
        } else if (b.type === 'verse') {
          rawTextLines.push(`~${b.verseNumber} ${b.text}`);
        }
      }
    }
  }

  const firstBookName = queryResult.groups[0]?.book?.name || 'Scripture';
  const firstChapter = queryResult.groups[0]?.lastChapter || 1;

  return {
    id: `search-${Date.now()}`,
    book: firstBookName,
    chapter_number: firstChapter,
    title: queryResult.summary || firstBookName,
    version: versionAbbr,
    raw_text: rawTextLines.join('\n'),
    blocks,
  };
}
