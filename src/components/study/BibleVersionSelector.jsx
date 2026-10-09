import React from 'react';
import { BookOpen, ChevronDown, Check, Search } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { getScriptureCatalog } from '@/lib/scriptureClient';

const DEFAULT_BIBLE_ID = '317e03834065a236-01'; // Berean Standard Bible (BSB)

const FALLBACK_BIBLES = [
  { id: '317e03834065a236-01', name: 'Berean Standard Bible', abbreviation: 'BSB', language: { name: 'English' } },
  { id: 'de4e12af7f28f599-02', name: 'King James Version', abbreviation: 'KJV', language: { name: 'English' } },
  { id: '06125adad2d5898a-01', name: 'American Standard Version', abbreviation: 'ASV', language: { name: 'English' } },
  { id: '9879dbb7cfe39e4d-04', name: 'World English Bible', abbreviation: 'WEB', language: { name: 'English' } },
  { id: 'nasb2020', name: 'New American Standard Bible 2020', abbreviation: 'NASB2020', language: { name: 'English' } },
  { id: 'lsv', name: 'Literal Standard Version', abbreviation: 'LSV', language: { name: 'English' } },
];

export default function BibleVersionSelector({ selectedBibleId, onSelectBible, className = '' }) {
  const [open, setOpen] = React.useState(false);
  const [catalog, setCatalog] = React.useState(FALLBACK_BIBLES);
  const [filter, setFilter] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    getScriptureCatalog()
      .then((res) => {
        if (!active) return;
        const bibles = res?.data || [];
        if (bibles.length > 0) {
          // Add local translations if not in catalog
          const list = [...bibles];
          if (!list.some((b) => b.abbreviation === 'NASB2020')) {
            list.push({ id: 'nasb2020', name: 'New American Standard Bible 2020', abbreviation: 'NASB2020', language: { name: 'English' } });
          }
          if (!list.some((b) => b.abbreviation === 'LSV')) {
            list.push({ id: 'lsv', name: 'Literal Standard Version', abbreviation: 'LSV', language: { name: 'English' } });
          }
          setCatalog(list);
        }
      })
      .catch(() => {
        // Fall back to default list silently
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const activeBible = catalog.find((b) => b.id === selectedBibleId || b.abbreviation === selectedBibleId) || catalog[0];

  const filtered = catalog.filter((b) => {
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
          <BookOpen className="h-3.5 w-3.5 text-brand shrink-0" />
          <span className="truncate max-w-[120px]">{activeBible?.abbreviation || 'BSB'}</span>
          <ChevronDown className="h-3 w-3 text-ink-faint shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-xl border border-line bg-[#111722] p-2 text-ink shadow-2xl animate-in fade-in zoom-in-95"
        >
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search translation…"
              className="w-full rounded-lg border border-white/10 bg-black/40 py-1.5 pl-8 pr-2 text-xs text-white placeholder-slate-500 outline-none focus:border-brand"
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto space-y-0.5">
            {filtered.slice(0, 50).map((b) => {
              const isSelected = (b.id === activeBible?.id || b.abbreviation === activeBible?.abbreviation);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    onSelectBible(b);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition ${
                    isSelected ? 'bg-brand/20 text-brand-light font-semibold' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white">{b.abbreviation}</span>
                      {b.language?.name && (
                        <span className="text-[10px] text-slate-500 font-normal">({b.language.name})</span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-slate-400">{b.name}</p>
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-brand" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="py-4 text-center text-xs text-slate-500">No matching translation</p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
