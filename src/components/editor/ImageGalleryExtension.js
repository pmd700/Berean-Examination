import { Node } from '@tiptap/core';
import { selectedDraggableBlocks } from './blockDragModel';
import { blockDragPluginKey } from './BlockDragExtension';
import './imageGallery.css';
import { bindImageSwipe } from './imageSwipe';
import { bindGalleryReorder } from './imageGalleryReorder';
import { observeGalleryLayout } from './imageGalleryLayout';

export function selectedGalleryImages(editor) {
  const selection = blockDragPluginKey.getState(editor.state);
  if (!selection || selection.previewing) return [];
  const images = selectedDraggableBlocks(editor.state.doc, selection.selected)
    .filter(({ node }) => node.type.name === 'imageUpload');
  if (images.length < 2 || images.some(({ node, containerPos }) => !node.attrs.src || node.attrs.uploading || node.attrs.error || containerPos !== images[0].containerPos)) return [];
  return images;
}

export function groupSelectedImages(editor) {
  const images = selectedGalleryImages(editor);
  if (!images.length) return false;
  const gallery = editor.schema.nodes.imageGallery.create(null, images.map(({ node }) => node));
  const tr = editor.state.tr;
  for (const image of [...images].reverse()) tr.delete(image.pos, image.end);
  tr.insert(images[0].pos, gallery);
  tr.setMeta(blockDragPluginKey, { type: 'selection', selected: [], anchor: null });
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

export const ImageGallery = Node.create({
  name: 'imageGallery',
  group: 'block',
  content: 'imageUpload{2,}',
  isolating: true,
  parseHTML() { return [{ tag: 'div[data-image-gallery]' }]; },
  renderHTML({ node }) { return ['div', { 'data-image-gallery': '', class: 'bex-image-gallery' }, ['div', { class: 'bex-image-gallery__images', style: `--gallery-columns: ${Math.min(3, node.childCount)}` }, 0]]; },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'bex-image-gallery';
      dom.dataset.imageGallery = '';
      const contentDOM = document.createElement('div');
      contentDOM.className = 'bex-image-gallery__images';
      const disposeSwipe = bindImageSwipe(contentDOM);
      const disposeLayout = observeGalleryLayout(dom, contentDOM);
      const disposeReorder = bindGalleryReorder(dom, contentDOM, editor, getPos);
      const count = document.createElement('button');
      count.type = 'button';
      count.contentEditable = 'false';
      count.className = 'bex-image-gallery__count';
      count.dataset.galleryCount = '';
      const updateCount = () => { contentDOM.style.setProperty('--gallery-columns', String(Math.min(3, node.childCount))); count.textContent = `▧ ${node.childCount}`; count.setAttribute('aria-label', `View all ${node.childCount} images`); };
      updateCount();
      const ungroup = document.createElement('button');
      ungroup.type = 'button';
      ungroup.contentEditable = 'false';
      ungroup.className = 'bex-image-gallery__ungroup';
      ungroup.textContent = 'Ungroup images';
      ungroup.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const current = editor.state.doc.nodeAt(pos);
        if (current?.type.name === 'imageGallery') { editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + current.nodeSize, current.content).scrollIntoView()); editor.view.focus(); }
      });
      dom.append(contentDOM, count, ungroup);
      return { dom, contentDOM, destroy() { disposeSwipe(); disposeLayout(); disposeReorder(); }, update(next) { if (next.type !== node.type) return false; node = next; updateCount(); return true; },
        stopEvent: event => event.target instanceof HTMLElement && (count.contains(event.target) || ungroup.contains(event.target)),
        ignoreMutation: mutation => mutation.target instanceof HTMLElement && !!mutation.target.closest('.bex-gallery-drop-marker') || mutation.type === 'childList' && mutation.target === dom || mutation.type === 'attributes' && (mutation.target === dom || mutation.target === contentDOM) || count.contains(mutation.target) || ungroup.contains(mutation.target),
      };
    };
  },
});
