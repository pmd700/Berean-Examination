import { DOMSerializer, Slice } from '@tiptap/pm/model';
import { expandPointerEcho } from '../editor/pointerClipboard';
import { pageToMarkdown } from './bookExport';
import { getPageBody } from './bookModel';

export function copyNotePage(page, title, offset = 0, editor = null) {
  const heading = document.createElement('h1');
  heading.textContent = title;
  let body = getPageBody(page);
  if (editor && !editor.isDestroyed) {
    const doc = editor.state.doc;
    const copied = expandPointerEcho(new Slice(doc.content, 0, 0), doc);
    const wrapper = document.createElement('div');
    wrapper.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(copied.content));
    body = wrapper.innerHTML;
  }
  const html = heading.outerHTML + body;
  const text = `${title}\n\n${pageToMarkdown(body, offset)}`.trim();
  const focused = document.activeElement;
  const selection = window.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount || 0 }, (_, i) => selection.getRangeAt(i).cloneRange());
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  textarea.setAttribute('readonly', '');
  document.body.appendChild(textarea);
  const onCopy = (event) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', text);
  };
  // A synchronous copy from the button works with Electron's clipboard policy.
  document.addEventListener('copy', onCopy, true);
  try {
    textarea.select();
    return document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy, true);
    textarea.remove();
    focused?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}
