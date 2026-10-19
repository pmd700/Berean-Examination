import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

// Expand the layout first, then reveal the source text inside the new space.
export default function InterlinearReveal({ children, className, testId }) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : 0.55;
  return (
    <motion.div
      className={className}
      data-testid={testId}
      initial={{ height: 0 }}
      animate={{ height: 'auto' }}
      exit={{ height: 0 }}
      transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
      style={{ overflow: 'hidden', overflowAnchor: 'none' }}
    >
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{
          opacity: { duration: reduceMotion ? 0 : 0.28, delay: reduceMotion ? 0 : 0.18 },
          y: { duration: reduceMotion ? 0 : 0.35, delay: reduceMotion ? 0 : 0.15 },
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
