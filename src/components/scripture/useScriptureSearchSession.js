import { useCallback, useEffect, useRef, useState } from 'react';
import { parseScriptureQuery } from '@/lib/scriptureReferences';
import { fetchScriptureBatch, getScriptureCatalog } from '@/lib/scriptureClient';
import { convertApiBibleContentToBlocks } from '@/lib/apiBibleToStudyBlocks';
import { SCRIPTURE_SETUP_CHANGED_EVENT } from '@/lib/scriptureSetup';
import { getRemovedTranslationMessage, isTranslationRemovedFromPlan } from '@shared/removedTranslations';

export default function useScriptureSearchSession() {
  const [search, setSearch] = useState(null);
  const current = useRef(null);
  const sequence = useRef(0);
  const isCurrent = useCallback(id => current.current?.id === id, []);
  const publish = session => {
    if (current.current === session) setSearch({ ...session, results: [...session.results] });
  };
  const run = async (session, indexes) => {
    if (isTranslationRemovedFromPlan(session.abbreviation)) {
      session.loading = false;
      session.results = session.parsed.requests.map(req => ({ req, status: 'error', data: null,
        error: getRemovedTranslationMessage(session.abbreviation) }));
      session.revision += 1;
      publish(session);
      return;
    }
    const attempt = ++session.attempt;
    const controller = new AbortController();
    session.controller = controller;
    session.loading = true;
    session.slow = false;
    session.cancelled = false;
    for (const index of indexes) session.results[index] = { req: session.parsed.requests[index], status: 'pending', data: null };
    publish(session);
    const stillCurrent = () => current.current === session && session.attempt === attempt;
    const slowTimer = setTimeout(() => { if (stillCurrent()) { session.slow = true; publish(session); } }, 3000);
    try {
      const results = await fetchScriptureBatch(session.parsed.requests, {
        bibleId: session.bibleId, batchId: `${session.id}-${attempt}`, signal: controller.signal,
        initialResults: session.results, indexes,
        onProgress: progress => {
          if (!stillCurrent()) return;
          session.results = progress.results.map(result => {
            if (result.data && !convertApiBibleContentToBlocks(result.data).some(block => block.type === 'verse')) {
              return { ...result, data: null, status: 'error', error: 'No verse text was returned. Retry this passage.' };
            }
            return result;
          });
          session.revision += 1;
          publish(session);
        },
      });
      // Older test stubs may return only final results; production sends progress.
      if (stillCurrent() && !session.results.some(result => result.status === 'success' || result.status === 'error' || result.status === 'cancelled')) {
        session.results = results.map(result => ({ ...result, status: result.data ? 'success' : 'error' }));
      }
    } catch (error) {
      if (stillCurrent()) for (const index of indexes) if (!session.results[index].data) {
        session.results[index] = { req: session.parsed.requests[index], data: null, status: 'error', error: error.message };
      }
    } finally {
      clearTimeout(slowTimer);
      if (stillCurrent()) {
        session.loading = false;
        session.cancelled = controller.signal.aborted;
        session.revision += 1;
        publish(session);
      }
    }
  };
  const start = (query, bibleId, abbreviation) => {
    const parsed = parseScriptureQuery(query.trim());
    if (!parsed.isReference || !parsed.requests.length) throw new Error(`Could not parse scripture reference: "${query.trim()}"`);
    if (current.current?.loading && current.current.query === query.trim() && current.current.bibleId === bibleId
      && !current.current.controller.signal.aborted) return current.current;
    current.current?.controller?.abort();
    const session = { id: `reader-${crypto.randomUUID()}-${++sequence.current}`, query: query.trim(), parsed, bibleId,
      abbreviation: abbreviation || (bibleId === '317e03834065a236-01' ? 'BSB' : bibleId === 'de4e12af7f28f599-02' ? 'KJV' : 'API'),
      results: parsed.requests.map(req => ({ req, status: 'pending', data: null })), revision: 0, attempt: 0 };
    current.current = session;
    void run(session, parsed.requests.map((_, index) => index));
    if (!abbreviation) void getScriptureCatalog().then(catalog => {
      if (current.current !== session) return;
      session.abbreviation = catalog.data?.find(bible => bible.id === bibleId)?.abbreviation || session.abbreviation;
      session.revision += 1;
      publish(session);
    }).catch(() => {});
    return session;
  };
  const cancel = () => { current.current?.controller?.abort(); };
  const clear = useCallback(() => { current.current?.controller?.abort(); current.current = null; setSearch(null); }, []);
  const retry = index => {
    const session = current.current;
    if (!session || session.loading) return;
    const indexes = index == null
      ? session.results.flatMap((result, i) => result.status !== 'success' ? [i] : []) : [index];
    if (indexes.length) void run(session, indexes);
    else { session.revision += 1; publish(session); }
  };
  useEffect(() => {
    if (!search) return undefined;
    const ttl = 14 * 24 * 60 * 60 * 1000;
    const expiry = Math.min(...search.results.filter(result => result.data && result.fetchedAt).map(result => result.fetchedAt + ttl));
    if (!Number.isFinite(expiry)) return undefined;
    const timer = setTimeout(() => {
      const session = current.current;
      if (session?.id !== search.id) return;
      session.results = session.results.map(result => result.data && result.fetchedAt + ttl <= Date.now()
        ? { ...result, data: null, status: 'error', error: 'This cached passage expired. Reload it to continue.' } : result);
      session.revision += 1;
      publish(session);
    }, Math.max(0, expiry - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => () => { current.current?.controller?.abort(); current.current = null; }, []);
  useEffect(() => {
    const changed = () => {
      const session = current.current;
      if (!session) return;
      session.controller?.abort();
      session.attempt += 1;
      session.loading = false;
      session.slow = false;
      session.cancelled = false;
      session.results = session.results.map(result => ({ req: result.req, data: null, status: 'error',
        error: 'Scripture setup changed. Reload this passage to continue.' }));
      session.revision += 1;
      publish(session);
    };
    window.addEventListener(SCRIPTURE_SETUP_CHANGED_EVENT, changed);
    return () => window.removeEventListener(SCRIPTURE_SETUP_CHANGED_EVENT, changed);
  }, []);
  return { search, start, cancel, retry, clear, isCurrent };
}
