import React from 'react';
import { createPortal } from 'react-dom';
import { Images } from 'lucide-react';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import { selectedGalleryImages, groupSelectedImages } from './ImageGalleryExtension';
import ImageLightbox from './ImageLightbox';

export default function ImageGalleryTools({ editor }) {
  const active = useIsActiveTab();
  const [menu, setMenu] = React.useState(null);
  const [gallery, setGallery] = React.useState(null);
  React.useEffect(() => {
    if (!editor || !active) return undefined;
    const sync = () => {
      const images = selectedGalleryImages(editor);
      const element = images.length && editor.view.nodeDOM(images[0].pos);
      if (!(element instanceof HTMLElement)) { setMenu(null); return; }
      const rect = element.getBoundingClientRect();
      setMenu({ count: images.length, left: Math.max(8, Math.min(rect.left, window.innerWidth - 230)), top: Math.max(8, Math.min(rect.top - 44, window.innerHeight - 48)) });
    };
    const click = event => {
      const host = event.target.closest('[data-image-gallery]');
      if (!host || !event.target.closest('img, [data-gallery-count]')) return;
      event.preventDefault();
      const elements = [...host.querySelectorAll('img[src]')];
      setGallery({ images: elements.map(image => ({ src: image.getAttribute('src'), alt: image.alt })), index: Math.max(0, elements.indexOf(event.target.closest('img'))) });
    };
    editor.on('transaction', sync);
    editor.view.dom.addEventListener('click', click);
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    sync();
    return () => { editor.off('transaction', sync); editor.view.dom.removeEventListener('click', click); window.removeEventListener('scroll', sync, true); window.removeEventListener('resize', sync); };
  }, [editor, active]);
  if (!active) return null;
  return <>
    {menu && createPortal(<button type="button" data-testid="group-selected-images" data-bex-block-format-menu="true" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onClick={() => { groupSelectedImages(editor); setMenu(null); }} style={{ position: 'fixed', top: menu.top, left: menu.left, zIndex: 10020 }} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xl hover:bg-elevated"><Images size={16} />Group {menu.count} images</button>, document.body)}
    {gallery && <ImageLightbox images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
  </>;
}
