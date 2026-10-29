import { useEffect, useRef } from 'react';

export const cardEditorMode = mode => ['compact', 'expanded', 'fullscreen'].includes(mode) ? mode : 'compact';

// Session metadata is owned by one workspace tab, not the whole web or browser.
// Wait for this web's actual rows before restoring or clearing the saved card.
export default function useCardWorkspaceSession({ tab, updateTab, webId, loadedWebId, cards, selectedCardId, setSelectedCardId, explicitCard }) {
  const restored = useRef(null);
  useEffect(() => {
    if (!tab || !webId || loadedWebId !== webId) return;
    const saved = tab.webCard;
    if (restored.current !== webId) {
      restored.current = webId;
      if (!explicitCard && saved?.webId === webId && cards.some(card => card.id === saved.cardId)) {
        setSelectedCardId(saved.cardId);
        return;
      }
    }
    const next = selectedCardId == null ? null : {
      webId, cardId: selectedCardId,
      mode: saved?.webId === webId && saved.cardId === selectedCardId ? cardEditorMode(saved.mode) : 'compact',
    };
    if (JSON.stringify(saved ?? null) !== JSON.stringify(next)) updateTab(tab.id, { webCard: next });
  }, [tab, updateTab, webId, loadedWebId, cards, selectedCardId, setSelectedCardId, explicitCard]);
}
