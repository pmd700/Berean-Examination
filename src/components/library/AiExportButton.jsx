import React from 'react';
import { Download, FileText, Loader2, LockKeyhole, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent as SharedDialogContent, DialogDescription as SharedDialogDescription, DialogHeader, DialogTitle as SharedDialogTitle } from '@/components/ui/dialog';
import { usePrivateWeb } from '@/lib/PrivateWebContext';
import { aiExportCounts, prepareAiLibraryExport, readAiLibrarySnapshot } from '@/lib/aiLibraryExport';
import { saveExportFile } from '@/lib/saveExportFile';

// The shared JS wrappers support Radix props; state those types for checkJs.
const DialogContent = /** @type {typeof import('@radix-ui/react-dialog').Content} */ (/** @type {unknown} */ (SharedDialogContent));
const DialogDescription = /** @type {typeof import('@radix-ui/react-dialog').Description} */ (/** @type {unknown} */ (SharedDialogDescription));
const DialogTitle = /** @type {typeof import('@radix-ui/react-dialog').Title} */ (/** @type {unknown} */ (SharedDialogTitle));

const labels = { spreadsheets: 'Spreadsheets', notes: 'Notes', pages: 'Book pages', webs: 'Knowledge webs', cards: 'Web cards', timelines: 'Timelines', events: 'Timeline events', commentaries: 'Commentaries', keywords: 'Keywords' };

export default function AiExportButton() {
  const privateWeb = usePrivateWeb();
  const privateRef = React.useRef(privateWeb);
  privateRef.current = privateWeb;
  const unlockedKeys = React.useRef(new Map());
  const controller = React.useRef(null);
  const request = React.useRef(0);
  const running = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState(null);
  const [locked, setLocked] = React.useState([]);
  const [passwords, setPasswords] = React.useState({});
  const [unlocking, setUnlocking] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState(null);
  const getKey = id => unlockedKeys.current.get(String(id)) || privateRef.current.getKey(id);
  React.useEffect(() => () => { request.current += 1; controller.current?.abort(); }, []);

  const inspect = async () => {
    const id = ++request.current;
    setOpen(true); setSnapshot(null); setResult(null); setError(''); setProgress('Reading your library');
    try {
      const current = await readAiLibrarySnapshot();
      if (request.current !== id) return;
      setSnapshot(current);
      setLocked(current.webs.filter(web => web.is_private && !getKey(web.id)));
      setProgress('');
    } catch (failure) { if (request.current === id) { setError(failure.message); setProgress(''); } }
  };
  const unlock = async web => {
    setUnlocking(web.id); setError('');
    try {
      const key = await privateRef.current.unlock(web, passwords[web.id] || '');
      unlockedKeys.current.set(String(web.id), key);
      setLocked(current => current.filter(row => row.id !== web.id));
      setPasswords(current => ({ ...current, [web.id]: '' }));
    } catch { setError('That private web could not be unlocked. Check its passphrase and try again.'); }
    finally { setUnlocking(null); }
  };
  const start = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(''); setResult(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const built = await prepareAiLibraryExport({ getKey, onProgress: setProgress, signal: abort.signal });
      if (!built.sourceCount) throw new Error('Your library has no ideas to export yet.');
      if (abort.signal.aborted) return;
      setProgress('Choose where to save your Markdown file');
      const saved = await saveExportFile(new Blob([built.text], { type: 'text/markdown;charset=utf-8' }), built.fileName);
      setResult({ ...built, ...saved, text: undefined });
      setProgress('');
    } catch (failure) {
      if (failure.name === 'AbortError') setProgress('Export canceled.');
      else { setError(failure.message || 'BEX could not export your ideas.'); setProgress(''); }
      if (failure.lockedWebs) setLocked(failure.lockedWebs);
    } finally { running.current = false; setBusy(false); controller.current = null; }
  };
  const counts = result?.counts || (snapshot ? aiExportCounts(snapshot) : null);
  const close = value => {
    if (busy || unlocking != null) return;
    setOpen(value);
    if (!value) { request.current += 1; setSnapshot(null); setPasswords({}); unlockedKeys.current.clear(); }
  };
  return <>
    <button type="button" onClick={() => void inspect()} className="group inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-emerald-300/10 bg-emerald-400/[0.04] px-2.5 text-[10.5px] font-semibold text-emerald-100/75 transition hover:border-emerald-300/20 hover:bg-emerald-400/[0.08] hover:text-emerald-100" title="Export all your ideas in one AI-readable Markdown file" data-testid="library-ai-export-button">
      <FileText className="h-3.5 w-3.5" /><span>AI Export</span>
    </button>
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto border-white/10 bg-[#11151f] text-slate-100" data-testid="ai-export-dialog">
        <DialogHeader className=""><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-emerald-300" />Export your ideas for AI</DialogTitle><DialogDescription className="text-slate-400">One Markdown file containing your full writing, spreadsheets, chronological timelines, knowledge-web connections, and Bible commentaries with their original IDs and editions.</DialogDescription></DialogHeader>
        {counts && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="ai-export-counts">{Object.entries(labels).map(([key, label]) => <div key={key} className="rounded-lg border border-white/5 bg-white/[0.025] p-3"><div className="text-lg font-semibold text-emerald-200">{counts[key]}</div><div className="text-[11px] text-slate-400">{label}</div></div>)}</div>}
        <p className="text-xs leading-relaxed text-slate-400">All book pages and collapsed text are included. Images, drawings, and attached files retain their references and captions; their visual or binary contents aren’t transcribed. You can upload the saved file to an AI of your choice.</p>
        {locked.length > 0 && <div className="space-y-3 rounded-lg border border-purple-300/15 bg-purple-400/5 p-3"><p className="text-sm text-purple-200"><LockKeyhole className="inline h-4 w-4 mr-1" />Unlock private webs to include everything.</p>{locked.map(web => <form key={web.id} className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void unlock(web); }}><label className="w-full text-xs text-slate-400" htmlFor={`ai-unlock-${web.id}`}>Private web {web.id}</label><input id={`ai-unlock-${web.id}`} type="password" autoComplete="off" placeholder="Passphrase" value={passwords[web.id] || ''} onChange={event => setPasswords(current => ({ ...current, [web.id]: event.target.value }))} className="min-w-0 flex-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-sm" disabled={unlocking != null || busy} /><button type="submit" disabled={unlocking != null || busy || !passwords[web.id]} className="rounded border border-purple-300/20 px-3 py-1 text-sm disabled:opacity-40">{unlocking === web.id ? 'Unlocking…' : 'Unlock'}</button></form>)}</div>}
        {progress && <p role="status" className="flex items-center gap-2 text-sm text-slate-300">{progress !== 'Export canceled.' && <Loader2 className="h-4 w-4 animate-spin" />}{progress}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
        {result && <div role="status" className="rounded-lg border border-emerald-300/10 bg-emerald-400/5 p-3 text-sm">{result.status === 'canceled' ? 'Save canceled. No file was written.' : <><p className="flex items-center gap-2 text-emerald-200"><CheckCircle2 className="h-4 w-4" />{result.status === 'saved' ? 'Your AI export is saved.' : 'Your download has started.'}</p><p className="mt-1 break-all text-xs text-slate-400">{result.fileName} · {(result.byteLength / 1024).toFixed(1)} KB · {result.sourceCount} sources</p>{result.warningCount > 0 && <p className="mt-2 text-xs text-amber-200">{result.warningCount} reference or date notes are listed under Reading limits.</p>}</>}</div>}
        <div className="flex justify-end gap-2 border-t border-white/5 pt-3">
          <button type="button" onClick={() => busy ? controller.current?.abort() : close(false)} className="rounded-lg border border-white/10 px-3 py-2 text-sm" disabled={unlocking != null}>{busy ? 'Cancel export' : 'Close'}</button>
          {!snapshot && !progress && <button type="button" onClick={() => void inspect()} className="rounded-lg border border-white/10 px-3 py-2 text-sm">Retry</button>}
          <button type="button" onClick={() => void start()} disabled={!snapshot || busy || locked.length > 0 || unlocking != null} className="inline-flex items-center gap-2 rounded-lg bg-emerald-400/15 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-400/25 disabled:opacity-40" data-testid="ai-export-save"><Download className="h-4 w-4" />{busy ? 'Exporting…' : 'Export .md'}</button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
