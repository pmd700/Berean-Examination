const listeners = new Set();
let revision = 0;

/** Notify mounted views of committed changes; no second copy of note data is stored. */
export function publishNoteChange(change) {
  revision += 1;
  for (const listener of listeners) {
    try { listener(change); } catch (error) { console.error('Could not update a note view:', error); }
  }
}

export function subscribeToNoteChanges(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function applyNoteChange(notes, { operation, id, record }) {
  if (operation === 'delete') return notes.filter(note => note.id !== id);
  if (!record) return notes;
  if (!notes.some(note => note.id === record.id)) return notes;
  return notes.map(note => note.id === record.id ? record : note);
}

/** A slow list read must not replace a just-committed edit with an old row. */
export async function readCurrentNoteList(load) {
  let observed;
  let notes;
  do {
    observed = revision;
    notes = await load();
  } while (observed !== revision);
  return notes;
}
