import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PhoneSyncSession } from './syncSession';
import { publishReceipt } from '../../../shared/sync/receipts';
import { exportPhoneRecovery } from './recovery';
import { clearPhoneBibles, downloadPhoneBibles } from './bible';
import { clearScripture, flushScriptureViews } from './scripture';
import { BrowserBlobStore } from './blob-store';
import { installMediaResolver, clearMedia, downloadVaultFiles } from './media';
import { importSyncKey, wrapDeviceSecrets, unwrapDeviceSecrets } from '../../../shared/sync/crypto';
import { consumeInvitation } from '../../../shared/sync/pairing';
import { SyncReplica } from '../../../shared/sync/replica';
import { RelayClient } from '../../../shared/sync/relay-client';
import { IndexedDbReplicaStore } from './replica-store';
import { enrollment } from './enrollment';
import { setMobileSession, getMobileSession, installPhoneBackends } from './mobileClient';
import { flushPendingEditorSaves } from '../../../src/lib/pendingEditorSaves';
import { publishNoteChange } from '../../../src/lib/noteChanges';
import { clearAllWebKeys, clearActiveEncryption } from '../../../src/lib/webCrypto';
import { queryClientInstance } from '../../../src/lib/query-client';
import { installAppTypography } from '../../../src/styles/typography';
import { Button } from '../../../src/components/ui/button';
import { Input } from '../../../src/components/ui/input';
import { Label } from '../../../src/components/ui/label';
import { Textarea } from '../../../src/components/ui/textarea';
import '@fontsource/rajdhani/400.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '../../../src/index.css';
import 'katex/dist/katex.min.css';
import '../../../src/components/logic/logic-renderer.css';
import './device.css';

// The phone mounts the actual BEX app. Only pairing/unlock and the encrypted
// storage adapter are device-specific; there are no duplicate feature screens.
const BexInterface=React.lazy(()=>import('../../../src/App').then(module=>({default:module.BexInterface})));
function App() {
  const [wrapped,setWrapped]=React.useState(undefined),[session,setSession]=React.useState(null);
  const [error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState('Saved on this device');
  const [code,setCode]=React.useState(''),[passphrase,setPassphrase]=React.useState('');
  const [update,setUpdate]=React.useState(null),[updating,setUpdating]=React.useState(false);
  const reloadForUpdate = React.useRef(false);
  React.useEffect(() => {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return undefined;
    const changed = () => { if (reloadForUpdate.current) location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    let registration, timer;
    const check = () => { if (navigator.onLine && document.visibilityState !== 'hidden') void registration?.update().catch(()=>{}); };
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(value => {
      registration = value;
      if (registration.waiting) setUpdate(registration);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdate(registration); });
      });
      check(); timer = setInterval(check, 60000);
    }).catch(() => setError('Offline installation could not finish. Keep BEX open online, then reopen it.'));
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); navigator.serviceWorker.removeEventListener('controllerchange', changed); };
  }, []);
  async function applyUpdate() {
    if (!update?.waiting) return;
    setUpdating(true);
    try { await flushPendingEditorSaves(); reloadForUpdate.current = true; update.waiting.postMessage('ACTIVATE_SAVED_UPDATE'); }
    catch (reason) { setUpdating(false); setError(reason.message); }
  }
  const updateNotice = update && <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 text-sm text-ink" role="status"><span>{updating ? 'Saving before updating…' : 'A BEX update is ready.'}</span><button disabled={updating} onClick={applyUpdate}>Save & update</button></div>;
  const load = React.useCallback(async current => { await flushPendingEditorSaves(); const state=await current.replica.records(); for(const row of state.records.filter(row=>row.record.kind==='MindNote')){if(row.status==='current')publishNoteChange({operation:'update',id:Number(row.record.id),record:row.versions[0].payload});else if(row.status==='deleted')publishNoteChange({operation:'delete',id:Number(row.record.id)});} }, []);
  const sync = React.useCallback(current => current?.coordinator.sync(), []);
  const [downloadStatus,setDownloadStatus]=React.useState('');
  React.useEffect(() => { enrollment().then(value=>setWrapped(value??null)).catch(reason => setError(reason.message)); }, []);
  React.useEffect(() => {
    if (!session) return undefined;
    const trigger = () => { if(document.visibilityState==='hidden'){void flushPendingEditorSaves().catch(reason=>setError(reason.message));return;}void sync(session); };
    const saveForSuspension=()=>{void flushPendingEditorSaves().catch(reason=>setError(reason.message));};
    const interval = setInterval(trigger, 15000);
    window.addEventListener('pagehide',saveForSuspension);window.addEventListener('online', trigger); window.addEventListener('offline', trigger); document.addEventListener('visibilitychange', trigger);
    void sync(session);
    return () => { clearInterval(interval);window.removeEventListener('pagehide',saveForSuspension); window.removeEventListener('online', trigger); window.removeEventListener('offline', trigger); document.removeEventListener('visibilitychange', trigger); };
  }, [session, sync]);
  async function unlock(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      let secrets;
      const submitted=new FormData(event.currentTarget),unlockPassphrase=String(submitted.get('passphrase')||passphrase),pairingCode=String(submitted.get('pairingCode')||code).trim();
      if (wrapped) secrets = await unwrapDeviceSecrets(unlockPassphrase, wrapped);
      else {
        if (unlockPassphrase.length < 12) throw new Error('Choose an unlock passphrase of at least 12 characters.');
        secrets = await consumeInvitation(pairingCode);
        const protectedSecrets = await wrapDeviceSecrets(unlockPassphrase, secrets); await enrollment(protectedSecrets); setWrapped(protectedSecrets);
        await navigator.storage?.persist?.();
      }
      const store = await IndexedDbReplicaStore.open(`bex-replica-${secrets.identity.vaultId}`, secrets.identity);
      const blobs = await BrowserBlobStore.open(secrets.identity.vaultId);
      const current = { ...secrets, blobs, webKeys: new Map(), store, replica: new SyncReplica(store, await importSyncKey(secrets.syncKey)), relay: new RelayClient(secrets.relay, secrets.token), changed: () => { void load(current); } };
      current.coordinator=new PhoneSyncSession(current,{flush:flushPendingEditorSaves,changed:()=>load(current),status:setStatus,error:setError,canSync:()=>!current.paused&&navigator.onLine&&document.visibilityState!=='hidden',download:async()=>{
        let wake;
        try{
          try{wake=await navigator.wakeLock?.request('screen');}catch{/* foreground operation still works without wake lock */}
          await downloadVaultFiles(current,progress=>setDownloadStatus(`Saving vault files offline · ${progress.completed}/${progress.total}${progress.chunks?.total?` · chunk ${progress.chunks.completed}/${progress.chunks.total}`:''}`));
          if(!current.biblesReady){await downloadPhoneBibles(progress=>setDownloadStatus(`Saving Bibles offline · ${progress.completed}/${progress.total}`));current.biblesReady=true;}
          if(current.replica.key){setDownloadStatus('Vault files & Bibles saved offline');await publishReceipt(current);}
        }finally{await wake?.release();}
      }});
      current.changed=()=>{void load(current);void current.coordinator.sync();};
      current.flushViews=()=>flushScriptureViews(current);
      current.publishReceipt=()=>publishReceipt(current);
      setMobileSession(current); installPhoneBackends(current); installMediaResolver(current); await load(current); setSession(current); setPassphrase(''); setCode('');
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  async function lock() {
    try { await flushPendingEditorSaves(); session.coordinator.close(); session.replica.lock(); clearMedia(); clearPhoneBibles(); clearScripture(); clearAllWebKeys(); clearActiveEncryption(); session.webKeys.clear(); queryClientInstance.clear(); session.blobs.close(); session.store.close(); setMobileSession(null); setSession(null);setDownloadStatus(''); }
    catch (reason) { setError(reason.message); }
  }
  Object.defineProperty(window,'bexPhoneSync',{configurable:true,value:{
    isPhone:true,
    syncStatus:async()=>({ok:true,value:{enabled:true,paused:Boolean(session?.paused),deviceId:session?.identity.deviceId,pending:session?await session.store.pendingCount():0,lastExchange:session?.lastExchange,lastError:error,status,downloadStatus}}),
    syncNow:async()=>{await session?.coordinator.sync();return {ok:true,value:{}};},
    syncPause:async paused=>{session.paused=Boolean(paused);if(!paused)void session.coordinator.sync();return {ok:true,value:{}};},
    syncConflicts:async()=>({ok:true,value:(await session.replica.records()).records.filter(row=>row.status==='conflict')}),
    syncDevices:async()=>({ok:true,value:[]}),
    syncResolve:async({record,versionId,parents})=>{const state=await session.replica.record(record),version=state.versions.find(op=>op.id===versionId);await session.replica.change(record,version.payload,{action:version.action,resolveParents:parents});session.changed();return {ok:true,value:{}};},
    syncLock:lock,
    syncExport:async()=>{await flushPendingEditorSaves();await exportPhoneRecovery(getMobileSession());},
  }});
  if(session)return <div className="bex-iphone">{updateNotice}{error&&<p role="alert" className="border-b border-line bg-surface px-4 py-2 text-sm text-rose-400">{error}</p>}<Suspense fallback={<p role="status" className="p-6 text-ink-muted">Opening BEX…</p>}><BexInterface persistWorkspace={false} initialPath={location.pathname==='/'?'/LibraryHome':`${location.pathname}${location.search}`}/></Suspense></div>;
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12 text-ink" data-testid="phone-unlock">{updateNotice}<h1 className="text-2xl font-semibold">{wrapped?'Unlock BEX':'Pair BEX with your Mac'}</h1><form onSubmit={unlock} className="grid gap-5">
    {!wrapped&&<div className="grid gap-2"><Label htmlFor="pair-code">Pairing code from your Mac</Label><Textarea id="pair-code" name="pairingCode" value={code} onChange={event=>setCode(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} required/></div>}
    <div className="grid gap-2"><Label htmlFor="unlock-passphrase">{wrapped?'Unlock passphrase':'Choose an unlock passphrase'}</Label><Input id="unlock-passphrase" name="passphrase" type="password" autoComplete={wrapped?'current-password':'new-password'} minLength={12} value={passphrase} onChange={event=>setPassphrase(event.target.value)} required/></div>
    <Button disabled={busy||wrapped===undefined}>{busy?'Opening BEX…':wrapped?'Unlock BEX':'Pair this iPhone'}</Button>
  </form>{error&&<p role="alert" className="text-sm text-rose-400">{error}</p>}</main>;
}
void installAppTypography().then(()=>createRoot(document.getElementById('root')).render(<App/>));
