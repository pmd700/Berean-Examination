import React from 'react';
import { Upload, Files, FileText, Image as ImageIcon, Package, Braces, FileCode2, Sparkles, DatabaseBackup } from 'lucide-react';

// Export/Import menu pulled out of KnowledgeWeb.jsx into its own presentational
// component so it can be render-tested in isolation. The test guard
// (tests/exportMenu.test.js) asserts every export button exists with the
// expected `data-testid` and toggles to its "Exporting..."/disabled state
// when the corresponding `isExporting*` flag is true.
//
// Layout:
//   1. A compact region pill row at the top (Whole / View / Section).
//   2. "AS IMAGE" group — PDF, JPEG, PNG. Honors sectionOnlyDisabled.
//   3. "AS DATA"  group — .berean, JSON, Markdown.
//   4. A single Import row at the bottom that auto-detects format from the
//      file extension.
//
// AI-friendly formats (PNG, Markdown) get a subtle purple icon tile + a
// Sparkles hint so users know which formats round-trip well to LLMs.

function ExportRow({
  icon: Icon,
  label,
  caption,
  ext,
  isLoading,
  isDisabled,
  onClick,
  testId,
  title,
  accent = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading || isDisabled}
      className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-ink-muted hover:bg-elevated active:bg-[#222838] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      data-testid={testId}
      title={title}
    >
      <span
        className={`relative w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
          accent
            ? 'bg-brand/20 text-[#C3A9E8] group-hover:bg-brand/35'
            : 'bg-elevated text-ink-muted group-hover:bg-[#22293a]'
        }`}
      >
        <Icon className="w-3.5 h-3.5" />
        {accent && (
          <Sparkles className="absolute -top-1 -right-1 w-2.5 h-2.5 text-[#E0BBE4] drop-shadow" />
        )}
      </span>
      <span className="flex flex-col items-start leading-tight min-w-0 flex-1 text-left">
        <span className="text-[11px] font-medium text-[#D4DAE6]">
          {isLoading ? 'Exporting...' : label}
        </span>
        {caption && (
          <span className="text-[9px] text-ink-faint truncate max-w-full">{caption}</span>
        )}
      </span>
      <span className="ml-auto text-[9px] font-mono tracking-tight text-[#7C8699] bg-[#0F1218] border border-line rounded px-1.5 py-0.5 shrink-0 group-hover:text-[#D4DAE6] group-hover:border-[#3a4258] transition-colors">
        {ext}
      </span>
    </button>
  );
}

function GroupLabel({ children }) {
  return (
    <div className="px-3 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
      {children}
    </div>
  );
}

export default function ExportMenu({
  exportRegion = 'whole',
  setExportRegion,
  selectedObjectId,
  canvasObjects = [],
  isExportingPdf,
  isExportingJpeg,
  isExportingPng,
  isExportingBerean,
  isExportingJson,
  isExportingMarkdown,
  isImportingBerean,
  isMassImporting,
  handleExportPdf,
  handleExportJpeg,
  handleExportPng,
  handleExportBerean,
  handleExportJson,
  handleExportMarkdown,
  handleImportBerean,
  handleMassImport,
  canUseCurrentWeb = true,
  isBackingUp,
  backupProgress,
  handleFullBackup,
  onAfterAction,
}) {
  const sectionAvailable = canvasObjects.some(
    (o) => o.id === selectedObjectId && o.object_type === 'section',
  );
  const regionOptions = [
    { value: 'whole', label: 'Whole', enabled: true },
    { value: 'view', label: 'View', enabled: true },
    { value: 'section', label: 'Section', enabled: sectionAvailable },
  ];
  const activeRegion = exportRegion === 'section' && !sectionAvailable ? 'whole' : exportRegion;
  const sectionOnlyDisabled = exportRegion === 'section' && !sectionAvailable;
  const after = () => { if (typeof onAfterAction === 'function') onAfterAction(); };
  const wrap = (fn) => () => { fn?.(); after(); };

  return (
    <>
      <div className="px-3 pt-2 pb-1.5">
        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-faint mb-1.5">
          Region
        </div>
        <div className="flex gap-1 p-0.5 rounded-md bg-[#0F1218] border border-line" role="radiogroup" aria-label="Export region">
          {regionOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={activeRegion === opt.value}
              disabled={!opt.enabled}
              onClick={() => setExportRegion?.(opt.value)}
              className={`flex-1 text-[10px] px-2 py-1 rounded transition-all ${
                activeRegion === opt.value
                  ? 'bg-brand/40 text-white shadow-[0_1px_3px_rgba(107,76,154,0.3)]'
                  : 'text-ink-muted hover:bg-elevated'
              } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
              data-testid={`button-export-region-${opt.value}`}
              title={!opt.enabled ? 'Select a section on the canvas first' : undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <GroupLabel>As image</GroupLabel>
      <div className="px-1.5 pb-1 space-y-0.5">
        <ExportRow
          icon={FileText}
          label="PDF"
          caption="Multi-page document"
          ext=".pdf"
          isLoading={isExportingPdf}
          isDisabled={!canUseCurrentWeb || sectionOnlyDisabled}
          onClick={wrap(handleExportPdf)}
          testId="button-export-pdf"
          title="Vector PDF. Best for printing and sharing as a document."
        />
        <ExportRow
          icon={ImageIcon}
          label="JPEG"
          caption="Compact share · small file"
          ext=".jpg"
          isLoading={isExportingJpeg}
          isDisabled={!canUseCurrentWeb || sectionOnlyDisabled}
          onClick={wrap(handleExportJpeg)}
          testId="button-export-jpeg"
          title="Compressed JPEG. Smallest file size, best for casual sharing."
        />
        <ExportRow
          icon={ImageIcon}
          label="PNG"
          caption="Lossless · for AI / OCR"
          ext=".png"
          isLoading={isExportingPng}
          isDisabled={!canUseCurrentWeb || sectionOnlyDisabled}
          onClick={wrap(handleExportPng)}
          testId="button-export-png"
          accent
          title="Lossless PNG. Best for sharing dense webs with AI tools that need to read every label. File size will be much larger than JPEG."
        />
      </div>

      <GroupLabel>As data</GroupLabel>
      <div className="px-1.5 pb-1 space-y-0.5">
        <ExportRow
          icon={Package}
          label="Berean archive"
          caption="Full backup · re-importable"
          ext=".berean"
          isLoading={isExportingBerean}
          isDisabled={!canUseCurrentWeb}
          onClick={wrap(handleExportBerean)}
          testId="button-export-berean"
          title="Native Berean archive. Includes everything (cards, connections, sections, decorations) for a perfect restore."
        />
        <ExportRow
          icon={Braces}
          label="JSON"
          caption="Structured data for other apps"
          ext=".json"
          isLoading={isExportingJson}
          isDisabled={!canUseCurrentWeb}
          onClick={wrap(handleExportJson)}
          testId="button-export-json"
          title="Use JSON to move structured Knowledge Web data into compatible apps, scripts, or analysis tools."
        />
        <ExportRow
          icon={FileCode2}
          label="Markdown"
          caption="For LLMs · round-trips"
          ext=".md"
          isLoading={isExportingMarkdown}
          isDisabled={!canUseCurrentWeb}
          onClick={wrap(handleExportMarkdown)}
          testId="button-export-markdown"
          accent
          title="Markdown export. Best for feeding your board to an LLM as text — readable cards on top, full board state hidden in a comment so you can re-import and restore your web exactly."
        />
      </div>

      <div className="mt-1 pt-1.5 border-t border-line px-1.5 pb-1.5">
        <button
          type="button"
          onClick={wrap(handleImportBerean)}
          disabled={isImportingBerean || !canUseCurrentWeb}
          className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-ink-muted hover:bg-elevated active:bg-[#222838] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          data-testid="button-import-berean"
          title="Import a previously exported file. Format is detected from the extension."
        >
          <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-elevated text-ink-muted group-hover:bg-[#22293a] transition-colors">
            <Upload className="w-3.5 h-3.5" />
          </span>
          <span className="flex flex-col items-start leading-tight min-w-0 flex-1 text-left">
            <span className="text-[11px] font-medium text-[#D4DAE6]">
              {isImportingBerean ? 'Importing...' : 'Import file'}
            </span>
            <span className="text-[9px] text-ink-faint">Auto-detects format</span>
          </span>
          <span className="ml-auto flex items-center gap-1 shrink-0">
            {['.berean', '.json', '.md'].map((ext) => (
              <span
                key={ext}
                className="text-[9px] font-mono tracking-tight text-[#7C8699] bg-[#0F1218] border border-line rounded px-1 py-0.5 group-hover:text-[#D4DAE6] group-hover:border-[#3a4258] transition-colors"
              >
                {ext}
              </span>
            ))}
          </span>
        </button>
      </div>

      <div className="px-1.5 pb-1.5">
        <button
          type="button"
          onClick={wrap(handleMassImport)}
          disabled={isMassImporting}
          className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-ink-muted hover:bg-elevated active:bg-[#222838] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          data-testid="button-mass-import"
          title="Create one Knowledge Web for every .berean file and one note for every Markdown file."
        >
          <span className="relative w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-brand/20 text-[#C3A9E8] group-hover:bg-brand/35 transition-colors">
            <Files className="w-3.5 h-3.5" />
            <Sparkles className="absolute -top-1 -right-1 w-2.5 h-2.5 text-[#E0BBE4] drop-shadow" />
          </span>
          <span className="flex flex-col items-start leading-tight min-w-0 flex-1 text-left">
            <span className="text-[11px] font-medium text-[#D4DAE6]">
              {isMassImporting ? 'Importing files...' : 'Mass import'}
            </span>
            <span className="text-[9px] text-ink-faint">Import an entire folder</span>
          </span>
          <span className="ml-auto flex items-center gap-1 shrink-0">
            {['.berean', '.md'].map((ext) => (
              <span key={ext} className="text-[9px] font-mono tracking-tight text-[#7C8699] bg-[#0F1218] border border-line rounded px-1 py-0.5 group-hover:text-[#D4DAE6] group-hover:border-[#3a4258] transition-colors">{ext}</span>
            ))}
          </span>
        </button>
      </div>

      {handleFullBackup && (
        <div className="mt-1 pt-1.5 border-t border-line px-1.5 pb-1.5">
          <GroupLabel>Backup</GroupLabel>
          <button
            type="button"
            onClick={() => handleFullBackup()}
            disabled={isBackingUp}
            className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-ink-muted hover:bg-elevated active:bg-[#222838] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            data-testid="button-full-backup"
            title="Exports every Knowledge Web as restore-compatible Markdown and downloads them in one zip."
          >
            <span className="relative w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-brand/20 text-[#C3A9E8] group-hover:bg-brand/35 transition-colors">
              <DatabaseBackup className="w-3.5 h-3.5" />
            </span>
            <span className="flex flex-col items-start leading-tight min-w-0 flex-1 text-left">
              <span className="text-[11px] font-medium text-[#D4DAE6]">
                {isBackingUp ? (backupProgress || 'Backing up...') : 'Full Second Brain Backup'}
              </span>
              <span className="text-[9px] text-ink-faint max-w-full" data-testid="text-full-backup-help">
                {isBackingUp
                  ? 'Keep this menu open until the download starts.'
                  : 'Exports every Knowledge Web as restore-compatible Markdown and downloads them in one zip.'}
              </span>
            </span>
            <span className="ml-auto text-[9px] font-mono tracking-tight text-[#7C8699] bg-[#0F1218] border border-line rounded px-1.5 py-0.5 shrink-0 group-hover:text-[#D4DAE6] group-hover:border-[#3a4258] transition-colors">
              .zip
            </span>
          </button>
        </div>
      )}
    </>
  );
}
