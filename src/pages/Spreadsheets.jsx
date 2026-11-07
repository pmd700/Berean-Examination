import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { desktopClient } from '@/api/desktopClient';
import { parseIdFromParam, spreadsheetDeepLink } from '@/utils';
import { useTabTitle, useOptionalWorkspaceTabs, useOptionalCurrentWorkspaceTab, useIsActiveTab } from '@/lib/WorkspaceTabs';
import { registerPendingEditorSave } from '@/lib/pendingEditorSaves';
import { trackActivity } from '@/components/utils/activityTracker';
import SpreadsheetEditor from '@/components/spreadsheet/SpreadsheetEditor';
import { restoreWorkbookReferences } from '@/lib/spreadsheet/files';

export default function Spreadsheets() {
  const { slugId } = useParams();
  return <SpreadsheetWorkspace key={slugId} id={parseIdFromParam(slugId)} />;
}

function SpreadsheetWorkspace({ id }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = useOptionalCurrentWorkspaceTab();
  const isActive = useIsActiveTab();
  const titleForActivity = React.useRef('Spreadsheet');
  const workspace = useOptionalWorkspaceTabs();
  const initialView = React.useRef(String(tab?.spreadsheetView?.recordId) === String(id) ? tab.spreadsheetView : null);
  const updateTab = workspace?.updateTab;
  const rememberView = React.useCallback(view => {
    if (tab?.id && updateTab) {
      updateTab(tab.id, { spreadsheetView: { ...view, recordId: id } });
      if (isActive) trackActivity({ type:'spreadsheet',title:titleForActivity.current,deep_link:spreadsheetDeepLink(id,titleForActivity.current,{sheet:view.sheetId,cell:view.cell}),page:'Spreadsheets',icon:'spreadsheet' });
    }
  }, [tab?.id, updateTab, id, isActive]);
  const [record, setRecord] = React.useState(null);
  const [error, setError] = React.useState('');
  const [status, setStatus] = React.useState('saved');
  const pending = React.useRef(null);
  const saving = React.useRef(null);
  const timer = React.useRef(null);
  const mounted = React.useRef(true);
  const origin = React.useRef(crypto.randomUUID());
  const incoming = React.useRef({});
  titleForActivity.current = record?.title || 'Spreadsheet';
  useTabTitle(record?.title || 'Spreadsheet');
  const flush = React.useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    if (!pending.current) return false;
    const job = pending.current;
    pending.current = null;
    if (mounted.current) setStatus('saving');
    const promise = desktopClient.entities.Spreadsheet.update(job.id, job.patch);
    saving.current = promise;
    try {
      await promise;
      if (mounted.current) { setStatus(pending.current ? 'unsaved' : 'saved'); setError(''); }
      window.dispatchEvent(new CustomEvent('bex-spreadsheet-saved', { detail: { id: job.id } }));
      return true;
    } catch (e) {
      pending.current = { id: job.id, patch: { ...job.patch, ...pending.current?.patch } };
      if (mounted.current) { setStatus('error'); setError(e.message || 'Could not save spreadsheet. Your edits are still here; retry Save.'); }
      throw e;
    } finally { if (saving.current === promise) saving.current = null; }
  }, []);
  React.useEffect(() => registerPendingEditorSave(flush), [flush]);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); void flush().catch(() => {}); };
  }, [flush]);
  React.useEffect(() => {
    let canceled = false;
    setRecord(null); setError('');
    if (!id) { setError('Choose a spreadsheet from your library.'); return; }
    desktopClient.entities.Spreadsheet.get(id).then(async value => {
      if (!value) { if (!canceled) setError('This spreadsheet no longer exists.'); return; }
      const workbook = await restoreWorkbookReferences(value.workbook);
      if (!canceled) setRecord({ ...value, workbook, ...incoming.current });
    }).catch(e => { if (!canceled) setError(e.message || 'Could not open spreadsheet. Restart BEX after updating desktop services.'); });
    return () => { canceled = true; };
  }, [id]);
  React.useEffect(() => {
    const adopt = event => {
      const change = event.detail;
      if (change?.origin === origin.current || String(change?.id) !== String(id) || !change.patch) return;
      incoming.current = { ...incoming.current, ...change.patch };
      setRecord(current => current ? { ...current, ...change.patch } : current);
      // Any already queued write must carry the latest shared workbook, too.
      if (pending.current) pending.current.patch = { ...pending.current.patch, ...change.patch };
    };
    window.addEventListener('bex-spreadsheet-change', adopt);
    return () => window.removeEventListener('bex-spreadsheet-change', adopt);
  }, [id]);
  const change = React.useCallback(patch => {
    setRecord(current => ({ ...current, ...patch }));
    pending.current = { id, patch: { ...pending.current?.patch, ...patch } };
    setStatus('unsaved');
    window.dispatchEvent(new CustomEvent('bex-spreadsheet-change', { detail: { id, origin: origin.current, patch } }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, 650);
  }, [id, flush]);
  const query = new URLSearchParams(location.search);
  if (!record) return <div className="h-full grid place-items-center bg-[#0c111b] text-slate-300"><div className="text-center p-8"><p>{error || 'Opening spreadsheet…'}</p><button className="mt-4 text-emerald-300" onClick={() => navigate('/LibraryHome')}>Back to library</button></div></div>;
  return <SpreadsheetEditor key={id} record={record} onChange={change} onSave={flush} status={status} error={error} initialSheet={query.get('sheet')} initialCell={query.get('cell')} initialView={initialView.current} onViewChange={rememberView} />;
}
