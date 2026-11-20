import { useMediaSource } from '@/lib/mediaSource';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Expand } from 'lucide-react';
import { AttachmentRenderBoundary } from './AttachmentViewer';
import { getAttachmentPreviewKind } from './attachmentModel';
import useAttachmentPrivacy from './useAttachmentPrivacy';
import useAttachmentMediaRef from './useAttachmentMediaRef';

const PdfAttachmentDocument = lazy(() => import('./PdfAttachmentDocument'));

export default function AttachmentPreview({ attachment, onOpen }) {
  const mediaSource=useMediaSource(attachment?.url);
  const [failed, setFailed] = useState(false);
  const locked = useAttachmentPrivacy();
  const mediaRef = useAttachmentMediaRef();
  const kind = getAttachmentPreviewKind(attachment);
  const name = attachment?.name || 'Attachment';
  useEffect(() => setFailed(false), [attachment?.url]);
  if (!kind || locked) return null;
  const fallback = <span className="block px-3 py-5 text-xs text-slate-400">Preview unavailable. Open file.</span>;

  if (kind === 'audio') return (
    <div data-testid="attachment-preview" className="flex w-full max-w-md items-center gap-2 px-3 py-2">
      {failed ? <p role="status" className="flex-1 text-xs text-slate-400">Audio preview unavailable. Open file.</p> : (
        <audio ref={mediaRef} aria-label={`Audio preview: ${name}`} src={mediaSource} controls preload="metadata" className="min-w-0 flex-1" onError={() => setFailed(true)} />
      )}
      <button type="button" aria-label={`Open ${name}`} title="Open player" className="shrink-0 rounded p-2 text-slate-400 hover:bg-white/5 hover:text-slate-200" onClick={onOpen}><Expand size={16} aria-hidden="true" /></button>
    </div>
  );
  return (
    <button data-testid="attachment-preview" type="button" aria-label={`Open ${name}`} title={`Open ${name}`} onClick={onOpen} className="block max-w-sm overflow-hidden rounded-md bg-black/20 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
      {failed ? fallback : kind === 'pdf' ? (
        <AttachmentRenderBoundary key={attachment.url} fallback={fallback}>
          <Suspense fallback={<span className="block px-3 py-5 text-xs text-slate-400">Loading thumbnail…</span>}>
            <PdfAttachmentDocument attachment={attachment} thumbnail />
          </Suspense>
        </AttachmentRenderBoundary>
      ) : <video ref={mediaRef} aria-label={`Video preview: ${name}`} src={mediaSource} preload="metadata" muted playsInline className="max-h-52 w-full bg-black object-contain" onError={() => setFailed(true)} />}
    </button>
  );
}
