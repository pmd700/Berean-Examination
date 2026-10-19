import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/lib/WorkspaceTabs';
import TabBar from '@/components/tabs/TabBar';
import TabWorkspace from '@/components/tabs/TabWorkspace';

const harness = vi.hoisted(() => ({ reducedMotion: false, unmount: vi.fn() }));
vi.mock('framer-motion', async original => ({ ...await original(), useReducedMotion: () => harness.reducedMotion }));
vi.mock('@/pages.config', () => ({ pagesConfig: { mainPage: 'Study', Pages: {
  Study: function Editor() {
    const [value, setValue] = React.useState('Draft');
    React.useEffect(() => () => harness.unmount(), []);
    return <textarea aria-label="Kept draft" value={value} onChange={event => setValue(event.target.value)} />;
  },
  LibraryHome: () => <p>New home workspace</p>,
} } }));
function State() { const { activeId, selectTab } = useWorkspaceTabs(); return <><output data-testid="active-id">{activeId}</output><button onClick={() => selectTab('original')}>Return to draft</button></>; }
function mount() {
  localStorage.setItem('bex_workspace_tabs_v1', JSON.stringify({ tabs: [{ id: 'original', kind: 'study', path: '/Study', title: 'Draft' }], activeId: 'original' }));
  render(<MemoryRouter initialEntries={['/Study']}><WorkspaceTabsProvider><TabBar /><State /><TabWorkspace /></WorkspaceTabsProvider></MemoryRouter>);
}
beforeEach(() => { localStorage.clear(); harness.reducedMotion = false; harness.unmount.mockClear(); });
afterEach(() => localStorage.clear());

describe('new workspace slides', () => {
  it('slides the old pane left, brings the new pane from the right and preserves the original editor', async () => {
    mount();
    const editor = screen.getByRole('textbox', { name: 'Kept draft' });
    fireEvent.change(editor, { target: { value: 'Unsaved writing stays here.' } });
    fireEvent.click(screen.getByRole('button', { name: 'New tab', exact: true }));
    const original = screen.getByTestId('workspace-pane-original');
    expect(original.dataset.tabSlide).toBe('exiting');
    expect(original.getAttribute('inert')).toBe('');
    expect(document.querySelector('[data-tab-slide="entering"]').style.transform).toContain('100%');
    await waitFor(() => expect(original.className).toBe('hidden'), { timeout: 1500 });
    fireEvent.click(screen.getByRole('button', { name: 'Return to draft' }));
    expect(screen.getByRole('textbox', { name: 'Kept draft' })).toBe(editor);
    expect(editor.value).toBe('Unsaved writing stays here.');
    expect(harness.unmount).not.toHaveBeenCalled();
  });

  it('supports the keyboard shortcut and settles rapid new-tab opens into one active pane', async () => {
    mount();
    fireEvent.keyDown(window, { key: 't', metaKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'New tab', exact: true }));
    expect(document.querySelectorAll('[data-tab-slide="entering"]')).toHaveLength(1);
    await waitFor(() => expect(document.querySelectorAll('[data-tab-slide]')).toHaveLength(0), { timeout: 1500 });
    expect(document.querySelectorAll('[data-pane-active="true"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-pane-active="false"]')).toHaveLength(2);
  });

  it('opens immediately for reduced motion', async () => {
    harness.reducedMotion = true;
    mount();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New tab', exact: true })));
    expect(document.querySelector('[data-tab-slide]')).toBeNull();
    expect(screen.getByTestId('workspace-pane-original').className).toBe('hidden');
  });
});
