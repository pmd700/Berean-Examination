import React from 'react';

/** A true timeline silhouette: axis, event stems and event markers. */
export default function TimelineGlyph({ className = '', ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M3 12h18" />
      <path d="M6 12V7.5M12 12v4.5M18 12V6" />
      <circle cx="6" cy="6.5" r="1.5" />
      <circle cx="12" cy="17.5" r="1.5" />
      <rect x="16.5" y="3.5" width="3" height="2.5" rx="0.8" />
      <circle cx="3" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="21" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
