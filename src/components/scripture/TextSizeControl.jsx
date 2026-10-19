import React from 'react';
import { usePersistentPreference } from '@/lib/usePersistentPreference';
import {
  applyTextSizeVariables,
  DEFAULT_TEXT_SIZE,
  getTextSizeScale,
  normalizeTextSize,
  scaleTextPixels,
} from '@/lib/textSize';

export function useTextSizePreference() {
  const [storedValue, setStoredValue] = usePersistentPreference('text_size', DEFAULT_TEXT_SIZE);
  const value = normalizeTextSize(storedValue);

  React.useEffect(() => {
    applyTextSizeVariables(document.documentElement, value);
  }, [value]);

  const setValue = React.useCallback((next) => {
    setStoredValue(normalizeTextSize(next));
  }, [setStoredValue]);

  return [value, setValue];
}

export { getTextSizeScale, normalizeTextSize, scaleTextPixels };

export function useScriptureNotesTextSizePreference() {
  const [storedValue, setStoredValue] = usePersistentPreference('scripture_notes_text_size', DEFAULT_TEXT_SIZE);
  const value = normalizeTextSize(storedValue);
  React.useEffect(() => {
    document.documentElement.style.setProperty('--bex-scripture-note-text-size', `${scaleTextPixels(13, value)}px`);
  }, [value]);
  const setValue = React.useCallback(next => setStoredValue(normalizeTextSize(next)), [setStoredValue]);
  return [value, setValue];
}

export default function TextSizeControl({
  value = DEFAULT_TEXT_SIZE,
  onChange,
  ariaLabel = 'Text size',
  testId = 'text-size-control',
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] font-serif text-gray-400 dark:text-gray-500 leading-none select-none">A</span>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        data-testid={testId}
        className="text-size-slider w-24 h-1.5 appearance-none bg-gray-300 dark:bg-gray-600 rounded-full cursor-pointer accent-brand"
        style={{ accentColor: 'rgb(var(--brand))' }}
      />
      <span className="text-base font-serif text-gray-400 dark:text-gray-500 leading-none select-none">A</span>
      <style>{`
        .text-size-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgb(var(--brand));
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .text-size-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgb(var(--brand));
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .dark .text-size-slider::-webkit-slider-thumb {
          border-color: #1f2937;
        }
        .dark .text-size-slider::-moz-range-thumb {
          border-color: #1f2937;
        }
      `}</style>
    </div>
  );
}

export function getScriptureTextClass(size = 3) {
  switch (size) {
    case 1: return 'text-sm leading-[1.5]';
    case 2: return 'text-base leading-[1.5]';
    case 3: return 'text-lg leading-[1.5]';
    case 4: return 'text-xl leading-[1.65]';
    case 5: return 'text-2xl leading-[1.65]';
    default: return 'text-lg leading-[1.5]';
  }
}

export function getVerseNumberClass(size = 3) {
  switch (size) {
    case 1: return 'text-xs';
    case 2: return 'text-xs';
    case 3: return 'text-xs';
    case 4: return 'text-xs';
    case 5: return 'text-sm';
    default: return 'text-xs';
  }
}

export function getHeaderClass(size = 3) {
  switch (size) {
    case 1: return 'text-[15px]';
    case 2: return 'text-[17px]';
    case 3: return 'text-[19px]';
    case 4: return 'text-[22px]';
    case 5: return 'text-[27px]';
    default: return 'text-[19px]';
  }
}
