import React from 'react';
import { AnimatePresence, motion, Reorder } from 'framer-motion';
import {
  BarChart3, BookOpenText, Brain, BookOpen, Copy, GraduationCap, LayoutGrid, NotebookPen, Plus, Share2, Tag, X,
} from 'lucide-react';
import { useWorkspaceTabs, NEW_TAB_PATH, TAB_KINDS, formatTabTitle } from '@/lib/WorkspaceTabs';
import { requestTooltipShortcut } from '@/lib/tooltipShortcut';
import TimelineGlyph from '@/components/timegraph/TimelineGlyph';
import RefreshBexButton from './RefreshBexButton';

const KIND_ICONS = {
  [TAB_KINDS.HOME]: LayoutGrid,
  [TAB_KINDS.STUDY]: BookOpen,
  [TAB_KINDS.KNOWLEDGE_WEB]: Share2,
  [TAB_KINDS.NOTES]: NotebookPen,
  [TAB_KINDS.KEYWORDS]: Tag,
  [TAB_KINDS.TIMELINE]: TimelineGlyph,
  [TAB_KINDS.COURSES]: GraduationCap,
  [TAB_KINDS.STATS]: BarChart3,
  [TAB_KINDS.AI_SECOND_BRAIN]: Brain,
};

export default function TabBar() {
  const { tabs, activeId, selectTab, closeTab, openTab, duplicateTab, reorderTabs } = useWorkspaceTabs();
  const [contextMenu, setContextMenu] = React.useState(null);

  React.useEffect(() => {
    if (!contextMenu) return undefined;
    const dismiss = () => setContextMenu(null);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const openTabContextMenu = React.useCallback((event, tab) => {
    event.preventDefault();
    event.stopPropagation();
    const width = 164;
    const height = 44;
    setContextMenu({
      tabId: tab.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    });
  }, []);

  const duplicateFromContextMenu = React.useCallback((event) => {
    event.stopPropagation();
    if (!contextMenu) return;
    const { tabId } = contextMenu;
    setContextMenu(null);
    duplicateTab(tabId);
  }, [contextMenu, duplicateTab]);

  // ⌘T new tab, ⌘W close, ⌘1–9 jump.
  React.useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 't') {
        event.preventDefault();
        // A note being written claims ⌘T first, but only with text selected —
        // that raises a tooltip on it. With nothing selected nobody claims the
        // key and a new tab opens exactly as it always has.
        if (requestTooltipShortcut()) return;
        openTab(TAB_KINDS.HOME, { path: NEW_TAB_PATH, title: 'New tab' });
        return;
      }
      if (key === 'w') {
        event.preventDefault();
        closeTab(activeId);
        return;
      }
      if (/^[1-9]$/.test(key)) {
        const target = tabs[Number(key) - 1];
        if (target) {
          event.preventDefault();
          selectTab(target.id);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tabs, activeId, closeTab, openTab, selectTab]);

  const canClose = tabs.length > 1;

  return (
    <div
      // Pages own their viewport and some cover it with fixed overlays (the
      // Knowledge Web loading screen, transition wipes). The bar has to stay
      // above them or you can be stranded in a tab with no way out.
      className="relative z-[300] flex items-stretch gap-1 h-9 px-2 shrink-0 bg-app select-none"
      data-testid="workspace-tab-bar"
    >
      <Reorder.Group
        axis="x"
        as="div"
        values={tabs.map((tab) => tab.id)}
        onReorder={reorderTabs}
        className="flex items-stretch gap-1 min-w-0 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const isBookTab = tab.kind === TAB_KINDS.NOTES && tab.isBook === true;
          const Icon = isBookTab ? BookOpenText : (KIND_ICONS[tab.kind] || BookOpen);
          const isActive = tab.id === activeId;
          return (
            <Reorder.Item
              key={tab.id}
              value={tab.id}
              as="div"
              layout
              whileDrag={{ scale: 1.03 }}
              transition={{ type: 'spring', stiffness: 620, damping: 38 }}
              onPointerDown={(event) => {
                if (event.button === 0) selectTab(tab.id);
              }}
              onContextMenu={(event) => openTabContextMenu(event, tab)}
              className={`group/tab relative flex items-center gap-1.5 min-w-0 max-w-[210px] px-2.5 my-1 rounded-md cursor-pointer transition-colors ${
                isActive
                  ? 'bg-elevated text-ink'
                  : 'text-ink-soft hover:bg-surface hover:text-[#C7CDD9]'
              }`}
              data-testid={`workspace-tab-${tab.id}`}
              data-active={isActive ? 'true' : 'false'}
            >
              <motion.span
                key={isBookTab ? 'book' : 'note'}
                initial={{ opacity: 0, scale: 0.72, rotate: -8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                className="grid shrink-0 place-items-center"
                data-testid={`workspace-tab-icon-${tab.id}`}
                data-document-type={tab.kind === TAB_KINDS.NOTES ? (isBookTab ? 'book' : 'note') : undefined}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-violet-300' : ''}`} />
              </motion.span>
              <span className="truncate text-[12px] leading-none" title={tab.title}>
                {formatTabTitle(tab.title)}
              </span>
              {canClose && (
                <button
                  type="button"
                  // pointerdown would select the tab before the click lands.
                  onPointerDown={(e) => { e.stopPropagation(); }}
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className="shrink-0 h-4 w-4 grid place-items-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover/tab:opacity-100"
                  title="Close tab (⌘W)"
                  data-testid={`workspace-tab-close-${tab.id}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </Reorder.Item>
          );
        })}
      </Reorder.Group>

      <div className="relative flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => openTab(TAB_KINDS.HOME, { path: NEW_TAB_PATH, title: 'New tab' })}
          className="h-6 w-6 grid place-items-center rounded-md text-ink-soft transition-colors hover:bg-elevated hover:text-white"
          title="New tab (⌘T)"
          aria-label="New tab"
          data-testid="workspace-tab-new"
        >
          <Plus className="w-4 h-4" />
        </button>
        <RefreshBexButton />
      </div>

      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.11, ease: 'easeOut' }}
            onPointerDown={(event) => event.stopPropagation()}
            className="fixed z-[100500] w-[164px] rounded-xl border border-white/10 bg-[#171b24]/98 p-1.5 shadow-[0_18px_46px_rgba(0,0,0,0.55)] backdrop-blur-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
            aria-label="Tab actions"
            data-testid="workspace-tab-context-menu"
          >
            <button
              type="button"
              role="menuitem"
              onClick={duplicateFromContextMenu}
              className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
              data-testid="workspace-tab-duplicate"
            >
              <Copy className="h-3.5 w-3.5 text-violet-300" />
              Duplicate
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
