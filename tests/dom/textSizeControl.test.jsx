import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TextSizeControl, { useTextSizePreference, useScriptureNotesTextSizePreference } from '@/components/scripture/TextSizeControl';

afterEach(() => {
  window.localStorage.removeItem('text_size');
  window.localStorage.removeItem('scripture_notes_text_size');
  document.documentElement.removeAttribute('style');
});

function SharedPreferencePair() {
  const [first, setFirst] = useTextSizePreference();
  const [second] = useTextSizePreference();

  return (
    <>
      <TextSizeControl value={first} onChange={setFirst} testId="first-text-size" />
      <output data-testid="second-text-size">{second}</output>
    </>
  );
}

describe('shared text size control', () => {
  it('keeps every mounted writing surface on the same persisted preference', async () => {
    render(<SharedPreferencePair />);

    fireEvent.change(screen.getByTestId('first-text-size'), { target: { value: '5' } });

    await waitFor(() => expect(screen.getByTestId('second-text-size').textContent).toBe('5'));
    expect(window.localStorage.getItem('text_size')).toBe('5');
    expect(document.documentElement.style.getPropertyValue('--bex-editor-text-size')).toBe('21.333px');
    expect(document.documentElement.style.getPropertyValue('--bex-timegraph-empty-text-size')).toBe('16.667px');
  });
});


function SeparateNotesPreference() {
  const [scripture, setScripture] = useTextSizePreference();
  const [notes, setNotes] = useScriptureNotesTextSizePreference();
  const [otherNotes] = useScriptureNotesTextSizePreference();
  return <>
    <TextSizeControl value={scripture} onChange={setScripture} ariaLabel="Scripture text size" />
    <TextSizeControl value={notes} onChange={setNotes} ariaLabel="Notes text size" />
    <output data-testid="other-notes-size">{otherNotes}</output>
  </>;
}

it('persists and synchronizes notes size independently of Scripture and restores both on remount', async () => {
  const view = render(<SeparateNotesPreference />);
  fireEvent.change(screen.getByLabelText('Notes text size'), { target: { value: '5' } });
  await waitFor(() => expect(screen.getByTestId('other-notes-size').textContent).toBe('5'));
  expect(screen.getByLabelText('Scripture text size').value).toBe('3');
  expect(document.documentElement.style.getPropertyValue('--bex-scripture-note-text-size')).toBe('17.333px');
  expect(document.documentElement.style.getPropertyValue('--bex-editor-text-size')).toBe('16px');
  fireEvent.change(screen.getByLabelText('Scripture text size'), { target: { value: '1' } });
  expect(screen.getByLabelText('Notes text size').value).toBe('5');
  expect(document.documentElement.style.getPropertyValue('--bex-scripture-note-text-size')).toBe('17.333px');
  expect(window.localStorage.getItem('scripture_notes_text_size')).toBe('5');
  expect(window.localStorage.getItem('text_size')).toBe('1');
  view.unmount();
  render(<SeparateNotesPreference />);
  expect(screen.getByLabelText('Notes text size').value).toBe('5');
  expect(screen.getByLabelText('Scripture text size').value).toBe('1');
});
