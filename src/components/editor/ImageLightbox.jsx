import { useMediaSource } from '@/lib/mediaSource';
import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { bindImageSwipe } from './imageSwipe';
import { X, ChevronLeft, ChevronRight, Images } from 'lucide-react';

export default function ImageLightbox({ src = null, alt = '', images = null, initialIndex = 0, onClose }) {
  const items = images?.length ? images : src ? [{ src, alt }] : [];
  const [index, setIndex] = React.useState(() => Math.max(0, Math.min(initialIndex, items.length - 1)));
  const [zoom, setZoom] = React.useState('fit');
  const [naturalWidth, setNaturalWidth] = React.useState(0);
  const current = items[index];
  const resolvedSource = useMediaSource(current?.src);
  const move = delta => { setIndex(value => Math.max(0, Math.min(items.length - 1, value + delta))); setZoom('fit'); };
  const swipeRef = React.useRef({ move, enabled: false });
  swipeRef.current = { move, enabled: items.length > 1 && zoom === 'fit' };
  const swipeDispose = React.useRef(null);
  const attachSurface = React.useCallback(element => {
    swipeDispose.current?.();
    swipeDispose.current = element ? bindImageSwipe(element, { step: delta => swipeRef.current.move(delta), canSwipe: () => swipeRef.current.enabled }) : null;
  }, []);
  if (!current) return null;
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100100] bg-black/95 backdrop-blur-xl" />
      <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-[100101] flex flex-col text-white outline-none" onKeyDown={event => {
        if (event.target instanceof HTMLElement && event.target.tagName === 'SELECT') return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1); }
      }}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <Dialog.Title className="flex min-w-0 items-center gap-2 text-sm"><Images size={18} /><span className="truncate">{current.alt || 'Image'}</span></Dialog.Title>
          <div className="flex items-center gap-4">
            <select aria-label="Image zoom" value={zoom} onChange={event => setZoom(event.target.value)} className="rounded-md border border-white/20 bg-[#171a21] px-2 py-1 text-sm">
              <option value="fit">Fit</option><option value="100">100%</option><option value="150">150%</option><option value="200">200%</option>
            </select>
            <Dialog.Close aria-label="Close image viewer" className="rounded-full p-2 hover:bg-white/10"><X size={22} /></Dialog.Close>
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1">
          {items.length > 1 && <button type="button" aria-label="Previous image" disabled={index === 0} onClick={() => move(-1)} className="absolute left-3 top-1/2 z-10 rounded-full border border-white/10 bg-[#171a21]/90 p-3 hover:bg-white/20 disabled:opacity-25"><ChevronLeft /></button>}
          <div ref={attachSurface} className="flex w-full overflow-auto p-14" style={{ touchAction: zoom === 'fit' ? 'pan-y' : 'auto' }} data-testid="image-viewer-surface">
            <img draggable={false} key={current.src + index} src={resolvedSource} alt={current.alt || 'Image'} onLoad={event => setNaturalWidth(event.currentTarget.naturalWidth)} style={zoom === 'fit' ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', margin: 'auto' } : { width: naturalWidth ? naturalWidth * Number(zoom) / 100 : undefined, maxWidth: 'none', height: 'auto', alignSelf: 'flex-start', margin: 'auto', flexShrink: 0 }} />
          </div>
          {items.length > 1 && <button type="button" aria-label="Next image" disabled={index === items.length - 1} onClick={() => move(1)} className="absolute right-3 top-1/2 z-10 rounded-full border border-white/10 bg-[#171a21]/90 p-3 hover:bg-white/20 disabled:opacity-25"><ChevronRight /></button>}
        </div>
        <footer className="flex shrink-0 flex-col items-center gap-3 border-t border-white/10 px-4 py-3">
          <span role="status" aria-live="polite" className="text-sm text-white/70">{index + 1} of {items.length}</span>
          {items.length > 1 && <div className="flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Gallery thumbnails">
            {items.map((image, i) => <button type="button" key={i} aria-label={`View image ${i + 1}`} aria-current={index === i ? 'true' : undefined} onClick={() => { setIndex(i); setZoom('fit'); }} className={`h-12 w-16 shrink-0 overflow-hidden rounded-md border-2 ${index === i ? 'border-white' : 'border-transparent opacity-50 hover:opacity-100'}`}><GalleryThumbnail source={image.src} alt="" className="h-full w-full object-cover" /></button>)}
          </div>}
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function GalleryThumbnail({ source, ...props }) { const src = useMediaSource(source); return <img {...props} src={src} />; }
