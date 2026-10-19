import { Component, lazy, Suspense, useEffect, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { Content as DialogContent, Close as DialogClose } from '@radix-ui/react-dialog';
import { Dialog, DialogPortal, DialogOverlay, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getAttachmentPreviewKind, isVaultAttachmentUrl, openAttachmentExternally } from './attachmentModel';
import useAttachmentPrivacy from './useAttachmentPrivacy';
import useAttachmentMediaRef from './useAttachmentMediaRef';

// Shared wrappers omit their prop types; keep this boundary narrowly typed.
const AttachmentDialogOverlay = /** @type {import('react').ComponentType<import('@radix-ui/react-dialog').DialogOverlayProps>} */ (DialogOverlay);
const AttachmentDialogTitle = /** @type {import('react').ComponentType<import('@radix-ui/react-dialog').DialogTitleProps>} */ (DialogTitle);
const AttachmentDialogDescription = /** @type {import('react').ComponentType<import('@radix-ui/react-dialog').DialogDescriptionProps>} */ (DialogDescription);
const AttachmentButton = /** @type {import('react').ComponentType<import('react').ButtonHTMLAttributes<HTMLButtonElement> & {variant?: string, size?: string}>} */ (Button);

const PdfAttachmentDocument = lazy(() => import('./PdfAttachmentDocument'));

export class AttachmentRenderBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function AttachmentViewer({ attachment, onClose }) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const [externalError, setExternalError] = useState('');
  const [openingExternal, setOpeningExternal] = useState(false);
  const locked = useAttachmentPrivacy(onClose);
  const mediaRef = useAttachmentMediaRef();
  const kind = getAttachmentPreviewKind(attachment);
  const valid = isVaultAttachmentUrl(attachment?.url);
  const name = attachment?.name || 'Attachment';
  useEffect(() => { setMediaFailed(false); setExternalError(''); }, [attachment?.url]);

  const openExternal = async () => {
    setOpeningExternal(true);
    setExternalError('');
    try { await openAttachmentExternally(attachment.url); }
    catch (error) { setExternalError(error.message); }
    finally { setOpeningExternal(false); }
  };

  if (!attachment || locked) return null;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose?.(); }}>
      <DialogPortal>
      <AttachmentDialogOverlay className="z-[100010]" />
      <DialogContent data-testid="attachment-viewer" className="fixed left-1/2 top-1/2 z-[100011] flex h-[86vh] max-h-[960px] w-[94vw] max-w-[1200px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-xl border border-white/10 bg-[#111620] p-4 text-slate-100 shadow-2xl sm:p-5">
        <div className="flex shrink-0 flex-wrap items-center gap-3 pr-8">
          <AttachmentDialogTitle className="min-w-0 flex-1 truncate text-base" title={name}>{name}</AttachmentDialogTitle>
          <AttachmentButton type="button" variant="ghost" size="sm" disabled={!valid || openingExternal} onClick={openExternal}>
            <ExternalLink aria-hidden="true" /> Open in default app
          </AttachmentButton>
        </div>
        <AttachmentDialogDescription className="sr-only">View this file from your BEX vault. You can also open it in its default app.</AttachmentDialogDescription>
        {externalError && <p role="alert" className="text-sm text-red-300">{externalError}</p>}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-black/20">
          {!valid ? <ViewerFailure>This attachment has an invalid vault reference.</ViewerFailure> : mediaFailed ? (
            <ViewerFailure>BEX could not play this file. Use Open in default app.</ViewerFailure>
          ) : kind === 'pdf' ? (
            <AttachmentRenderBoundary key={attachment.url} fallback={<ViewerFailure>BEX could not load this PDF. Use Open in default app.</ViewerFailure>}>
              <Suspense fallback={<ViewerLoading>Loading PDF…</ViewerLoading>}>
                <PdfAttachmentDocument attachment={attachment} />
              </Suspense>
            </AttachmentRenderBoundary>
          ) : kind === 'audio' ? (
            <div className="flex flex-1 items-center justify-center px-5">
              <audio ref={mediaRef} data-testid="attachment-audio" aria-label={`Audio player: ${name}`} src={attachment.url} controls preload="metadata" className="w-full max-w-2xl" onError={() => setMediaFailed(true)} />
            </div>
          ) : kind === 'video' ? (
            <video ref={mediaRef} data-testid="attachment-video" aria-label={`Video player: ${name}`} src={attachment.url} controls playsInline preload="metadata" className="min-h-0 w-full flex-1 bg-black object-contain" onError={() => setMediaFailed(true)} />
          ) : <ViewerFailure>Use Open in default app to view this file.</ViewerFailure>}
        </div>
        <DialogClose aria-label="Close file viewer" className="absolute right-4 top-4 rounded p-1 text-slate-400 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"><X size={16} aria-hidden="true" /></DialogClose>
      </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function ViewerFailure({ children }) {
  return <p role="alert" className="m-auto px-5 py-6 text-center text-sm text-slate-300">{children}</p>;
}

export function ViewerLoading({ children }) {
  return <p role="status" className="m-auto px-5 py-6 text-center text-sm text-slate-400">{children}</p>;
}
