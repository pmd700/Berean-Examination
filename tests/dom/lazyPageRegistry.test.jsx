import React, { Suspense } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ErrorBoundary from '@/components/ErrorBoundary';

const harness = vi.hoisted(() => ({ libraryLoads: 0, studyLoads: 0, courseLoads: 0, courseGate: null, resolveCourse: null }));
vi.mock('@/Layout.jsx', () => ({ default: ({ children }) => children }));
vi.mock('@/pages/LibraryHome', () => {
  harness.libraryLoads++;
  return { default: function LibraryFixture() { const [value, setValue] = React.useState('Kept library draft'); return <input aria-label="Library fixture" value={value} onChange={e => setValue(e.target.value)} />; } };
});
vi.mock('@/pages/Study', () => { harness.studyLoads++; return { default: () => <p>Study workspace</p> }; });
vi.mock('@/pages/Courses', async () => {
  harness.courseLoads++;
  await harness.courseGate;
  return { default: () => <p>Course/video pathway remains available</p> };
});

it('defers every page module and preserves a mounted pane while another route loads', async () => {
  harness.courseGate = new Promise(resolve => { harness.resolveCourse = resolve; });
  const { PAGES, pagesConfig } = await import('@/pages.config');
  expect(harness.libraryLoads).toBe(0); expect(harness.studyLoads).toBe(0); expect(harness.courseLoads).toBe(0);
  expect(Object.keys(PAGES)).toEqual(['AssetLibrary', 'BrainChat', 'BrainInbox', 'BrainSearch', 'ChapterArt', 'ContactFeedback', 'Courses', 'Keywords', 'KnowledgeWeb', 'LibraryHome', 'MindView', 'SourcesLicenses', 'Stats', 'Study', 'Timelines', 'Spreadsheets']);
  expect(pagesConfig.mainPage).toBe('LibraryHome');
  const Library = PAGES.LibraryHome, Courses = PAGES.Courses;
  function Panes({ courseOpen = false }) {
    return <><div hidden={courseOpen}><ErrorBoundary><Suspense fallback={<p>Library loading</p>}><Library /></Suspense></ErrorBoundary></div>{courseOpen && <ErrorBoundary><Suspense fallback={<p role="status">Course loading</p>}><Courses /></Suspense></ErrorBoundary>}</>;
  }
  const view = render(<Panes />);
  const input = await screen.findByRole('textbox', { name: 'Library fixture' });
  fireEvent.change(input, { target: { value: 'Unsaved state stays mounted' } });
  expect(harness.libraryLoads).toBe(1); expect(harness.studyLoads).toBe(0); expect(harness.courseLoads).toBe(0);
  view.rerender(<Panes courseOpen />);
  await waitFor(() => expect(harness.courseLoads).toBe(1));
  expect(screen.getByRole('status').textContent).toBe('Course loading');
  harness.resolveCourse();
  await screen.findByText('Course/video pathway remains available');
  view.rerender(<Panes />);
  expect(screen.getByRole('textbox', { name: 'Library fixture' })).toBe(input);
  expect(input.value).toBe('Unsaved state stays mounted');
  expect(harness.libraryLoads).toBe(1); expect(harness.studyLoads).toBe(0);
});
