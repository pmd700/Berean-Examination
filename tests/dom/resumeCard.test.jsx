import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceTabsProvider } from '@/lib/WorkspaceTabs';
import ResumeCard from '@/components/resume/ResumeCard';

vi.mock('@/components/shaders/Card3DTilt', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

function ownerWithLastActivity(deepLink) {
  return {
    id: 1,
    last_activity: JSON.stringify({
      type: 'mind_note',
      subtitle: 'Current note',
      deep_link: deepLink,
      timestamp: new Date().toISOString(),
    }),
  };
}

function mount(activePath, resumePath) {
  return render(
    <MemoryRouter initialEntries={[activePath]}>
      <WorkspaceTabsProvider initialPath={activePath}>
        <ResumeCard user={ownerWithLastActivity(resumePath)} />
      </WorkspaceTabsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('resume card active-page awareness', () => {
  it('does not notify when the active workspace already shows that note', async () => {
    mount('/notes/current-title-27', '/notes/old-title-27');
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(screen.queryByTestId('resume-card')).toBeNull();
  });

  it('still offers the genuinely different last page', async () => {
    mount('/notes/current-title-28', '/notes/old-title-27');
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(screen.getByTestId('resume-card')).toBeTruthy();
  });
});

