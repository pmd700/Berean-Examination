import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  CircleOff,
  FileArchive,
  FileCode2,
  FolderCheck,
  FolderOpen,
  Loader2,
  Network,
  NotebookPen,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

const CATEGORY_META = Object.freeze([
  {
    key: 'web',
    aliases: ['knowledge', 'knowledgeWebs', 'knowledge_webs'],
    label: 'Knowledge Webs',
    singular: 'web',
    extension: '.berean',
    archiveLabel: 'Knowledge Web backup',
    Icon: Network,
    accent: 'text-violet-200',
    surface: 'border-violet-300/15 bg-violet-400/[0.055]',
  },
  {
    key: 'note',
    aliases: ['notes'],
    label: 'Notes',
    singular: 'note',
    extension: '.md',
    archiveLabel: 'Notes backup',
    Icon: NotebookPen,
    accent: 'text-amber-200',
    surface: 'border-amber-300/15 bg-amber-400/[0.045]',
  },
  {
    key: 'timeline',
    aliases: ['timelines', 'timegraphs'],
    label: 'Timelines',
    singular: 'timeline',
    extension: '.json',
    archiveLabel: 'Timelines backup',
    Icon: FileCode2,
    accent: 'text-teal-200',
    surface: 'border-teal-300/15 bg-teal-400/[0.045]',
  },
]);

const PROGRESS_PHASES = Object.freeze([
  { key: 'preparing', label: 'Preparing' },
  { key: 'zipping', label: 'Zipping' },
  { key: 'saving', label: 'Saving' },
]);

const NOOP = () => {};

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  if (Number.isFinite(Number(value))) return Math.max(0, Math.trunc(Number(value)));
  if (value && Array.isArray(value.items)) return value.items.length;
  if (value && Number.isFinite(Number(value.count))) return Math.max(0, Math.trunc(Number(value.count)));
  return 0;
}

function inventoryCount(inventory, category) {
  if (!inventory || typeof inventory !== 'object') return 0;
  const keys = [category.key, ...category.aliases];
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(inventory, candidate));
  return key ? countValue(inventory[key]) : 0;
}

function inferCategory(file) {
  const explicit = String(file?.category || file?.kind || file?.type || '').toLowerCase();
  const name = String(file?.fileName || file?.name || file || '').toLowerCase();
  if (explicit.includes('web') || explicit.includes('knowledge') || name.includes('knowledge')) return 'web';
  if (explicit.includes('note') || name.includes('note')) return 'note';
  if (explicit.includes('time') || name.includes('timeline')) return 'timeline';
  return null;
}

function normalizeFiles(files) {
  if (!files) return [];
  if (!Array.isArray(files) && typeof files === 'object') {
    return Object.entries(files).flatMap(([category, value]) => {
      if (!value) return [];
      return [{ ...(typeof value === 'string' ? { fileName: value } : value), category }];
    });
  }
  return (Array.isArray(files) ? files : [files]).filter(Boolean).map((file) => (
    typeof file === 'string' ? { fileName: file } : file
  ));
}

function normalizeFailures(failures) {
  if (!failures) return [];
  if (Array.isArray(failures)) return failures;
  if (Number.isFinite(Number(failures))) {
    const count = Math.max(0, Math.trunc(Number(failures)));
    return count ? [`${count} ${count === 1 ? 'item was' : 'items were'} not included.`] : [];
  }
  return [failures];
}

function failureMessage(failure) {
  if (typeof failure === 'string') return failure;
  return failure?.message || failure?.reason || failure?.label || 'An item could not be included.';
}

function failureGuidance(failure) {
  const message = failureMessage(failure);
  if (/missing or duplicate ID/i.test(message)) {
    return 'Open this web and recreate the affected card, object, or connection. Run Mass Backup again afterward.';
  }
  return '';
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function progressPhaseIndex(stage, progress) {
  const kind = String(progress?.kind || stage || '').toLowerCase();
  if (kind.includes('sav') || kind.includes('writ')) return 2;
  if (kind.includes('zip') || kind.includes('build') || kind.includes('pack') || kind.includes('complete')) return 1;
  return 0;
}

function progressPercent(progress) {
  const explicit = Number(progress?.percent);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));
  const current = Number(progress?.current);
  const total = Number(progress?.total);
  if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    return Math.max(0, Math.min(100, (current / total) * 100));
  }
  return null;
}

function DestinationCard({ folderPath, choosingFolder, disabled, onChooseFolder }) {
  return (
    <section className="rounded-2xl border border-white/[0.075] bg-black/[0.13] p-3.5" aria-label="Backup destination">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${folderPath ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}>
          {folderPath ? <FolderCheck className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Backup folder</p>
          {folderPath ? (
            <p className="mt-1 truncate text-xs text-slate-300" title={folderPath} data-testid="mass-backup-destination">
              {folderPath}
            </p>
          ) : (
            <p className="mt-1 text-xs leading-5 text-amber-100/80">Choose a folder once. BEX will remember it for your next backup.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onChooseFolder}
          disabled={disabled || choosingFolder || typeof onChooseFolder !== 'function'}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-semibold text-slate-200 transition hover:border-violet-300/25 hover:bg-violet-400/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
          data-testid="mass-backup-choose"
        >
          {choosingFolder && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {folderPath ? 'Change' : 'Choose folder'}
        </button>
      </div>
    </section>
  );
}

function InventoryPanel({ counts, reduceMotion }) {
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  return (
    <section aria-label="Backup contents">
      <div className="mb-2 flex justify-end">
        <span className="rounded-full border border-violet-300/15 bg-violet-400/[0.07] px-2.5 py-1 text-[10px] font-semibold tabular-nums text-violet-200">
          {total} {total === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
        {counts.map(({ category, count }, index) => {
          const { Icon } = category;
          return (
            <motion.div
              key={category.key}
              initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: reduceMotion ? 0 : index * 0.055, duration: 0.24 }}
              className={`relative overflow-hidden rounded-2xl border p-3 ${category.surface}`}
              data-testid={`mass-backup-count-${category.key}`}
            >
              <span className="flex items-center justify-between gap-2">
                <Icon className={`h-4 w-4 ${category.accent}`} />
                <span className="font-mono text-[9px] text-slate-600">{category.extension}</span>
              </span>
              <span className="mt-4 block text-xl font-semibold tabular-nums text-slate-100">{count}</span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-500">{category.label}</span>
              {count > 0 && (
                <motion.span
                  initial={reduceMotion ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 30, delay: reduceMotion ? 0 : 0.1 + index * 0.055 }}
                  className="absolute right-2.5 top-9 grid h-4 w-4 place-items-center rounded-full bg-emerald-400 text-[#07110e]"
                  aria-hidden="true"
                >
                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                </motion.span>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[10.5px] text-slate-500">
        <CircleOff className="h-3.5 w-3.5 shrink-0 text-slate-600" />
        Bible studies and chapters are excluded from Mass Backup.
      </div>
    </section>
  );
}

function ReplacePreviousSetting({ checked, disabled, onCheckedChange }) {
  const switchId = React.useId();
  return (
    <section className={`rounded-2xl border p-3.5 transition-colors ${checked ? 'border-emerald-300/15 bg-emerald-400/[0.045]' : 'border-white/[0.065] bg-white/[0.018]'}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${checked ? 'bg-emerald-400/10 text-emerald-200' : 'bg-white/[0.04] text-slate-500'}`}>
          <ShieldCheck className="h-4 w-4" />
        </span>
        <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
          <span className="block text-xs font-semibold text-slate-200">Replace previous BEX backups</span>
          <span className="mt-1 block text-[10.5px] leading-4 text-slate-500">
            {checked
              ? 'Only older Mass Backup archives previously created and verified by BEX are removed. Personal files and unrelated ZIPs are never touched.'
              : 'Off by default. Each run creates fresh timestamped archives and leaves every existing file alone.'}
          </span>
        </label>
        <Switch
          id={switchId}
          checked={checked}
          disabled={disabled || typeof onCheckedChange !== 'function'}
          onCheckedChange={onCheckedChange}
          className="mt-0.5 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-slate-700"
          aria-label="Replace previous BEX backups"
          data-testid="mass-backup-replace"
        />
      </div>
    </section>
  );
}

function InventoryLoading({ reduceMotion }) {
  return (
    <motion.section
      key="inventory-loading"
      initial={reduceMotion ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
      className="rounded-2xl border border-violet-300/10 bg-violet-400/[0.035] p-4"
      data-testid="mass-backup-inventory-loading"
      role="status"
    >
      <div className="flex items-center gap-3">
        <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-violet-400/10 text-violet-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          <motion.span
            className="absolute inset-0 rounded-xl border border-violet-300/25"
            animate={reduceMotion ? undefined : { scale: [1, 1.22], opacity: [0.6, 0] }}
            transition={{ duration: 1.25, repeat: Infinity, ease: 'easeOut' }}
          />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-100">Scanning your library</p>
          <p className="mt-0.5 text-[10.5px] text-slate-500">Counting every web, note, and timeline — including items inside folders.</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 min-[360px]:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="h-16 rounded-xl bg-white/[0.035]"
            animate={reduceMotion ? undefined : { opacity: [0.35, 0.8, 0.35] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.12 }}
          />
        ))}
      </div>
    </motion.section>
  );
}

function BackupProgress({ folderPath, progress, stage, reduceMotion }) {
  const activeIndex = progressPhaseIndex(stage, progress);
  const percent = progressPercent(progress);
  const current = Number(progress?.current);
  const total = Number(progress?.total);
  const hasCounter = Number.isFinite(current) && Number.isFinite(total) && total > 0;
  const activeLabel = progress?.label || PROGRESS_PHASES[activeIndex].label;

  return (
    <motion.section
      key="backup-progress"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.985, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.99 }}
      className="overflow-hidden rounded-2xl border border-violet-300/15 bg-violet-400/[0.04]"
      data-testid="mass-backup-progress"
      data-stage={PROGRESS_PHASES[activeIndex].key}
      role="status"
      aria-live="polite"
    >
      <div className="relative px-5 pb-5 pt-6 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.16),transparent_55%)]" />
        <motion.span
          className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-violet-300/20 bg-[#171329] text-violet-200 shadow-[0_0_42px_rgba(139,92,246,0.18)]"
          animate={reduceMotion ? undefined : { y: [0, -3, 0], rotate: [0, -2, 2, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Archive className="h-6 w-6" />
          <motion.span
            className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-violet-400 text-[#100b1c]"
            animate={reduceMotion ? undefined : { rotate: 360 }}
            transition={{ duration: 1.3, repeat: Infinity, ease: 'linear' }}
          >
            <Loader2 className="h-3 w-3" />
          </motion.span>
        </motion.span>
        <h3 className="relative mt-4 text-base font-semibold text-slate-100">{activeLabel}</h3>
        <p className="relative mt-1 text-[10.5px] text-slate-500">
          {hasCounter ? `${Math.min(current, total)} of ${total}` : 'Keeping each backup type in its own archive'}
        </p>
      </div>

      <div className="border-t border-white/[0.055] bg-black/[0.08] px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          {PROGRESS_PHASES.map((phase, index) => {
            const complete = index < activeIndex;
            const active = index === activeIndex;
            return (
              <div key={phase.key} className="flex min-w-0 items-center gap-2" data-state={complete ? 'complete' : active ? 'active' : 'pending'}>
                <motion.span
                  animate={active && !reduceMotion ? { scale: [1, 1.12, 1] } : undefined}
                  transition={{ duration: 1.1, repeat: Infinity }}
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${complete ? 'border-emerald-300/30 bg-emerald-400 text-[#07110e]' : active ? 'border-violet-300/35 bg-violet-400/15 text-violet-200' : 'border-white/[0.08] bg-white/[0.025] text-slate-700'}`}
                >
                  {complete ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </motion.span>
                <span className={`truncate text-[10px] font-medium ${complete ? 'text-emerald-200/75' : active ? 'text-violet-100' : 'text-slate-700'}`}>{phase.label}</span>
              </div>
            );
          })}
        </div>

        <div
          className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.055]"
          role="progressbar"
          aria-label="Mass Backup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent == null ? undefined : Math.round(percent)}
        >
          {percent == null ? (
            <motion.span
              className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-violet-300 to-transparent"
              animate={reduceMotion ? { left: '34%' } : { left: ['-35%', '110%'] }}
              transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
            />
          ) : (
            <motion.span
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 via-violet-300 to-teal-300"
              initial={false}
              animate={{ width: `${percent}%` }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: 'easeOut' }}
            />
          )}
        </div>
        {folderPath && <p className="mt-3 truncate text-center text-[9.5px] text-slate-600" title={folderPath}>{folderPath}</p>}
      </div>
    </motion.section>
  );
}

function ResultIcon({ tone, reduceMotion }) {
  const success = tone === 'success';
  const partial = tone === 'partial';
  return (
    <motion.span
      initial={reduceMotion ? false : { scale: 0, rotate: success ? -18 : 0 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className={`relative mx-auto grid h-14 w-14 place-items-center rounded-full ${success ? 'bg-emerald-400 text-[#07110e] shadow-[0_0_38px_rgba(52,211,153,0.25)]' : partial ? 'bg-amber-300 text-[#171007]' : 'bg-red-400/15 text-red-200'}`}
    >
      {success ? <CheckCircle2 className="h-7 w-7" /> : <AlertTriangle className="h-6 w-6" />}
      {success && !reduceMotion && [0, 90, 180, 270].map((rotation) => (
        <span key={rotation} style={{ transform: `translate(-50%, -29px) rotate(${rotation}deg)` }} className="absolute left-1/2 top-1/2 origin-[50%_29px]">
          <motion.span
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ opacity: [0, 0.9, 0], scaleY: [0, 1, 0] }}
            transition={{ duration: 0.62, delay: 0.12 }}
            className="block h-2.5 w-px origin-bottom bg-emerald-200"
          />
        </span>
      ))}
    </motion.span>
  );
}

function ResultPanel({ error, failures, files, folderPath, removed, stage, reduceMotion, onResolveFailure }) {
  const partial = stage === 'partial' || (stage === 'success' && failures.length > 0);
  const success = stage === 'success' && !partial;
  const tone = success ? 'success' : partial ? 'partial' : 'error';
  const title = success ? 'Backup complete' : partial ? 'Backup saved with a warning' : 'Backup did not finish';
  const detail = success
    ? `${files.length} ${files.length === 1 ? 'archive is' : 'archives are'} ready in your backup folder.`
    : partial
      ? 'The healthy archives shown below were saved. Fix anything listed under Needs attention, then run Mass Backup again.'
      : error || 'BEX could not create the Mass Backup. Your existing files were left unchanged.';

  return (
    <motion.section
      key={`backup-result-${tone}`}
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
      data-testid={success ? 'mass-backup-success' : partial ? 'mass-backup-partial' : 'mass-backup-error'}
      role="status"
      aria-live="polite"
    >
      <div className={`rounded-2xl border px-5 py-5 text-center ${success ? 'border-emerald-300/15 bg-emerald-400/[0.045]' : partial ? 'border-amber-300/15 bg-amber-400/[0.045]' : 'border-red-300/15 bg-red-400/[0.04]'}`}>
        <ResultIcon tone={tone} reduceMotion={reduceMotion} />
        <h3 className="mt-4 text-base font-semibold text-slate-100">{title}</h3>
        <p className="mx-auto mt-1.5 max-w-md text-[10.5px] leading-5 text-slate-500">{detail}</p>
      </div>

      {files.length > 0 && (
        <div className="mt-3 space-y-2" aria-label="Created backup archives">
          {files.map((file, index) => {
            const categoryKey = inferCategory(file);
            const category = CATEGORY_META.find((item) => item.key === categoryKey);
            const fileName = file.fileName || file.name || `Backup archive ${index + 1}`;
            const itemCount = Number(file.itemCount ?? file.count);
            const bytes = formatBytes(file.bytes ?? file.size);
            return (
              <motion.div
                key={`${fileName}-${index}`}
                initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: reduceMotion ? 0 : 0.08 + index * 0.05 }}
                className="flex items-center gap-3 rounded-xl border border-white/[0.065] bg-white/[0.025] px-3 py-2.5"
                data-testid="mass-backup-result-file"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-200"><FileArchive className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-slate-200" title={fileName}>{fileName}</span>
                  <span className="mt-0.5 block text-[9.5px] text-slate-600">
                    {category?.archiveLabel || 'Mass Backup archive'}
                    {Number.isFinite(itemCount) ? ` · ${itemCount} ${itemCount === 1 ? category?.singular || 'item' : `${category?.singular || 'item'}s`}` : ''}
                    {bytes ? ` · ${bytes}` : ''}
                  </span>
                </span>
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400 text-[#07110e]"><Check className="h-3 w-3 stroke-[3]" /></span>
              </motion.div>
            );
          })}
        </div>
      )}

      {removed > 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-300/10 bg-emerald-400/[0.035] px-3 py-2 text-[10px] text-emerald-100/70">
          <RefreshCw className="h-3.5 w-3.5" />
          Replaced {removed} older BEX-created {removed === 1 ? 'archive' : 'archives'}. Personal files were untouched.
        </p>
      )}

      {failures.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-400/[0.035] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/75">{partial ? 'Needs attention' : 'Not included'}</p>
          <ul className="mt-2 space-y-2 text-[10.5px] leading-4 text-amber-50/70">
            {failures.map((failure, index) => {
              const guidance = failureGuidance(failure);
              const canOpenItem = (
                failure?.kind === 'knowledge'
                && failure?.itemId != null
                && typeof onResolveFailure === 'function'
              );
              return (
                <li key={index} className="rounded-lg border border-amber-200/[0.07] bg-black/[0.09] px-2.5 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      {failure?.itemTitle && <strong className="block font-semibold text-amber-50/90">{failure.itemTitle}</strong>}
                      <span className="block">{failureMessage(failure)}</span>
                    </span>
                    {canOpenItem && (
                      <button
                        type="button"
                        onClick={() => onResolveFailure(failure)}
                        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-amber-200/15 bg-amber-300/[0.08] px-2.5 text-[9.5px] font-semibold text-amber-100 transition hover:bg-amber-300/[0.14]"
                        data-testid="mass-backup-fix-item"
                      >
                        <Network className="h-3 w-3" /> Open web to fix
                      </button>
                    )}
                  </div>
                  {guidance && <p className="mt-1.5 text-[9.5px] leading-4 text-amber-100/55">{guidance}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {folderPath && files.length > 0 && <p className="mt-3 truncate text-center text-[9.5px] text-slate-600" title={folderPath}>{folderPath}</p>}
    </motion.section>
  );
}

export default function MassBackupDialog({
  open = false,
  inventory = null,
  settings = {},
  stage = 'ready',
  progress = null,
  result = null,
  error = '',
  choosingFolder = false,
  settingsBusy = false,
  onClose = NOOP,
  onChooseFolder,
  onReplacePreviousChange,
  onRetry,
  onStart,
  onRevealFolder,
  onResolveFailure,
}) {
  const reduceMotion = useReducedMotion();
  const panelRef = React.useRef(null);
  const folderPath = typeof settings?.folderPath === 'string' ? settings.folderPath : '';
  const replacePrevious = settings?.replacePrevious === true;
  const counts = CATEGORY_META.map((category) => ({
    category,
    count: inventoryCount(inventory, category),
  }));
  const totalItems = counts.reduce((sum, item) => sum + item.count, 0);
  const files = normalizeFiles(result?.files || result?.archives);
  const failures = normalizeFailures(result?.failures);
  const removed = Array.isArray(result?.removed)
    ? result.removed.length
    : Math.max(0, Math.trunc(Number(result?.removed) || 0));
  const loadingInventory = stage === 'loading';
  const working = stage === 'building' || stage === 'saving';
  const terminal = stage === 'success' || stage === 'partial' || stage === 'error';
  const controlsBusy = loadingInventory || working || settingsBusy || choosingFolder;
  const canStart = !controlsBusy && totalItems > 0 && Boolean(folderPath) && typeof onStart === 'function';
  const canRetry = stage === 'error' && !controlsBusy && typeof onRetry === 'function';

  React.useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);

  React.useEffect(() => {
    if (!open || working) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose?.();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open, working]);

  const closeDialog = () => {
    if (!working) onClose?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100003] grid place-items-center overflow-y-auto bg-black/70 p-3 backdrop-blur-md sm:p-5"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <motion.section
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mass-backup-title"
            tabIndex={-1}
            initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.965 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            onMouseDown={(event) => event.stopPropagation()}
            className="relative flex max-h-[min(820px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#10141d] text-slate-100 shadow-[0_34px_120px_rgba(0,0,0,0.75)] outline-none"
            data-testid="mass-backup-dialog"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/80 to-transparent" />
            <div className="pointer-events-none absolute -right-28 -top-32 h-72 w-72 rounded-full bg-violet-500/[0.08] blur-3xl" />

            <header className="relative flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-3 sm:px-5">
              <h2 id="mass-backup-title" className="min-w-0 flex-1 text-base font-semibold tracking-tight text-slate-100">Mass Backup</h2>
              <button
                type="button"
                onClick={closeDialog}
                disabled={working}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-white/[0.055] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Close Mass Backup"
                data-testid="mass-backup-close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <AnimatePresence mode="wait" initial={false}>
                {loadingInventory ? (
                  <div key="loading-view" className="space-y-3">
                    <InventoryLoading reduceMotion={reduceMotion} />
                    <DestinationCard
                      folderPath={folderPath}
                      choosingFolder={choosingFolder}
                      disabled={loadingInventory || settingsBusy}
                      onChooseFolder={onChooseFolder}
                    />
                  </div>
                ) : working ? (
                  <BackupProgress
                    key="working-view"
                    folderPath={folderPath}
                    progress={progress}
                    stage={stage}
                    reduceMotion={reduceMotion}
                  />
                ) : terminal ? (
                  <motion.div
                    key="terminal-view"
                    initial={reduceMotion ? false : { opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
                    className="space-y-3"
                  >
                    <ResultPanel
                      error={error}
                      failures={failures}
                      files={files}
                      folderPath={folderPath}
                      removed={removed}
                      stage={stage}
                      reduceMotion={reduceMotion}
                      onResolveFailure={onResolveFailure}
                    />
                    {(stage === 'error' || !folderPath) && (
                      <DestinationCard
                        folderPath={folderPath}
                        choosingFolder={choosingFolder}
                        disabled={settingsBusy}
                        onChooseFolder={onChooseFolder}
                      />
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="ready-view"
                    initial={reduceMotion ? false : { opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
                    className="space-y-3"
                  >
                    <InventoryPanel counts={counts} reduceMotion={reduceMotion} />
                    <DestinationCard
                      folderPath={folderPath}
                      choosingFolder={choosingFolder}
                      disabled={settingsBusy}
                      onChooseFolder={onChooseFolder}
                    />
                    <ReplacePreviousSetting
                      checked={replacePrevious}
                      disabled={settingsBusy || choosingFolder}
                      onCheckedChange={onReplacePreviousChange}
                    />
                    {totalItems === 0 && (
                      <p className="flex items-center gap-2 rounded-xl border border-amber-300/15 bg-amber-400/[0.04] px-3 py-2.5 text-[10.5px] text-amber-100/75">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        There are no Knowledge Webs, notes, or timelines to back up yet. No empty ZIP files will be created.
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <footer className="relative flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] bg-black/[0.09] px-4 py-3 sm:px-5">
              {!working && (
                <button
                  type="button"
                  onClick={closeDialog}
                  className="h-9 rounded-xl px-3 text-[11px] font-medium text-slate-500 transition hover:bg-white/[0.045] hover:text-slate-200"
                >
                  {terminal ? 'Done' : 'Cancel'}
                </button>
              )}

              {terminal && files.length > 0 && Boolean(folderPath) && (
                <button
                  type="button"
                  onClick={onRevealFolder}
                  disabled={typeof onRevealFolder !== 'function'}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-[11px] font-semibold text-slate-200 transition hover:border-emerald-300/20 hover:bg-emerald-400/[0.06] disabled:opacity-40"
                  data-testid="mass-backup-reveal"
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Reveal folder
                </button>
              )}

              {working ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-violet-500/55 px-4 text-[11px] font-semibold text-white/80"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Backing up…
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stage === 'error' ? onRetry : onStart}
                  disabled={stage === 'error' ? !canRetry : !canStart}
                  className={`inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${terminal && stage !== 'error' ? 'border border-violet-300/20 bg-violet-400/[0.08] text-violet-100 hover:bg-violet-400/[0.13]' : 'bg-violet-500 text-white shadow-[0_10px_30px_-14px_rgba(139,92,246,0.9)] hover:bg-violet-400'}`}
                  data-testid="mass-backup-start"
                >
                  {terminal ? <RefreshCw className="h-3.5 w-3.5" /> : <FileArchive className="h-3.5 w-3.5" />}
                  {stage === 'error' ? 'Try again' : terminal ? 'Back up again' : !folderPath ? 'Choose a folder first' : totalItems === 0 ? 'Nothing to back up' : `Back up ${totalItems} ${totalItems === 1 ? 'item' : 'items'}`}
                </button>
              )}
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
