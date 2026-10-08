/**
 * Dormant ESV provider retained for a future, explicitly enabled Online Mode.
 * Importing this module performs no network request. Callers must supply any
 * licensed API key and must enforce the user-controlled Online Mode boundary.
 */

export const ONLINE_BIBLE_VERSIONS = Object.freeze(['ESV']);

export function convertBracketedBibleText(rawText) {
  if (!rawText) return '';
  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
  const output = [];
  let currentVerse = null;
  let currentText = [];

  const saveVerse = () => {
    if (currentVerse !== null && currentText.length > 0) {
      output.push(`~${currentVerse} ${currentText.join(' ').replace(/\s+/g, ' ').trim()}`);
    }
    currentVerse = null;
    currentText = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matches = [...line.matchAll(/\[(\d+)\]/g)];
    if (matches.length > 0) {
      for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
        saveVerse();
        const match = matches[matchIndex];
        currentVerse = Number.parseInt(match[1], 10);
        const start = match.index + match[0].length;
        const end = matches[matchIndex + 1]?.index ?? line.length;
        const text = line.slice(start, end).trim();
        if (text) currentText.push(text);
      }
      continue;
    }

    const nextHasVerse = /\[\d+\]/.test(lines[index + 1] || '');
    const isHeading = currentVerse === null
      || (nextHasVerse && line.length <= 80 && /^[A-Z]/.test(line) && !/["'“”‘’]/.test(line));
    if (isHeading) {
      saveVerse();
      output.push(`### ${line}`);
    } else if (currentVerse !== null) {
      currentText.push(line);
    }
  }

  saveVerse();
  return output.join('\n').trim();
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOnlineBibleChapter({
  version,
  book,
  chapter,
  esvApiKey = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 9000,
}) {
  const normalizedVersion = String(version || '').trim().toUpperCase();
  const normalizedBook = String(book || '').trim();
  const normalizedChapter = Number(chapter);
  if (!ONLINE_BIBLE_VERSIONS.includes(normalizedVersion)) {
    throw new Error('Only the future Online Mode ESV provider is preserved.');
  }
  if (!normalizedBook || !Number.isSafeInteger(normalizedChapter) || normalizedChapter < 1) {
    throw new Error('Choose a valid Bible book and chapter.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Online Mode has no network provider.');

  if (!esvApiKey) throw new Error('The licensed ESV API key is not configured.');
  const url = `https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(normalizedBook)}+${normalizedChapter}&include-headings=true&include-verse-numbers=true&include-footnotes=false&include-short-copyright=false`;
  const response = await fetchWithTimeout(fetchImpl, url, {
    headers: { Authorization: `Token ${esvApiKey}` },
  }, timeoutMs);
  if (!response.ok) throw new Error(`ESV API returned HTTP ${response.status}.`);
  const payload = await response.json();
  const text = convertBracketedBibleText(payload?.passages?.[0] || '');
  if (!text) throw new Error('ESV API returned no readable chapter text.');
  return { book: normalizedBook, chapter: normalizedChapter, text, version: normalizedVersion };
}
