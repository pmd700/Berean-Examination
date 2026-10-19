import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BibleVersionSelector from '@/components/study/BibleVersionSelector';
import { getScriptureCatalog } from '@/lib/scriptureClient';
import { FAVORITE_BIBLE_KEY, useFavoriteBible } from '@/lib/favoriteBible';

vi.mock('@/lib/scriptureClient', () => ({ getScriptureCatalog: vi.fn() }));
beforeEach(() => localStorage.clear());
afterEach(() => { delete window.bexDesktop; localStorage.clear(); });

it('offers NBLA by edition ID and retains only the working API NASB 2020 option', async () => {
  getScriptureCatalog.mockResolvedValue({ data: [
    { id: 'a761ca71e0b3ddcf-01', abbreviation: 'NASB', name: 'New American Standard Bible 2020' },
    { id: 'nasb2020', abbreviation: 'NASB2020', name: 'New American Standard Bible 2020' },
    { id: 'ce11b813f9a27e20-01', abbreviation: 'NBLA', name: 'Nueva Biblia de las Américas', language: { name: 'Spanish' } },
  ] });
  const select = vi.fn();
  render(<BibleVersionSelector selectedBibleId="a761ca71e0b3ddcf-01" onSelectBible={select} />);
  fireEvent.click(screen.getByRole('button', { name: 'Select Bible Version' }));
  const nbla = await screen.findByRole('button', { name: /NBLA.*Spanish.*Nueva Biblia de las Américas/ });
  expect(screen.getAllByRole('button', { name: /New American Standard Bible 2020/ })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /NASB2020/ })).toBeNull();
  fireEvent.click(nbla);
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'ce11b813f9a27e20-01', abbreviation: 'NBLA' }));
});

it('includes NBLA in the fallback without offering the retired NASB 2020 source', async () => {
  getScriptureCatalog.mockRejectedValue(new Error('Offline'));
  render(<BibleVersionSelector onSelectBible={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Select Bible Version' }));
  expect(await screen.findByRole('button', { name: /NBLA.*Spanish/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /NASB2020/ })).toBeNull();
});

it('retains the explicitly configured NBLA edition when the cached catalog predates the plan change', async () => {
  getScriptureCatalog.mockResolvedValue({ data: [{ id: '317e03834065a236-01', abbreviation: 'BSB', name: 'Berean Standard Bible' }] });
  render(<BibleVersionSelector onSelectBible={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Select Bible Version' }));
  await screen.findByRole('button', { name: /LSV.*Literal Standard Version/ });
  expect(screen.getByRole('button', { name: /NBLA.*Spanish/ })).toBeTruthy();
});

it('ranks English sales leaders first, selects exact editions and makes the whole catalog searchable', async () => {
  const catalog = [
    { id: 'foreign', abbreviation: 'ODLNT', name: 'Dangme Bible', language: { id: 'ada', name: 'Dangme' } },
    { id: 'nasb-1995', abbreviation: 'NASB', name: 'New American Standard Bible 1995', language: { id: 'eng', name: 'English' } },
    { id: 'niv', abbreviation: 'NIV', name: 'New International Version', language: { id: 'eng', name: 'English' } },
    { id: 'kjv', abbreviation: 'KJV', name: 'King James Version', language: { id: 'eng', name: 'English' } },
    { id: 'esv', abbreviation: 'ESV', name: 'English Standard Version', language: { id: 'eng', name: 'English' } },
    { id: 'nasb-2020', abbreviation: 'NASB', name: 'New American Standard Bible 2020', language: { id: 'eng', name: 'English' } },
    ...Array.from({ length: 70 }, (_, i) => ({ id: `other-${i}`, abbreviation: `O${i}`, name: `Other language ${i}`, language: { name: 'Zulu' } })),
  ];
  getScriptureCatalog.mockResolvedValue({ data: catalog });
  render(<BibleVersionSelector selectedBibleId="nasb-2020" onSelectBible={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Select Bible Version' }));
  await screen.findByRole('button', { name: /NIV.*New International Version/ });
  const rows = [...screen.getByTestId('bible-translation-list').querySelectorAll('[data-bible-id]')];
  expect(rows.slice(0, 3).map(row => row.dataset.bibleId)).toEqual(['niv', 'kjv', 'esv']);
  expect(rows.findIndex(row => row.dataset.bibleId === 'foreign')).toBeGreaterThan(rows.findIndex(row => row.dataset.bibleId === 'lsv'));
  expect(screen.getByRole('button', { name: /NASB.*New American Standard Bible 1995/ }).className).not.toContain('font-semibold');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search Bible translations' }), { target: { value: 'Other language 69' } });
  expect(screen.getByRole('button', { name: /O69.*Other language 69/ })).toBeTruthy();
});

it('stars one default without selecting it and restores it from the owner on a fresh desktop origin', async () => {
  const bible = { id: 'a761ca71e0b3ddcf-01', abbreviation: 'NASB', name: 'New American Standard Bible 2020', language: { id: 'eng', name: 'English' } };
  getScriptureCatalog.mockResolvedValue({ data: [bible] });
  const owner = { id: 1, is_local_owner: true };
  window.bexDesktop = { isDesktop: true, getLocalOwner: vi.fn(async () => ({ ok: true, owner })), updateLocalOwner: vi.fn(async patch => ({ ok: true, owner: Object.assign(owner, patch) })) };
  const selected = vi.fn();
  const first = render(<BibleVersionSelector onSelectBible={selected} />);
  fireEvent.click(screen.getByRole('button', { name: 'Select Bible Version' }));
  const star = await screen.findByRole('button', { name: 'Make NASB the default translation' });
  fireEvent.click(star);
  expect(star.getAttribute('aria-pressed')).toBe('true');
  expect(selected).not.toHaveBeenCalled();
  await waitFor(() => expect(window.bexDesktop.updateLocalOwner).toHaveBeenCalledWith({ [FAVORITE_BIBLE_KEY]: expect.objectContaining({ id: bible.id }) }));
  first.unmount(); localStorage.clear();
  function Restored() { const [favorite, , ready] = useFavoriteBible(); return <output>{ready ? favorite?.id : 'Reading'}</output>; }
  render(<Restored />);
  await screen.findByText(bible.id);
  expect(JSON.parse(localStorage.getItem(FAVORITE_BIBLE_KEY)).id).toBe(bible.id);
});
