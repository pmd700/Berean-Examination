// Native writes avoid Chromium permission prompts in the locked-down desktop.
export async function writeClipboardText(text) {
  const bridge = window.bexDesktop;
  if (bridge?.isDesktop && typeof bridge.writeClipboardText === 'function') {
    try {
      const result = await bridge.writeClipboardText(text);
      if (!result?.ok) throw new Error(result?.error || 'Could not copy text.');
      return;
    } catch {
      // A refreshed preload can outlive the main process that registered its
      // IPC handler. Recover through the ordinary Copy event in that case.
      copyWithSelection(text);
      return;
    }
  }

  // An already-running desktop process may still have the previous preload.
  // Its existing Copy command remains available without restarting the app.
  if (bridge?.isDesktop) {
    copyWithSelection(text);
    return;
  }
  try {
    copyWithSelection(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

function copyWithSelection(text) {
  const focused = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;';
  document.body.appendChild(field);
  const onCopy = (event) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Window capture runs before other open editors' document Copy handlers.
  // Supplying the payload explicitly works with BEX's denied permissions.
  window.addEventListener('copy', onCopy, true);
  try {
    field.focus({ preventScroll: true });
    field.select();
    if (!document.execCommand('copy')) throw new Error('Could not copy text.');
  } finally {
    window.removeEventListener('copy', onCopy, true);
    field.remove();
    focused?.focus?.({ preventScroll: true });
    selection?.removeAllRanges();
    ranges.forEach(range => selection?.addRange(range));
  }
}
