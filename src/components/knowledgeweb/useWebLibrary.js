import { useState, useEffect, useCallback } from 'react';
import { desktopClient } from '@/api/desktopClient';
import { usePrivateWeb } from '@/lib/PrivateWebContext';
import { encryptString } from '@/lib/webCrypto';
import { normalizeLibraryFolderCategory } from '@/lib/libraryFolderCategory';
import { toast } from 'sonner';

// ── useWebLibrary ────────────────────────────────────────────────────
// Owns the Webs / Folders / Notes *list* state plus every list-level CRUD
// operation the local Library Home needs (create / rename / delete / duplicate
// / lock webs, create private webs, folder grouping, drag reorder, note
// create). It is the canvas-free distillation of the same handlers that
// live in KnowledgeWeb.jsx, so the exact same sidebar can be reused inside
// Mind View without dragging the whole Knowledge Web canvas/crypto engine
// along with it.
//
// The host (Mind View) keeps its own force-graph as the visual source of
// truth. To keep the two views consistent, every mutation that changes the
// *set* of webs / notes calls back into the host so it can splice the
// matching node in or out of the graph:
//   onGraphAddWeb(web)            — a web was created / duplicated
//   onGraphAddNote(note)          — a note was created
//   onGraphRemove(type, id)       — a web / note was deleted
//   onGraphRename(type, id, title)— a web / note title changed
//
// Conversely, when the host creates/deletes an entity through its own
// toolbar, it calls the returned mirror* helpers so the sidebar list stays
// in sync without a full refetch.
export default function useWebLibrary({
  onGraphAddWeb,
  onGraphAddNote,
  onGraphRemove,
  onGraphRename,
} = {}) {
  const privateWeb = usePrivateWeb();

  const [webs, setWebs] = useState([]);
  const [folders, setFolders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Bumped on a failed reorder so the sidebar throws away its optimistic
  // local mirror and resyncs from these props (same contract as KW).
  const [reorderResetSignal, setReorderResetSignal] = useState(0);

  // Create-private modal lives here so the sidebar's "encrypted" create
  // path can open the exact same CryptoModal the Knowledge Web page uses.
  const [showCreatePrivateModal, setShowCreatePrivateModal] = useState(false);
  const [createPrivateBusy, setCreatePrivateBusy] = useState(false);
  const [createPrivateInitialName, setCreatePrivateInitialName] = useState('');

  // ── Initial load / explicit refresh ──
  // The replacement Library Home stays mounted in a background tab. Exposing
  // this same loader lets it refresh when brought forward after another tab
  // renamed or created something, without adding a second library data path.
  const refresh = useCallback(async () => {
    try {
      const [allWebs, allFolders, allNotes] = await Promise.all([
        desktopClient.entities.KnowledgeWeb.list('sort_order', 100).catch(() => []),
        desktopClient.entities.WebFolder.list('sort_order').catch(() => []),
        desktopClient.entities.MindNote.list('sort_order').catch(() => []),
      ]);
      setWebs(Array.isArray(allWebs) ? allWebs : []);
      setFolders(Array.isArray(allFolders) ? allFolders : []);
      setNotes(Array.isArray(allNotes) ? allNotes : []);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Mirror helpers (host → sidebar sync) ──
  const mirrorAddWeb = useCallback((web) => {
    if (!web || web.id == null) return;
    setWebs(prev => (prev.some(w => w.id === web.id) ? prev : [web, ...prev]));
  }, []);
  const mirrorAddNote = useCallback((note) => {
    if (!note || note.id == null) return;
    setNotes(prev => (prev.some(n => n.id === note.id) ? prev : [note, ...prev]));
  }, []);
  const mirrorRemove = useCallback((type, id) => {
    if (type === 'web') setWebs(prev => prev.filter(w => w.id !== id));
    else if (type === 'note') setNotes(prev => prev.filter(n => n.id !== id));
  }, []);
  const mirrorRename = useCallback((type, id, title) => {
    if (type === 'web') setWebs(prev => prev.map(w => w.id === id ? { ...w, title } : w));
    else if (type === 'note') setNotes(prev => prev.map(n => n.id === id ? { ...n, title } : n));
  }, []);

  // ── Web CRUD ──
  const createWeb = useCallback(async (title) => {
    const clean = (title || '').trim() || 'Untitled Web';
    const w = await desktopClient.entities.KnowledgeWeb.create({ title: clean });
    setWebs(prev => [w, ...prev]);
    onGraphAddWeb?.(w);
    return w;
  }, [onGraphAddWeb]);

  const renameWeb = useCallback(async (id, newTitle) => {
    const clean = (newTitle || '').trim();
    if (!clean) return;
    const target = webs.find(w => w.id === id);
    if (target?.is_private) {
      // Encrypt the new name with the web's key (must be unlocked) and
      // send only the ciphertext. Server keeps `title` as the placeholder.
      const key = privateWeb.getKey(id);
      if (!key) {
        throw new Error('Unlock this private Knowledge Web before renaming it.');
      }
      const enc_name = await encryptString(key, clean);
      await desktopClient.entities.KnowledgeWeb.update(id, { enc_name });
      setWebs(prev => prev.map(w => w.id === id ? { ...w, enc_name } : w));
      return;
    }
    await desktopClient.entities.KnowledgeWeb.update(id, { title: clean });
    setWebs(prev => prev.map(w => w.id === id ? { ...w, title: clean } : w));
    onGraphRename?.('web', id, clean);
  }, [webs, privateWeb, onGraphRename]);

  const duplicateWeb = useCallback(async (id) => {
    const original = webs.find(w => w.id === id);
    if (!original) return;
    const newWeb = await desktopClient.entities.KnowledgeWeb.create({
      title: `${original.title} (copy)`,
      graph_data: original.graph_data || '{}',
    });
    const [srcCards, srcConns, srcObjs] = await Promise.all([
      desktopClient.entities.WebCard.filter({ web_id: id }),
      desktopClient.entities.WebConnection.filter({ web_id: id }),
      desktopClient.entities.CanvasObject.filter({ web_id: id }),
    ]);
    await Promise.all([
      ...srcCards.map(c => desktopClient.entities.WebCard.create({ ...c, id: undefined, web_id: newWeb.id })),
      ...srcConns.map(c => desktopClient.entities.WebConnection.create({ ...c, id: undefined, web_id: newWeb.id })),
      ...srcObjs.map(o => desktopClient.entities.CanvasObject.create({ ...o, id: undefined, web_id: newWeb.id })),
    ]);
    setWebs(prev => [...prev, newWeb]);
    onGraphAddWeb?.(newWeb);
    return newWeb;
  }, [webs, onGraphAddWeb]);

  const deleteWeb = useCallback(async (id) => {
    await desktopClient.entities.KnowledgeWeb.delete(id);
    const [cs, conns, objs] = await Promise.all([
      desktopClient.entities.WebCard.filter({ web_id: id }).catch(() => []),
      desktopClient.entities.WebConnection.filter({ web_id: id }).catch(() => []),
      desktopClient.entities.CanvasObject.filter({ web_id: id }).catch(() => []),
    ]);
    await Promise.all([
      ...cs.map(c => desktopClient.entities.WebCard.delete(c.id)),
      ...conns.map(c => desktopClient.entities.WebConnection.delete(c.id)),
      ...objs.map(o => desktopClient.entities.CanvasObject.delete(o.id)),
    ]);
    setWebs(prev => prev.filter(w => w.id !== id));
    onGraphRemove?.('web', id);
  }, [onGraphRemove]);

  // Lock a private web — just drops the in-memory key. There is no active
  // canvas to purge in Mind View, so this is the whole operation.
  const lockWeb = useCallback((id) => {
    privateWeb.lock(id);
    toast.success('Web locked. Reopen it to view.');
  }, [privateWeb]);

  // ── Private web creation (reuses CreatePrivateWebModal) ──
  const openCreatePrivate = useCallback((initial) => {
    setCreatePrivateInitialName(initial || '');
    setShowCreatePrivateModal(true);
  }, []);

  const createPrivateWeb = useCallback(async (payload) => {
    setCreatePrivateBusy(true);
    try {
      const { is_private, enc_salt, enc_verifier, enc_name, cryptoKey } = payload;
      const w = await desktopClient.entities.KnowledgeWeb.create({
        is_private, enc_salt, enc_verifier, enc_name,
      });
      await privateWeb.registerNewWeb(w.id, cryptoKey);
      setWebs(prev => [w, ...prev]);
      onGraphAddWeb?.(w);
      setShowCreatePrivateModal(false);
      toast.success('Private web created. Only you can read its contents.');
      return w;
    } catch (err) {
      console.error('[useWebLibrary] createPrivateWeb failed', err);
      toast.error('Could not create private web: ' + (err?.message || 'unknown error'));
      throw err;
    } finally {
      setCreatePrivateBusy(false);
    }
  }, [privateWeb, onGraphAddWeb]);

  // ── Folder CRUD ──
  const createFolder = useCallback(async (name, category = 'web') => {
    const f = await desktopClient.entities.WebFolder.create({
      name: (name || '').trim() || 'Folder',
      category: normalizeLibraryFolderCategory(category),
    });
    setFolders(prev => [f, ...prev]);
    return f;
  }, []);

  const renameFolder = useCallback(async (id, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const f = await desktopClient.entities.WebFolder.update(id, { name: trimmed });
    setFolders(prev => prev.map(x => x.id === id ? { ...x, ...f } : x));
  }, []);

  const deleteFolder = useCallback(async (id) => {
    await desktopClient.entities.WebFolder.delete(id);
    setFolders(prev => prev.filter(f => f.id !== id));
    setWebs(prev => prev.map(w => w.folder_id === id ? { ...w, folder_id: null } : w));
    setNotes(prev => prev.map(n => n.folder_id === id ? { ...n, folder_id: null } : n));
  }, []);

  const moveWebToFolder = useCallback(async (webId, folderId) => {
    const updated = await desktopClient.entities.KnowledgeWeb.update(webId, {
      folder_id: folderId,
      sort_order: -Date.now(),
    });
    setWebs(prev => prev.map(w => w.id === webId ? { ...w, ...updated } : w));
  }, []);

  const reorderWebs = useCallback(async (folderId, orderedWebIds) => {
    try {
      const reordered = await desktopClient.entities.KnowledgeWeb.reorder(orderedWebIds, folderId);
      const recordsById = new Map(reordered.map(record => [record.id, record]));
      setWebs(prev => prev.map(w => recordsById.get(w.id) || w));
    } catch (err) {
      console.error('[useWebLibrary] reorderWebs rollback', err);
      toast.error('Could not save the new order: ' + (err?.message || 'unknown error'));
      try {
        const fresh = await desktopClient.entities.KnowledgeWeb.list('sort_order', 100);
        setWebs(Array.isArray(fresh) ? fresh : []);
      } catch (refetchErr) {
        console.error('[useWebLibrary] reorderWebs refetch failed', refetchErr);
      }
      setReorderResetSignal(s => s + 1);
    }
  }, []);

  const reorderFolders = useCallback(async (orderedFolderIds) => {
    try {
      const reordered = await desktopClient.entities.WebFolder.reorder(orderedFolderIds);
      const recordsById = new Map(reordered.map(record => [record.id, record]));
      setFolders(prev => prev.map(folder => recordsById.get(folder.id) || folder));
    } catch (err) {
      console.error('[useWebLibrary] reorderFolders rollback', err);
      toast.error('Could not save the new folder order: ' + (err?.message || 'unknown error'));
      try {
        const fresh = await desktopClient.entities.WebFolder.list('sort_order');
        setFolders(Array.isArray(fresh) ? fresh : []);
      } catch (refetchErr) {
        console.error('[useWebLibrary] reorderFolders refetch failed', refetchErr);
      }
      setReorderResetSignal(s => s + 1);
    }
  }, []);

  // ── Notes ──
  const createNote = useCallback(async () => {
    try {
      const created = await desktopClient.entities.MindNote.create({
        title: 'Untitled Note', content: '', tags: [],
      });
      setNotes(prev => [created, ...prev]);
      onGraphAddNote?.(created);
      return created;
    } catch {
      toast.error('Could not create note.');
    }
  }, [onGraphAddNote]);

  const renameNote = useCallback(async (noteId, title) => {
    const clean = String(title || '').trim();
    if (!clean) return null;
    const updated = await desktopClient.entities.MindNote.update(noteId, { title: clean });
    setNotes(prev => prev.map(note => note.id === noteId ? { ...note, ...updated } : note));
    onGraphRename?.('note', noteId, clean);
    return updated;
  }, [onGraphRename]);

  const moveNoteToFolder = useCallback(async (noteId, folderId) => {
    const updated = await desktopClient.entities.MindNote.update(noteId, {
      folder_id: folderId,
      sort_order: -Date.now(),
    });
    setNotes(prev => prev.map(note => note.id === noteId ? { ...note, ...updated } : note));
  }, []);

  const reorderNotes = useCallback(async (folderId, orderedNoteIds) => {
    try {
      const reordered = await desktopClient.entities.MindNote.reorder(orderedNoteIds, folderId);
      const recordsById = new Map(reordered.map(record => [record.id, record]));
      setNotes(prev => prev.map(note => recordsById.get(note.id) || note));
    } catch (err) {
      toast.error('Could not save note order: ' + (err?.message || 'unknown error'));
      const fresh = await desktopClient.entities.MindNote.list('sort_order').catch(() => []);
      setNotes(Array.isArray(fresh) ? fresh : []);
      setReorderResetSignal(signal => signal + 1);
    }
  }, []);

  const deleteNote = useCallback(async (noteId) => {
    await desktopClient.entities.MindNote.delete(noteId);
    setNotes(prev => prev.filter(note => note.id !== noteId));
    onGraphRemove?.('note', noteId);
  }, [onGraphRemove]);

  return {
    loaded,
    refresh,
    webs, folders, notes,
    reorderResetSignal,
    // web/folder/note handlers (sidebar)
    createWeb, renameWeb, duplicateWeb, deleteWeb, lockWeb,
    openCreatePrivate, createPrivateWeb,
    createFolder, renameFolder, deleteFolder, moveWebToFolder,
    reorderWebs, reorderFolders,
    createNote, renameNote, moveNoteToFolder, reorderNotes, deleteNote,
    // private-create modal state
    showCreatePrivateModal, createPrivateBusy, createPrivateInitialName,
    closeCreatePrivate: () => setShowCreatePrivateModal(false),
    // host → sidebar mirror helpers
    mirrorAddWeb, mirrorAddNote, mirrorRemove, mirrorRename,
  };
}
