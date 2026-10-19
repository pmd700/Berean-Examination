import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';

vi.mock('@/api/desktopClient', () => ({
  desktopClient: {
    entities: {
      Keyword: { list: async () => [] },
    },
  },
}));

import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';

const CONTENT = '<p>Read <a href="https://example.com">this passage</a>.</p>';

function mountEditor(content = CONTENT) {
  return render(
    <MemoryRouter>
      <TEXT_EDITOR_MACHINERY
        content={content}
        onChange={() => {}}
        bare
        nested
      />
    </MemoryRouter>,
  );
}

async function renderedLink(container) {
  await waitFor(() => {
    expect(container.querySelector('a.external-link')).not.toBeNull();
  });
  return container.querySelector('a.external-link');
}

describe('global editor link interactions', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('links pasted rich text between quoted link boundaries in the actual shared editor', async () => {
    const { container } = mountEditor('<p>Before <a href="https://example.com/source">""</a> After.</p>');
    await renderedLink(container);
    const dom = container.querySelector('.ProseMirror');
    const view = dom.editor.view;
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9))));
    fireEvent.paste(dom, { clipboardData: { getData: type => type === 'text/html'
      ? '<p><strong>Evidence for the quotation</strong></p>' : type === 'text/plain' ? 'Evidence for the quotation' : '' } });
    await waitFor(() => {
      const link = container.querySelector('a.external-link');
      expect(link.textContent).toBe('"Evidence for the quotation"');
      expect(link.querySelector('strong').textContent).toBe('Evidence for the quotation');
      expect(link.getAttribute('href')).toBe('https://example.com/source');
    });
    act(() => dom.editor.commands.undo());
    expect(dom.textContent).toBe('Before "" After.');
  });

  it('opens one browser window for one hyperlink click', async () => {
    const { container } = mountEditor();
    const link = await renderedLink(container);

    fireEvent.click(link);

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('opens the dot-free edit panel beside the hovered link', async () => {
    const { container } = mountEditor();
    const link = await renderedLink(container);
    link.getBoundingClientRect = () => ({
      left: 180,
      top: 220,
      right: 300,
      bottom: 240,
      width: 120,
      height: 20,
      x: 180,
      y: 220,
      toJSON: () => ({}),
    });

    fireEvent.mouseOver(link);
    fireEvent.mouseDown(await screen.findByRole('button', { name: 'Edit link' }));

    const panel = await screen.findByTestId('modal-link-input');
    expect(panel.style.left).toBe('180px');
    expect(panel.style.top).toBe('248px');
    expect(screen.queryByTestId('button-close-link-input')).toBeNull();
    expect(screen.getByTestId('button-set-link')).not.toBeNull();
    expect(screen.getByTestId('button-remove-link')).not.toBeNull();
  });

  it('edits the displayed text without changing the link destination', async () => {
    const { container } = mountEditor();
    const link = await renderedLink(container);

    fireEvent.mouseOver(link);
    fireEvent.mouseDown(await screen.findByRole('button', { name: 'Edit link' }));

    expect((await screen.findByTestId('input-link-text')).value).toBe('this passage');
    expect(screen.getByTestId('input-link-url').value).toBe('https://example.com/');

    fireEvent.change(screen.getByTestId('input-link-text'), {
      target: { value: "YouTube Video: Should Christians Keep the Bible's Food Laws? (Minute 3:00)" },
    });
    fireEvent.click(screen.getByTestId('button-set-link'));

    await waitFor(() => {
      const updatedLink = container.querySelector('a.external-link');
      expect(updatedLink.textContent).toBe(
        "YouTube Video: Should Christians Keep the Bible's Food Laws? (Minute 3:00)",
      );
      expect(updatedLink.getAttribute('href')).toBe('https://example.com/');
    });
  });
});
