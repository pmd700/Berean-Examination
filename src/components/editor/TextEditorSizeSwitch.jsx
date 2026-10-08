import React from 'react';
import { Minimize2, Square, Maximize } from 'lucide-react';

export default function SizeSwitch({ mode, onChange, iconsOnly = false }) {
  const opts = [
    { key: 'compact', label: 'Compact', Icon: Minimize2 },
    { key: 'expanded', label: 'Expanded', Icon: Square },
    { key: 'fullscreen', label: 'Full screen', Icon: Maximize },
  ];
  return (
    <div className="inline-flex items-center rounded-md border border-gray-700 bg-gray-800/60 p-0.5 shrink-0">
      {opts.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={label}
          aria-label={label}
          className={`inline-flex items-center gap-1 ${iconsOnly ? 'h-6 w-6 justify-center' : 'px-2 py-1'} rounded text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ${
            mode === key
              ? 'bg-brand/30 text-[#c4b3e5]'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
          }`}
        >
          <Icon className="w-3 h-3" />
          {!iconsOnly && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}
