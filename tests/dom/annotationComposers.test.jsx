import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/desktopClient', () => ({
  desktopClient: {
    entities: {
      Keyword: { list: async () => [] },
    },
  },
}));

import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import { collectFootnotes } from '@/components/editor/FootnoteExtension';
import { collectTooltips } from '@/components/editor/TooltipExtension';

/**
 * The composers for tooltips and footnotes.
 *
 * Both are panels that stay mounted through an exit animation after they close,
 * with their own document-level listeners still attached. That window is the
 * dangerous one: a press anywhere on the page used to reach the panel's cancel
 * path, which — reading the body as it was before the save — deleted the
 * annotation the writer had just finished. These guard that a saved annotation
 * survives whatever happens next.
 */

function mountNote(content = '<p>Paul writes plainly here</p>', onRender = () => {}) {
  const api = {};
  const view = render(
    <MemoryRouter>
      <React.Profiler id="footnote-drafts" onRender={onRender}>
      <TEXT_EDITOR_MACHINERY
        content={content}
        onChange={() => {}}
        onEditorReady={(editor) => { api.editor = editor; }}
        bare
        noteAnnotations
      />
      </React.Profiler>
    </MemoryRouter>,
  );
  return { api, view };
}

/** The press that used to destroy the writing. */
const pressElsewhere = () => fireEvent.pointerDown(document.body);

/**
 * Write into the panel the way a person does — through its own editor, so the
 * composer's state follows along. Setting the annotation's body on the page
 * editor instead would leave the panel believing nothing had been written.
 */
async function writeInComposer(panel, text) {
  const surface = panel.querySelector('.ProseMirror');
  expect(surface).toBeTruthy();
  // Inside act so the composer's own state has caught up with what was typed
  // before anything presses Save — otherwise Save reads an empty body and
  // treats the annotation as one that was never written.
  await act(async () => { surface.editor.commands.insertContent(text); });
}

describe('a saved footnote survives what happens next', () => {
  it('starts the next footnote blank and never reuses or overwrites the previous citation', async () => {
    const initialBodies = [];
    const seen = new Set();
    const { api } = mountNote(undefined, () => {
      // Inspect each editor's first committed DOM, before passive effects can
      // reset stale content. This catches the focus/content-sync race.
      const surface = document.querySelector('[data-testid="footnote-composer"] .ProseMirror');
      if (surface && !seen.has(surface)) { seen.add(surface); initialBodies.push(surface.textContent); }
    });
    await waitFor(() => expect(api.editor).toBeTruthy());
    await act(async () => { api.editor.commands.setTextSelection(5); api.editor.commands.addFootnote(); });
    let panel = await screen.findByTestId('footnote-composer');
    await writeInComposer(panel, 'First citation.');
    fireEvent.click(screen.getByTestId('button-footnote-save'));
    await waitFor(() => expect(screen.queryByTestId('footnote-composer')).toBeNull());
    const first = collectFootnotes(api.editor.state.doc)[0];
    await act(async () => { api.editor.commands.setTextSelection(api.editor.state.doc.content.size - 1); api.editor.commands.addFootnote(); });
    panel = await screen.findByTestId('footnote-composer');
    expect(initialBodies).toEqual(['', '']);
    await waitFor(() => expect(document.activeElement).toBe(panel.querySelector('.ProseMirror')));
    expect(panel.querySelector('.ProseMirror').textContent).toBe('');
    await writeInComposer(panel, 'Second citation.');
    fireEvent.click(screen.getByTestId('button-footnote-save'));
    const notes = collectFootnotes(api.editor.state.doc);
    expect(notes).toHaveLength(2);
    expect(notes[0].id).toBe(first.id);
    expect(notes[0].text).toContain('First citation.');
    expect(notes[1].id).not.toBe(first.id);
    expect(notes[1].text).toContain('Second citation.');
    expect(notes[1].text).not.toContain('First citation.');
  });
  it('is not discarded by a press elsewhere while the panel closes', async () => {
    const { api } = mountNote();
    await waitFor(() => expect(api.editor).toBeTruthy());

    api.editor.commands.setTextSelection(5);
    api.editor.commands.addFootnote();

    const panel = await screen.findByTestId('footnote-composer');
    await writeInComposer(panel, 'Hurtado, 27.');
    fireEvent.click(screen.getByTestId('button-footnote-save'));

    pressElsewhere();
    pressElsewhere();

    const footnotes = collectFootnotes(api.editor.state.doc);
    expect(footnotes).toHaveLength(1);
    expect(footnotes[0].text).toContain('Hurtado, 27.');
  });

  it('still drops a footnote the writer never wrote', async () => {
    const { api } = mountNote();
    await waitFor(() => expect(api.editor).toBeTruthy());

    api.editor.commands.setTextSelection(5);
    api.editor.commands.addFootnote();
    await screen.findByTestId('footnote-composer');

    pressElsewhere();

    expect(collectFootnotes(api.editor.state.doc)).toHaveLength(0);
  });
});

describe('a saved tooltip survives what happens next', () => {
  it('is not discarded by a press elsewhere while the panel closes', async () => {
    const { api } = mountNote();
    await waitFor(() => expect(api.editor).toBeTruthy());

    api.editor.commands.setTextSelection({ from: 1, to: 5 });
    api.editor.commands.addTooltip();

    const panel = await screen.findByTestId('tooltip-composer');
    await writeInComposer(panel, 'The apostle.');
    fireEvent.click(screen.getByTestId('button-tooltip-save'));

    pressElsewhere();
    pressElsewhere();

    const tooltips = collectTooltips(api.editor.state.doc);
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0].text).toContain('The apostle.');
  });

  it('still drops a tooltip the writer never wrote', async () => {
    const { api } = mountNote();
    await waitFor(() => expect(api.editor).toBeTruthy());

    api.editor.commands.setTextSelection({ from: 1, to: 5 });
    api.editor.commands.addTooltip();
    await screen.findByTestId('tooltip-composer');

    pressElsewhere();

    expect(collectTooltips(api.editor.state.doc)).toHaveLength(0);
    expect(api.editor.state.doc.textContent).toBe('Paul writes plainly here');
  });
});

describe('reading a tooltip back', () => {
  it('keeps a short aside on one line with its controls', async () => {
    const { api } = mountNote();
    await waitFor(() => expect(api.editor).toBeTruthy());

    api.editor.commands.setTextSelection({ from: 1, to: 5 });
    api.editor.commands.addTooltip();
    const panel = await screen.findByTestId('tooltip-composer');
    await writeInComposer(panel, 'testing');
    fireEvent.click(screen.getByTestId('button-tooltip-save'));

    api.editor.commands.setActiveTooltip(collectTooltips(api.editor.state.doc)[0].id);

    await screen.findByTestId('tooltip-popup');
    const body = screen.getByTestId('text-tooltip-body');
    const edit = screen.getByTestId('button-tooltip-edit');

    // Same row, not stacked: a four-word aside stacked over a rule and a button
    // strip is a card three lines tall with nothing in two of them.
    expect(edit.parentElement.parentElement).toBe(body.parentElement);
    expect(screen.getByTestId('tooltip-popup').querySelector('.border-t')).toBeNull();
  });
});

describe('the composer is ready to type in', () => {
  it('takes the caret when a footnote is raised', async () => {
    const { api } = mountNote();
    await waitFor(() => expect(api.editor).toBeTruthy());

    api.editor.commands.setTextSelection(5);
    api.editor.commands.addFootnote();

    const composer = await screen.findByTestId('footnote-composer');
    await waitFor(() => {
      expect(composer.contains(document.activeElement)).toBe(true);
    });
  });
});
