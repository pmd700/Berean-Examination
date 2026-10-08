import { describe, expect, it, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import InlineWebTitle from '@/components/knowledgeweb/InlineWebTitle';

/**
 * Renaming a Knowledge Web from its header.
 *
 * The delicate parts are all about not losing the name: committing twice (Enter
 * blurs the field, and blur commits too), committing an empty one, and what
 * happens when the rename is REFUSED — a locked private web cannot be renamed,
 * so the old name has to come back rather than the screen keeping a name that
 * was never saved.
 */

function setup({ title = 'Untitled Web', onRename = vi.fn(), disabled = false } = {}) {
  const utils = render(
    <InlineWebTitle title={title} onRename={onRename} disabled={disabled}>
      <span>{title}</span>
    </InlineWebTitle>,
  );
  return { ...utils, onRename };
}

const label = () => screen.getByTestId('web-title-label');
const input = () => screen.queryByTestId('web-title-input');
const openEditor = () => fireEvent.doubleClick(label());

function type(value) {
  fireEvent.change(input(), { target: { value } });
}

afterEach(() => cleanup());

describe('opening the editor', () => {
  it('shows the name as a label until it is double-clicked', () => {
    setup();
    expect(input()).toBeNull();
    openEditor();
    expect(input()).toBeTruthy();
  });

  it('starts from the current name', () => {
    setup({ title: 'Blasphemy of the Holy Spirit' });
    openEditor();
    expect(input().value).toBe('Blasphemy of the Holy Spirit');
  });

  it('does not open on a single click, which is how you select text', () => {
    setup();
    fireEvent.click(label());
    expect(input()).toBeNull();
  });

  it('refuses to open when renaming is not allowed', () => {
    // A private web that is still locked: its name is encrypted and there is
    // no key to write a new one with.
    setup({ disabled: true });
    openEditor();
    expect(input()).toBeNull();
  });
});

describe('committing', () => {
  it('saves on Enter', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    setup({ onRename });
    openEditor();
    type('Mark 3:29');
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }); });

    expect(onRename).toHaveBeenCalledWith('Mark 3:29');
    expect(input()).toBeNull();
  });

  it('saves on clicking away', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    setup({ onRename });
    openEditor();
    type('Mark 3:29');
    await act(async () => { fireEvent.blur(input()); });

    expect(onRename).toHaveBeenCalledWith('Mark 3:29');
  });

  it('saves once, not twice, when Enter is followed by the blur it causes', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    setup({ onRename });
    openEditor();
    type('Mark 3:29');
    await act(async () => {
      fireEvent.keyDown(input(), { key: 'Enter' });
      fireEvent.blur(input());
    });

    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('trims the name before saving it', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    setup({ onRename });
    openEditor();
    type('   Spaced Out   ');
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }); });

    expect(onRename).toHaveBeenCalledWith('Spaced Out');
  });
});

describe('when nothing should be saved', () => {
  it('ignores an empty name rather than wiping the title', async () => {
    const onRename = vi.fn();
    setup({ title: 'Untitled Web', onRename });
    openEditor();
    type('   ');
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }); });

    expect(onRename).not.toHaveBeenCalled();
    expect(input()).toBeNull();
  });

  it('ignores a name that did not change', async () => {
    const onRename = vi.fn();
    setup({ title: 'Untitled Web', onRename });
    openEditor();
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }); });

    expect(onRename).not.toHaveBeenCalled();
  });

  it('abandons the edit on Escape', async () => {
    const onRename = vi.fn();
    setup({ title: 'Untitled Web', onRename });
    openEditor();
    type('Discard me');
    await act(async () => { fireEvent.keyDown(input(), { key: 'Escape' }); });

    expect(onRename).not.toHaveBeenCalled();
    expect(input()).toBeNull();
  });

  it('does not save on the blur that Escape causes', async () => {
    const onRename = vi.fn();
    setup({ onRename });
    openEditor();
    type('Discard me');
    await act(async () => {
      fireEvent.keyDown(input(), { key: 'Escape' });
      fireEvent.blur(input());
    });

    expect(onRename).not.toHaveBeenCalled();
  });
});

describe('when the rename is refused', () => {
  it('puts the old name back rather than showing one that was never saved', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('Unlock this private Knowledge Web first.'));
    setup({ title: 'Private Web', onRename });
    openEditor();
    type('Attempted Name');
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }); });

    expect(input()).toBeNull();
    openEditor();
    expect(input().value).toBe('Private Web');
  });
});

describe('keys while typing a name', () => {
  it('keeps them out of the canvas underneath', () => {
    // The canvas listens for plenty of bare keys — Delete, digits, arrows —
    // and none of them should fire while a name is being typed.
    const seen = [];
    const onKeyDown = (event) => seen.push(event.key);
    document.addEventListener('keydown', onKeyDown);

    setup();
    openEditor();
    fireEvent.keyDown(input(), { key: 'Delete' });
    fireEvent.keyDown(input(), { key: '1' });

    document.removeEventListener('keydown', onKeyDown);
    expect(seen).toEqual([]);
  });
});
