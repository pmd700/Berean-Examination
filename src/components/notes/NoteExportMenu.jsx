import React from 'react';
import { ChevronDown, Download, FileText, LoaderCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export default function NoteExportMenu({ onExport, disabled = false, busy = false, label = 'Export note', className = '', testId = undefined }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled || busy} aria-label={label} aria-busy={busy} className={className} data-testid={testId}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          {busy ? 'Exporting…' : 'Export'}
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-[100010] min-w-48 border-line bg-[#171c27] text-ink">
        <DropdownMenuItem onSelect={() => onExport('pdf')}><FileText /> PDF (.pdf)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onExport('md')}><FileText /> Markdown (.md)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
