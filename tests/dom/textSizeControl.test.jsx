import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TextSizeControl, { useTextSizePreference } from '@/components/scripture/TextSizeControl';

afterEach(() => {
  window.localStorage.removeItem('text_size');
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
