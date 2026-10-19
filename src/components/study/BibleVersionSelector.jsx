import React from 'react';
import { ChevronDown, Check, Search, Star } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { getScriptureCatalog } from '@/lib/scriptureClient';
import { isTranslationRemovedFromPlan, NASB1995_API_BIBLE_ID, NBLA_API_BIBLE_ID } from '@shared/removedTranslations';
import { bibleCatalogGroup, orderBibleCatalog } from '@/lib/bibleCatalogOrder';
import { DEFAULT_BIBLE_ID, useFavoriteBible } from '@/lib/favoriteBible';
import './bibleVersionSelector.css';

const FALLBACK_BIBLES = [
  { id: '317e03834065a236-01', name: 'Berean Standard Bible', abbreviation: 'BSB', language: { name: 'English' } },
  { id: 'de4e12af7f28f599-02', name: 'King James Version', abbreviation: 'KJV', language: { name: 'English' } },
  { id: '06125adad2d5898a-01', name: 'American Standard Version', abbreviation: 'ASV', language: { name: 'English' } },
  { id: '9879dbb7cfe39e4d-04', name: 'World English Bible', abbreviation: 'WEB', language: { name: 'English' } },
  { id: NASB1995_API_BIBLE_ID, name: 'New American Standard Bible 1995', abbreviation: 'NASB1995', language: { name: 'English' } },
  { id: NBLA_API_BIBLE_ID, name: 'Nueva Biblia de las Américas', abbreviation: 'NBLA', language: { name: 'Spanish' } },
  { id: 'lsv', name: 'Literal Standard Version', abbreviation: 'LSV', language: { name: 'English' } },
];

export default function BibleVersionSelector({ selectedBibleId, onSelectBible, className = '' }) {
  const [open, setOpen] = React.useState(false);
  const [catalog, setCatalog] = React.useState(FALLBACK_BIBLES);
  const [filter, setFilter] = React.useState('');
  const [favorite, setFavorite] = useFavoriteBible();

  React.useEffect(() => {
    let active = true;
    getScriptureCatalog()
      .then((res) => {
        if (!active) return;
        const bibles = res?.data || [];
        if (bibles.length > 0) {
          // Add local translations if not in catalog
          const list = bibles.filter(bible => bible.id !== 'nasb2020');
          // Keep the explicitly configured edition available even while an
          // already-running desktop process still has the old plan catalog.
          if (!list.some(bible => bible.id === NBLA_API_BIBLE_ID)) {
            list.push(FALLBACK_BIBLES.find(bible => bible.id === NBLA_API_BIBLE_ID));
          }
          if (!list.some((b) => b.abbreviation === 'LSV')) {
            list.push({ id: 'lsv', name: 'Literal Standard Version', abbreviation: 'LSV', language: { name: 'English' } });
          }
          setCatalog(Array.from(new Map(list.map(bible => [bible.id, bible])).values()));
        }
      })
      .catch(() => {
        // Fall back to default list silently
      });

    return () => {
      active = false;
    };
  }, []);

  const activeBible = catalog.find(b => b.id === selectedBibleId)
    || catalog.find(b => b.abbreviation === selectedBibleId)
    || (favorite?.id === selectedBibleId ? favorite : null)
    || FALLBACK_BIBLES.find(b => b.id === selectedBibleId)
    || (selectedBibleId ? { id: selectedBibleId, abbreviation: selectedBibleId } : catalog.find(b => b.id === DEFAULT_BIBLE_ID) || FALLBACK_BIBLES[0]);

  const filtered = orderBibleCatalog(catalog).filter((b) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      b.name?.toLowerCase().includes(q) ||
      b.abbreviation?.toLowerCase().includes(q) ||
      b.language?.name?.toLowerCase().includes(q)
    );
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-elevated/80 px-2.5 py-1.5 text-xs font-semibold text-ink shadow-sm hover:border-brand/50 hover:bg-elevated transition ${className}`}
          title="Select Bible Version"
          aria-label="Select Bible Version"
          data-testid="button-bible-version-selector"
        >
          <span className="truncate max-w-[120px]">{activeBible?.abbreviation || 'BSB'}</span>
          <ChevronDown className="h-3 w-3 text-ink-faint shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-label="Bible translations"
          className="bex-bible-picker z-[400] rounded-xl border border-line bg-[#111722] p-3 text-ink shadow-2xl animate-in fade-in zoom-in-95"
          data-testid="bible-translation-picker"
        >
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search translation…"
              aria-label="Search Bible translations"
              className="w-full rounded-lg border border-white/10 bg-black/40 py-2 pl-8 pr-2 text-sm text-white placeholder-slate-500 outline-none focus:border-brand"
              autoFocus
            />
          </div>
          <div className="bex-bible-picker__list space-y-0.5" data-testid="bible-translation-list">
            {filtered.map((b, index) => {
              const isSelected = b.id === activeBible?.id;
              const isFavorite = b.id === favorite?.id;
              const group = bibleCatalogGroup(b);
              return (
                <React.Fragment key={b.id}>
                {(index === 0 || bibleCatalogGroup(filtered[index - 1]) !== group) && <p className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{group}</p>}
                <div className={`flex items-center rounded-lg ${isSelected ? 'bg-brand/20' : 'hover:bg-white/5'}`} data-bible-id={b.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectBible(b);
                    setOpen(false);
                  }}
                  className={`min-w-0 flex-1 flex items-center justify-between rounded-lg px-2.5 py-2.5 text-left text-sm transition focus-visible:outline focus-visible:outline-brand ${
                    isSelected ? 'text-brand-light font-semibold' : 'text-slate-300'
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white">{b.abbreviation}</span>
                      {b.language?.name && (
                        <span className="text-[10px] text-slate-500 font-normal">({b.language.name})</span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-slate-400">{b.name}</p>
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-brand" />}
                </button>
                <button type="button" aria-pressed={isFavorite}
                  aria-label={isFavorite ? `Remove ${b.abbreviation} as default translation` : `Make ${b.abbreviation} the default translation`}
                  title={isFavorite ? 'Default translation — click to remove' : 'Star to use this translation for future searches'}
                  onClick={() => setFavorite(isFavorite ? null : b)}
                  disabled={isTranslationRemovedFromPlan(b.abbreviation)}
                  className={`mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/10 focus-visible:outline focus-visible:outline-brand disabled:opacity-30 ${isFavorite ? 'text-amber-300' : 'text-slate-500 hover:text-amber-200'}`}
                  data-testid={`favorite-bible-${b.id}`}>
                  <Star className="h-4 w-4" fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
                </div>
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <p className="py-4 text-center text-xs text-slate-500">No matching translation</p>
            )}
          </div>
          <p className="mt-2 border-t border-white/5 px-2 pt-2 text-xs text-slate-500">Star a translation to make it your default for new Scripture searches.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
