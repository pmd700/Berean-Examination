import { exchangeReplica } from '../../../shared/sync/relay-client.js';
import { pushFileOperation } from '../../../shared/sync/files.js';

// Metadata/outbox work is independent of bulk file hydration. A note saved
// while an archive downloads can reach the other device immediately.
export class PhoneSyncSession {
  constructor(session, { flush = async()=>{}, changed = async()=>{}, status = ()=>{}, error = ()=>{}, download = async()=>{}, canSync = ()=>true } = {}) {
    Object.assign(this,{session,flush,changed,status,error,download,canSync});
    this.flight=null;this.hydration=null;this.again=false;this.closed=false;
  }
  async pendingCount() { return this.session.store.pendingCount ? this.session.store.pendingCount() : (await this.session.store.pending(1000000)).length; }
  sync() {
    if(this.closed)return Promise.resolve();
    if(this.flight){this.again=true;return this.flight;}
    const operation=(async()=>{
      await this.flush();
      if(this.closed)return;
      if(!this.canSync()){this.status(`Offline · ${await this.pendingCount()} changes saved locally`);return;}
      this.status('Syncing encrypted changes…');
      if(!this.session.identityChecked){
        const remote=await this.session.relay.request('/api/status'),local=this.session.identity;
        if(remote.vaultId!==local.vaultId||remote.epoch!==local.epoch||remote.deviceId!==local.deviceId||remote.slot!==local.slot)throw new Error('The paired device identity does not match this mailbox. Local work was preserved.');
        this.session.identityChecked=true;
      }
      const result=await exchangeReplica(this.session.replica,this.session.relay,{
        beforePush:row=>pushFileOperation(row,this.session.replica,this.session.blobs,this.session.relay),
        onProgress:progress=>{if(!this.closed)this.status(`Syncing encrypted records · ${progress.received} received${progress.sent?` · ${progress.sent} sent`:''}`);},
      });
      if(this.closed)return;
      await this.changed();
      this.session.lastExchange=new Date().toISOString();
      const pending=await this.pendingCount();
      this.status(pending?`${pending} changes queued`:'Up to date with your encrypted mailbox');this.error('');
      if(result.hasMore||pending)this.again=true;
      this.startDownloads();
      void this.session.publishReceipt?.().catch(()=>{});
      // Anonymous Scripture view reports have their own encrypted, durable queue.
      // Provider outages must never prevent library synchronization.
      void this.session.flushViews?.().catch(()=>{});
      return result;
    })().catch(reason=>{
      if(!this.closed){this.status('Changes saved locally · sync needs attention');this.error(reason.message);}
    }).finally(()=>{
      this.flight=null;
      if(this.again&&!this.closed&&this.canSync()){this.again=false;queueMicrotask(()=>{void this.sync();});}
    });
    this.flight=operation;return operation;
  }
  startDownloads() {
    if(this.hydration||this.closed||!this.canSync())return;
    this.hydration=Promise.resolve().then(()=>this.download()).catch(reason=>{if(!this.closed)this.error(reason.message);}).finally(()=>{this.hydration=null;});
  }
  close(){this.closed=true;}
}
