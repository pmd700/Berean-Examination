/**
 * Converts API.Bible JSON content or passage responses into BEX Study blocks.
 * Robustly parses:
 * - Individual verses (from USX 2 <char style="v">, USX 3 <verse number="...">, <span class="v">, etc.)
 * - Footnotes, cross-references, and commentary (<note>, <f>, <x>, etc.)
 * - Words-of-Jesus (wj) character spans for red letter styling
 * - Section headers (<para style="s1">, etc.)
 */

export function tokenizeText(text) {
  return String(text || '').split(/(\s+)/);
}

/**
 * Extracts plain text recursively from a node tree (e.g. for note bodies or headings).
 */
export function extractRawText(node) {
  if (!node) return '';
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text;
  }
  if (Array.isArray(node.items)) {
    return node.items.map(extractRawText).join('');
  }
  return '';
}

// Keep publisher note formatting without treating its reference or body as
// scripture. Offsets are measured in the same UTF-16 string as token indices.
function extractNoteSegments(node, italic = false) {
  if (['fr', 'xr'].includes(node.attrs?.style)) return [];
  if (node.type === 'text') return [{ type: italic ? 'italic' : 'text', text: node.text || '' }];
  return (node.items || []).flatMap(child => extractNoteSegments(child, italic || node.attrs?.style === 'it'));
}

function finishVerse(verse, defaultVerseNumber) {
  const text = verse.text.trim();
  const leading = verse.text.length - verse.text.trimStart().length;
  return {
    type: 'verse', verseNumber: verse.verseNumber || defaultVerseNumber, text,
    wjTokens: computeWjTokens(text, verse.wjSpans.map(span => ({ start: span.start - leading, end: span.end - leading }))),
    notes: verse.notes.map(note => ({ ...note, offset: Math.max(0, Math.min(text.length, note.offset - leading)) })),
  };
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
 * Identifies if a node represents a verse start milestone or marker,
 * returning its verse number (integer) or null.
 */
export function getVerseMarkerNumber(node) {
  if (!node) return null;

  // Form 1: <verse number="N" ...> or <verse sid="BOOK C:V" ...>
  if (node.name === 'verse') {
    if (node.attrs?.eid) return null; // End milestone
    if (node.attrs?.number) {
      const n = parseInt(node.attrs.number, 10);
      if (n > 0) return n;
    }
    if (node.attrs?.sid) {
      const m = node.attrs.sid.match(/[:.](\d+)\b/) || node.attrs.sid.match(/\s+(\d+)\b/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > 0) return n;
      }
    }
    if (Array.isArray(node.items)) {
      for (const it of node.items) {
        if (it.type === 'text' && typeof it.text === 'string') {
          const m = it.text.trim().match(/^(\d+)/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > 0) return n;
          }
        }
      }
    }
  }

  // Form 2: <char style="v">N</char> or <span class="v">N</span>
  const isVerseStyle = node.attrs?.style === 'v' || node.attrs?.class === 'v';
  if (isVerseStyle) {
    if (node.attrs?.number) {
      const n = parseInt(node.attrs.number, 10);
      if (n > 0) return n;
    }
    if (node.attrs?.['data-number']) {
      const n = parseInt(node.attrs['data-number'], 10);
      if (n > 0) return n;
    }
    if (Array.isArray(node.items)) {
      for (const it of node.items) {
        if (it.type === 'text' && typeof it.text === 'string') {
          const m = it.text.trim().match(/^(\d+)/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > 0) return n;
          }
        }
      }
    }
  }

  // Form 3: data-number attribute
  if (node.attrs?.['data-number']) {
    const n = parseInt(node.attrs['data-number'], 10);
    if (n > 0) return n;
  }

  return null;
}

/**
 * Checks if a node represents a note (footnote, cross-reference, commentary).
 */
export function isNoteNode(node) {
  if (!node) return false;
  if (node.name === 'note' || node.name === 'footnote') return true;
  const style = node.attrs?.style;
  if (style === 'f' || style === 'x' || style === 'fe' || style === 'ef') return true;
  return false;
}

/**
 * Checks if a node represents a section heading or title.
 */
export function isHeadingNode(node) {
  if (!node) return false;
  if (node.name === 'heading') return true;
  if (node.name === 'para' && /^(s|s\d|ms|ms\d|r|mr|d|qa|sp)$/.test(node.attrs?.style || '')) return true;
  return false;
}

/**
 * Parses HTML string content into structured Study blocks when the API returns HTML instead of AST.
 */
export function parseHtmlOrTextContentToBlocks(contentStr, defaultVerseNumber = 1) {
  if (!contentStr || typeof contentStr !== 'string') return [];
  const trimmed = contentStr.trim();
  if (!trimmed) return [];

  // If it doesn't look like HTML tags, return plain verse
  if (!/<[a-z][\s\S]*>/i.test(trimmed)) {
    return [{
      type: 'verse',
      verseNumber: defaultVerseNumber,
      text: trimmed,
      wjTokens: new Set(),
      notes: [],
    }];
  }

  // If DOMParser is available (browser/jsdom)
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${trimmed}</div>`, 'text/html');
      const root = doc.body.firstElementChild || doc.body;

      const blocks = [];
      let currentVerse = null;

      const flushVerse = () => {
        if (!currentVerse) return;
        const cleanText = currentVerse.text.trim();
        if (cleanText || currentVerse.notes.length > 0) {
          blocks.push(finishVerse(currentVerse, defaultVerseNumber));
        }
        currentVerse = null;
      };

      const startVerse = (num) => {
        flushVerse();
        currentVerse = { verseNumber: num, text: '', wjSpans: [], notes: [] };
      };

      const walkDom = (node, inWj = false) => {
        if (!node) return;

        if (node.nodeType === 1) { // Element
          const el = node;
          const tagName = el.tagName.toLowerCase();
          const cls = el.className || '';

          // Headings
          if (/^h[1-6]$/.test(tagName) || /\b(s|s1|s2|ms|ms1)\b/.test(cls)) {
            flushVerse();
            const text = el.textContent?.trim() || '';
            if (text) blocks.push({ type: 'header', text });
            return;
          }

          // Footnotes / commentary
          if (tagName === 'note' || /\b(f|x|fe|footnote)\b/.test(cls)) {
            if (!currentVerse) startVerse(defaultVerseNumber);
            const caller = el.getAttribute('caller') || '*';
            const noteText = el.textContent?.trim() || '';
            if (noteText) {
              currentVerse.notes.push({
                caller,
                text: noteText,
                type: /\bx\b/.test(cls) ? 'cross-reference' : 'footnote',
                offset: currentVerse.text.length,
              });
            }
            return; // Do NOT include note in verse text
          }

          // Verse markers
          if (/\bv\b/.test(cls) || el.hasAttribute('data-number') || tagName === 'verse') {
            const rawNum = el.getAttribute('data-number') || el.getAttribute('number') || el.textContent;
            const parsedNum = parseInt(rawNum || '', 10);
            if (parsedNum > 0) {
              startVerse(parsedNum);
              return;
            }
          }

          const isWj = inWj || /\bwj\b/.test(cls);
          for (let child = el.firstChild; child; child = child.nextSibling) {
            walkDom(child, isWj);
          }
          return;
        }

        if (node.nodeType === 3) { // Text node
          const text = node.textContent || '';
          if (text) {
            if (!currentVerse) startVerse(defaultVerseNumber);
            const start = currentVerse.text.length;
            currentVerse.text += text;
            const end = currentVerse.text.length;
            if (inWj) {
              currentVerse.wjSpans.push({ start, end });
            }
          }
        }
      };

      walkDom(root, false);
      flushVerse();
      return blocks;
    } catch {
      // Fall through to regex fallback
    }
  }

  // Regex fallback
  return [{
    type: 'verse',
    verseNumber: defaultVerseNumber,
    text: trimmed.replace(/<[^>]+>/g, '').trim(),
    wjTokens: new Set(),
    notes: [],
  }];
}

/**
 * Extracts blocks ({ type: 'header', text } or { type: 'verse', verseNumber, text, wjTokens, notes })
 * from an API.Bible content response.
 */
export function convertApiBibleContentToBlocks(data, defaultVerseNumber = 1) {
  if (!data) return [];

  const content = data.content;
  if (!content) return [];

  const blocks = [];
  let currentVerse = null;

  const flushVerse = () => {
    if (!currentVerse) return;
    const cleanText = currentVerse.text.trim();
    if (cleanText || currentVerse.notes.length > 0) {
      blocks.push(finishVerse(currentVerse, defaultVerseNumber));
    }
    currentVerse = null;
  };

  const startVerse = (num) => {
    flushVerse();
    currentVerse = {
      verseNumber: num,
      text: '',
      wjSpans: [],
      notes: [],
    };
  };

  const appendText = (textStr, inWj) => {
    if (!textStr) return;
    if (!currentVerse) {
      startVerse(defaultVerseNumber);
    }
    const start = currentVerse.text.length;
    currentVerse.text += textStr;
    const end = currentVerse.text.length;
    if (inWj) {
      currentVerse.wjSpans.push({ start, end });
    }
  };

  // If content is an array of AST nodes
  if (Array.isArray(content)) {
    const walk = (node, inWj = false) => {
      if (!node) return;

      // 1. Heading node: flushes current verse and pushes header block
      if (isHeadingNode(node)) {
        flushVerse();
        const headerText = extractRawText(node).trim();
        if (headerText) {
          blocks.push({ type: 'header', text: headerText });
        }
        return;
      }

      // 2. Verse marker: starts a new verse
      const verseNum = getVerseMarkerNumber(node);
      if (verseNum !== null) {
        startVerse(verseNum);
        return;
      }

      // 3. Verse end milestone: ignore
      if (node.name === 'verse' && node.attrs?.eid) {
        return;
      }

      // 4. Note node: extract note commentary/cross-reference without polluting verse text
      if (isNoteNode(node)) {
        if (!currentVerse) {
          startVerse(defaultVerseNumber);
        }
        const caller = node.attrs?.caller || '*';
        const noteType = node.attrs?.style === 'x' ? 'cross-reference' : 'footnote';
        const noteText = extractRawText(node).trim();
        if (noteText) {
          currentVerse.notes.push({
            caller,
            text: noteText,
            type: noteType,
            offset: currentVerse.text.length,
            markerId: node.attrs?.id,
            noteSegments: extractNoteSegments(node),
          });
        }
        return; // Do NOT traverse into note children for verse text
      }

      // 5. Text node
      if (node.type === 'text' && typeof node.text === 'string') {
        // If the text node itself has a verseId attribute (e.g. "ROM.3.5")
        if (node.attrs?.verseId) {
          const vParts = node.attrs.verseId.split('.');
          const vNum = parseInt(vParts[vParts.length - 1], 10);
          if (vNum > 0 && currentVerse && currentVerse.verseNumber !== vNum && currentVerse.text.length > 0) {
            startVerse(vNum);
          }
        }
        appendText(node.text, inWj);
        return;
      }

      // 6. Child traversal
      const nextInWj = inWj || (node.name === 'char' && node.attrs?.style === 'wj');

      // Paragraph spacing between paragraphs
      if (node.name === 'para' && currentVerse && currentVerse.text.length > 0 && !/\s$/.test(currentVerse.text)) {
        currentVerse.text += ' ';
      }

      if (Array.isArray(node.items)) {
        for (const child of node.items) {
          walk(child, nextInWj);
        }
      }
    };

    for (const node of content) {
      walk(node, false);
    }

    flushVerse();
    return blocks;
  }

  // HTML / string fallback
  if (typeof content === 'string') {
    return parseHtmlOrTextContentToBlocks(content, defaultVerseNumber);
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
      const requestIndex = resultIdx++;
      const res = batchResults[requestIndex];
      if (!res || !res.data) {
        const span = req.id.match(/^[^.]+\.(\d+)(?:\.(\d+)(?:-[^.]+\.(\d+)\.(\d+))?)?$/);
        const reference = span
          ? `${group.book.name} ${span[1]}${span[2] ? `:${span[2]}` : ''}${span[4] ? `–${span[3] === span[1] ? '' : `${span[3]}:`}${span[4]}` : ''}`
          : group.label;
        blocks.push({ type: 'request', requestIndex, status: res?.status || (res?.error ? 'error' : 'pending'),
          reference, error: res?.error });
        continue;
      }

      // Default verse number from request id if available (e.g. "REV.4.1" -> 1)
      const idParts = req.id.split('.');
      const fallbackNum = req.type === 'chapter' ? 1 : (parseInt(idParts[idParts.length - 1], 10) || 1);

      const unitBlocks = convertApiBibleContentToBlocks(res.data, fallbackNum);
      for (const b of unitBlocks) {
        blocks.push({ ...b, studyLocator: { book: group.book.name, chapter_number: parseInt(idParts[1], 10) } });
        if (b.type === 'header') {
          rawTextLines.push(`### ${b.text}`);
        } else if (b.type === 'verse') {
          rawTextLines.push(`~${b.verseNumber} ${b.text}`);
        }
      }
    }
  }

  const firstBookName = queryResult.groups[0]?.book?.name || 'Scripture';
  const firstChapter = parseInt(queryResult.requests[0]?.id.split('.')[1], 10) || 1;

  return {
    id: `search-${Date.now()}`,
    book: firstBookName,
    chapter_number: firstChapter,
    title: queryResult.summary || firstBookName,
    version: versionAbbr,
    scripture_source: 'api',
    api_copyright: [...new Set(batchResults.map(result => result?.data?.copyright).filter(value => typeof value === 'string' && value.trim()))].join('\n'),
    raw_text: rawTextLines.join('\n'),
    blocks,
  };
}
