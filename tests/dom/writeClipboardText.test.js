import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboardText } from '@/lib/writeClipboardText';

afterEach(() => { delete window.bexDesktop; vi.restoreAllMocks(); });

describe('desktop clipboard writes', () => {
  it('uses the native bridge rather than a blocked browser API', async () => {
    const write = vi.fn(async () => ({ ok: true }));
    window.bexDesktop = { isDesktop: true, writeClipboardText: write };
    await writeClipboardText('Romans 1:1 (BSB)\nPaul...');
    expect(write).toHaveBeenCalledWith('Romans 1:1 (BSB)\nPaul...');
  });
  it('supports the previous preload and restores focus after copying', async () => {
    window.bexDesktop = { isDesktop: true };
    const input = document.createElement('input'); document.body.appendChild(input); input.focus();
    const command = vi.fn(() => {
      expect(document.activeElement.value).toBe('Scripture'); return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
    await writeClipboardText('Scripture');
    expect(command).toHaveBeenCalledWith('copy');
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('textarea')).toBeNull();
    input.remove(); delete document.execCommand;
  });
  it('reports failure when both native and Copy event writes fail', async () => {
    window.bexDesktop = { isDesktop: true, writeClipboardText: async () => ({ ok: false, error: 'Write failed' }) };
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    await expect(writeClipboardText('Scripture')).rejects.toThrow('Could not copy text');
    delete document.execCommand;
  });
  it.each(['missing', 'rejected'])('writes the clean payload through Copy when the native handler is %s', async (failure) => {
    window.bexDesktop = { isDesktop: true, ...(failure === 'rejected' ? { writeClipboardText: async () => { throw new Error('No handler registered'); } } : {}) };
    const competingEditor = vi.fn();
    document.addEventListener('copy', competingEditor, true);
    const setData = vi.fn();
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => {
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData } });
      document.activeElement.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      return true;
    } });
    try {
      await writeClipboardText('2 Corinthians 4:7 (BSB)\nNow we have this treasure.');
      expect(setData).toHaveBeenCalledWith('text/plain', '2 Corinthians 4:7 (BSB)\nNow we have this treasure.');
      expect(competingEditor).not.toHaveBeenCalled();
      expect(document.querySelector('textarea')).toBeNull();
    } finally {
      document.removeEventListener('copy', competingEditor, true);
      delete document.execCommand;
    }
  });
});
