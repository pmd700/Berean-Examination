import React from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import MarkdownRenderer from './MarkdownRenderer';

// View-only hover preview for annotated verse text. Shows the note(s)
// written on the hovered word. When several annotations overlap the same
// token, each note is listed. Purely presentational: pointer-events are
// disabled so it never steals focus or interferes with selection.
export default function AnnotationPreview({ annotations, position }) {
  if (!annotations || annotations.length === 0) return null;

  return ReactDOM.createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.12 }}
        className="fixed z-[9999] w-80 max-w-[90vw] max-h-72 overflow-hidden rounded-lg border border-brand/50 bg-white dark:bg-gray-900 shadow-2xl"
        style={{
          left: `${position.x}px`,
          top: `${position.y - 10}px`,
          transform: 'translate(-50%, -100%)',
          pointerEvents: 'none',
        }}
        data-annotation-preview
      >
        <div className="px-3 py-2 border-b border-brand/30 bg-brand/10">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-brand dark:text-[#9B7FC7]">
            {annotations.length > 1 ? `${annotations.length} Annotations` : 'Annotation'}
          </span>
        </div>
        <div className="p-3 space-y-3 max-h-60 overflow-y-auto">
          {annotations.map((ann, i) => (
            <div
              key={ann.id ?? i}
              className={i > 0 ? 'pt-3 border-t border-gray-200 dark:border-gray-700' : ''}
            >
              {ann.selected_text && (
                <div className="text-[11px] italic text-brand dark:text-[#9B7FC7] mb-1 line-clamp-2">
                  &ldquo;{ann.selected_text}&rdquo;
                </div>
              )}
              {ann.content && ann.content.trim() ? (
                <div className="bex-scripture-note-preview text-gray-800 dark:text-gray-200 break-words">
                  <MarkdownRenderer content={ann.content} />
                </div>
              ) : (
                <div className="text-xs text-gray-500 dark:text-gray-400 italic">
                  No note text.
                </div>
              )}
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
