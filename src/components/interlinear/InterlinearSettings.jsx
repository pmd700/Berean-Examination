import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '../utils/I18nContext';

// Source options per testament. MAM never appears for NT; UXLC never appears
// for NT. NT keeps its existing Greek source system.
const OT_SOURCE_OPTIONS = [
  { value: 'MAM', label: 'MAM / Miqra According to the Masorah' },
];
const NT_SOURCE_OPTIONS = [{ value: 'SBLGNT', label: 'SBLGNT' }];

export default function InterlinearSettings({
  enabled,
  onToggle,
  onSourceChange,
  effectiveSource,
  isNewTestament,
  isLoading,
  sourceOnly = false,
}) {
  const { tr } = useI18n();
  const sources = isNewTestament ? NT_SOURCE_OPTIONS : OT_SOURCE_OPTIONS;
  const selectedSource = sources.find((source) => source.value === effectiveSource);
  const sourceAvailable = !isNewTestament;
  const sourceLabel = sourceAvailable
    ? `${tr('Interlinear Source')}: ${effectiveSource} · ${tr('Local')}`
    : `${effectiveSource} · ${tr('Not installed locally')}`;

  return (
    <div className="min-w-0">
      <div className="bex-interlinear-fields grid grid-cols-[minmax(0,max-content)] items-end justify-start gap-3">
        {!sourceOnly && <div>
          <p className="sr-only">
            {tr('Interlinear')}
          </p>
          <Button
            type="button"
            size="sm"
            aria-pressed={enabled}
            variant={enabled ? 'default' : 'outline'}
            onClick={onToggle}
            disabled={!sourceAvailable}
            className={enabled ? 'bg-brand hover:bg-elevated' : 'dark:border-gray-700'}
            data-testid="button-toggle-interlinear"
          >
            {enabled ? tr('Interlinear On') : tr('Interlinear Off')}
          </Button>
        </div>}

        {sourceOnly && enabled && <div className="min-w-0">
          <Label className="sr-only">{tr('Source Text')}</Label>
          <Select value={effectiveSource} onValueChange={onSourceChange} disabled={!enabled || sources.length === 1}>
            <SelectTrigger className="h-auto min-h-8 bg-elevated/50 border-line text-xs text-left gap-2 disabled:opacity-100 [&>span]:min-w-0 [&>span]:flex-1" data-testid="select-interlinear-source">
              <SelectValue placeholder={tr('Select source...')}>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="min-w-0 truncate">{tr(selectedSource?.label || effectiveSource)}</span>
                  <span className="text-[8px] leading-tight text-ink-muted" data-testid="text-interlinear-source-label">
                    {isLoading ? tr('Loading source text…') : sourceLabel}
                  </span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.value} value={s.value} data-testid={`option-source-${s.value}`}>
                  {tr(s.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>}
      </div>
    </div>
  );
}
