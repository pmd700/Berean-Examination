import React, { createContext, useContext, useMemo } from 'react';

// Registry that assigns a stable, sequential number to each unique citation
// reference id, in document (reading) order. Created fresh per rendered
// document so numbering restarts at [1] for every message.
function createRegistry(sourcesById) {
  const map = new Map();
  let counter = 0;
  return {
    sourcesById: sourcesById || {},
    getNumber(refId) {
      if (!map.has(refId)) {
        counter += 1;
        map.set(refId, counter);
      }
      return map.get(refId);
    },
  };
}

const CitationContext = createContext(null);

export function CitationProvider({ sourcesById, children }) {
  // Re-create the registry only when the source metadata identity changes.
  const registry = useMemo(() => createRegistry(sourcesById), [sourcesById]);
  return <CitationContext.Provider value={registry}>{children}</CitationContext.Provider>;
}

export function useCitations() {
  return useContext(CitationContext);
}

export default CitationContext;
