import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CopyConfirmation from '@/components/utils/CopyConfirmation';
import { announceCopy, announceCopyFailed } from '@/lib/copyFeedback';

/**
 * The line in the corner that says whether a copy landed.
 *
 * It exists because copies in this app happen three different ways and one of
 * them can fail without a sound. So the failure case is guarded as carefully as
 * the success case — a confirmation that only ever appears when things already
 * worked would say nothing on the occasion it was needed.
 */

/** A copy the browser performs itself, with something actually selected. */
function nativeCopy(text, type = 'copy') {
  const host = document.createElement('p');
  host.textContent = text;
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(host);
  const selection = window.getSelection();
  selection.removeAllRanges();
  if (text) selection.addRange(range);
  act(() => { document.dispatchEvent(new Event(type, { bubbles: true })); });
  return host;
}

describe('copy confirmation', () => {
  it('says nothing until something is copied', () => {
    render(<CopyConfirmation />);
    expect(screen.queryByTestId('copy-confirmation')).toBeNull();
  });

  it('confirms an ordinary copy from anywhere in the app', async () => {
    render(<CopyConfirmation />);
    nativeCopy('Remember the Sabbath day');

    const note = await screen.findByTestId('copy-confirmation');
    expect(note.textContent).toBe('Copied');
    expect(note.dataset.copyOk).toBe('true');
  });

  it('names a cut for what it is', async () => {
    render(<CopyConfirmation />);
    nativeCopy('Remember the Sabbath day', 'cut');
    expect((await screen.findByTestId('copy-confirmation')).textContent).toBe('Cut');
  });

  it('stays quiet when the keys were pressed with nothing selected', () => {
    render(<CopyConfirmation />);
    window.getSelection().removeAllRanges();
    act(() => { document.dispatchEvent(new Event('copy', { bubbles: true })); });
    expect(screen.queryByTestId('copy-confirmation')).toBeNull();
  });

  it('reports the copies the browser does not perform itself', async () => {
    render(<CopyConfirmation />);
    act(() => { announceCopy('Copied 3 blocks'); });

    const note = await screen.findByTestId('copy-confirmation');
    expect(note.textContent).toBe('Copied 3 blocks');
    expect(note.dataset.copyOk).toBe('true');
  });

  it('says so when a copy fails, which is the whole point of it', async () => {
    render(<CopyConfirmation />);
    act(() => { announceCopyFailed('Could not copy — clipboard refused'); });

    const note = await screen.findByTestId('copy-confirmation');
    expect(note.textContent).toBe('Could not copy — clipboard refused');
    expect(note.dataset.copyOk).toBe('false');
  });

  it('replaces the previous line rather than stacking a second', async () => {
    render(<CopyConfirmation />);
    act(() => { announceCopy('Copied 1 block'); });
    await screen.findByTestId('copy-confirmation');
    act(() => { announceCopy('Copied 2 blocks'); });

    await waitFor(() => {
      expect(screen.getAllByTestId('copy-confirmation')).toHaveLength(1);
    });
    expect(screen.getByTestId('copy-confirmation').textContent).toBe('Copied 2 blocks');
  });

  it('never intercepts a press, so it cannot block what is underneath', async () => {
    render(<CopyConfirmation />);
    act(() => { announceCopy('Copied'); });
    const note = await screen.findByTestId('copy-confirmation');
    expect(note.className).toContain('pointer-events-none');
  });
});
