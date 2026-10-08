import React from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  NEW_TAB_PATH,
  TAB_KINDS,
  useCurrentWorkspaceTab,
  useWorkspaceTabs,
} from '@/lib/WorkspaceTabs';

export function useReturnToLibraryHome() {
  const currentTab = useCurrentWorkspaceTab();
  const { updateTab } = useWorkspaceTabs();

  return React.useCallback(() => {
    if (!currentTab) return;
    updateTab(currentTab.id, {
      kind: TAB_KINDS.HOME,
      path: NEW_TAB_PATH,
      title: 'New tab',
    });
  }, [currentTab, updateTab]);
}

export default function BackToLibraryHomeButton({ className = '', onClick }) {
  const returnToLibraryHome = useReturnToLibraryHome();

  return (
    <button
      type="button"
      onClick={onClick || returnToLibraryHome}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/[0.1] bg-white/[0.025] text-slate-400 transition hover:border-violet-400/40 hover:bg-violet-400/[0.08] hover:text-white ${className}`}
      aria-label="Back to New tab"
      title="Back to New tab"
      data-testid="back-to-library-home"
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );
}
