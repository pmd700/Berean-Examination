import { detectLogicInput, isProbablyLogic } from './logic-detector';

function logicTag(source: string, sourceFormat: 'unicode' | 'latex', display: 'inline' | 'block') {
  return `<bex-logic format="${sourceFormat}" display="${display}">${encodeURIComponent(source)}</bex-logic>`;
}

function replaceInlineLogic(line: string) {
  return line.replace(/\{\{logic:\s*([\s\S]*?)\s*\}\}/giu, (_match, source) => {
    const detected = detectLogicInput(`{{logic: ${source}}}`);
    return detected ? logicTag(detected.source, detected.sourceFormat, 'inline') : _match;
  });
}

function findClosingLine(lines: string[], start: number, marker: string) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === marker) return index;
  }
  return -1;
}

export function preprocessLogicMarkdown(input: string) {
  const source = String(input ?? '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const output: string[] = [];
  let inCodeFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^```|^~~~/u.test(trimmed)) {
      inCodeFence = !inCodeFence;
      output.push(line);
      continue;
    }
    if (inCodeFence) {
      output.push(line);
      continue;
    }

    if (/^:::logic\s*$/iu.test(trimmed)) {
      const end = findClosingLine(lines, index, ':::');
      if (end > index) {
        const formula = lines.slice(index + 1, end).join('\n').trim();
        const detected = detectLogicInput(`:::logic\n${formula}\n:::`);
        if (detected) {
          output.push('', logicTag(detected.source, detected.sourceFormat, 'block'), '');
          index = end;
          continue;
        }
      }
    }

    const displayMarkers: Record<string, string> = { '[': ']', '\\[': '\\]', '$$': '$$' };
    const closingMarker = displayMarkers[trimmed];
    if (closingMarker) {
      const end = findClosingLine(lines, index, closingMarker);
      if (end > index) {
        const candidate = lines.slice(index, end + 1).join('\n');
        const detected = detectLogicInput(candidate);
        if (detected) {
          output.push('', logicTag(detected.source, detected.sourceFormat, 'block'), '');
          index = end;
          continue;
        }
      }
    }

    // Explicit inline markup is authoritative. Process it before the
    // standalone-formula heuristic so surrounding prose stays ordinary text.
    if (/\{\{logic:/iu.test(line)) {
      output.push(replaceInlineLogic(line));
      continue;
    }

    if (trimmed && isProbablyLogic(trimmed)) {
      const detected = detectLogicInput(trimmed);
      if (detected) {
        output.push('', logicTag(detected.source, detected.sourceFormat, 'block'), '');
        continue;
      }
    }

    output.push(replaceInlineLogic(line));
  }

  return output.join('\n');
}
