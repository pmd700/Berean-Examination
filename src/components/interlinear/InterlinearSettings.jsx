import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '../utils/I18nContext';
import Card3DTilt from '@/components/shaders/Card3DTilt';

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
  individualWords,
  onToggleWords,
}) {
  const { tr } = useI18n();
  const sources = isNewTestament ? NT_SOURCE_OPTIONS : OT_SOURCE_OPTIONS;
  const sourceAvailable = !isNewTestament;
  const sourceLabel = sourceAvailable
    ? `${tr('Interlinear Source')}: ${effectiveSource} · ${tr('Local')}`
    : `${effectiveSource} · ${tr('Not installed locally')}`;

  return (
    <Card3DTilt
      className="flex-1"
      innerClassName="px-4 py-3"
      shaderIntensity={0.45}
      shaderHueShift={0.6}
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
              {tr('Reading Controls')}
            </p>
            <Button
              type="button"
              variant={enabled ? 'default' : 'outline'}
              onClick={onToggle}
              disabled={!sourceAvailable}
              className={enabled ? 'bg-brand hover:bg-elevated' : 'dark:border-gray-700'}
              data-testid="button-toggle-interlinear"
            >
              {enabled ? tr('Interlinear On') : tr('Interlinear Off')}
            </Button>
          </div>

          <div className="w-full sm:w-[260px]">
            <Label className="mb-2 block text-xs font-medium text-gray-500 dark:text-gray-400">{tr('Source Text')}</Label>
            <Select value={effectiveSource} onValueChange={onSourceChange} disabled={!enabled || sources.length === 1}>
              <SelectTrigger className="dark:bg-gray-800 dark:border-gray-700" data-testid="select-interlinear-source">
                <SelectValue placeholder={tr('Select source...')} />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.value} value={s.value} data-testid={`option-source-${s.value}`}>
                    {tr(s.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block text-xs font-medium text-gray-500 dark:text-gray-400">{tr('Words')}</Label>
            <Button
              type="button"
              variant={individualWords ? 'default' : 'outline'}
              onClick={onToggleWords}
              disabled={!enabled || !sourceAvailable}
              className={individualWords ? 'bg-brand hover:bg-elevated' : 'dark:border-gray-700'}
              data-testid="button-toggle-individual-words"
            >
              {tr('Individual Words')}: {individualWords ? tr('On') : tr('Off')}
            </Button>
          </div>
        </div>

        <div className="text-sm text-gray-500 dark:text-gray-400 xl:text-right" data-testid="text-interlinear-source-label">
          {isLoading ? tr('Loading source text…') : sourceLabel}
        </div>
      </div>
    </Card3DTilt>
  );
}
