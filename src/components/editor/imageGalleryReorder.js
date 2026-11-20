import { closeHistory } from '@tiptap/pm/history';

export function moveGalleryImage(editor, pos, from, slot) {
  const gallery = editor.state.doc.nodeAt(pos);
  if (gallery?.type.name !== 'imageGallery' || from < 0 || from >= gallery.childCount || slot < 0 || slot > gallery.childCount) return false;
  const destination = slot > from ? slot - 1 : slot;
  if (destination === from) return false;
  const children = [];
  gallery.forEach(child => children.push(child));
  children.splice(destination, 0, children.splice(from, 1)[0]);
  editor.view.dispatch(closeHistory(editor.state.tr).replaceWith(pos, pos + gallery.nodeSize, gallery.type.create(gallery.attrs, children, gallery.marks)));
  editor.view.focus();
  return true;
}

export function bindGalleryReorder(host, strip, editor, getPos) {
  let cancel = null, suppressClick = false;
  const down = event => {
    suppressClick = false;
    if (event.button !== 0 || event.pointerType === 'touch' || !(event.target instanceof Element)) return;
    const img = event.target.closest('img');
    if (!img || !strip.contains(img)) return;
    const items = Array.from(strip.children).filter(child => child instanceof HTMLElement && child.querySelector('img'));
    const source = items.findIndex(child => child.contains(img));
    const pos = getPos();
    if (source < 0 || typeof pos !== 'number') return;
    const original = editor.state.doc.nodeAt(pos);
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX, startY = event.clientY;
    let dragging = false, slot = source, x = startX, y = startY, frame = null, ghost = null, marker = null;
    const update = () => {
      slot = items.findIndex(item => x < item.getBoundingClientRect().left + item.getBoundingClientRect().width / 2);
      if (slot < 0) slot = items.length;
      const box = (slot < items.length ? items[slot] : items[items.length - 1]).getBoundingClientRect();
      const edge = slot < items.length ? box.left : box.right;
      const bounds = host.getBoundingClientRect();
      marker.style.left = `${Math.max(0, Math.min(bounds.width - 3, edge - bounds.left - 4))}px`;
      ghost.style.left = `${x + 12}px`; ghost.style.top = `${y + 12}px`;
    };
    const scroll = () => {
      const bounds = strip.getBoundingClientRect();
      if (x < bounds.left + 40) strip.scrollLeft -= 12;
      else if (x > bounds.right - 40) strip.scrollLeft += 12;
      update(); frame = requestAnimationFrame(scroll);
    };
    const move = moveEvent => {
      x = moveEvent.clientX; y = moveEvent.clientY;
      if (!dragging && Math.hypot(x - startX, y - startY) < 7) return;
      if (!dragging) {
        dragging = true;
        ghost = img.cloneNode(true); ghost.className = 'bex-gallery-drag-preview';
        ghost.style.width = `${Math.min(150, img.getBoundingClientRect().width)}px`;
        document.body.append(ghost);
        marker = document.createElement('div'); marker.className = 'bex-gallery-drop-marker'; host.append(marker);
        items[source].classList.add('bex-gallery-drag-source');
        frame = requestAnimationFrame(scroll);
      }
      moveEvent.preventDefault(); moveEvent.stopPropagation(); update();
    };
    const finish = commit => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', abort, true); window.removeEventListener('keydown', key, true);
      if (frame !== null) cancelAnimationFrame(frame);
      ghost?.remove(); marker?.remove(); items[source].classList.remove('bex-gallery-drag-source'); cancel = null;
      if (dragging) {
        suppressClick = true;
        const currentPos = getPos();
        if (commit && typeof currentPos === 'number' && editor.state.doc.nodeAt(currentPos) === original) moveGalleryImage(editor, currentPos, source, slot);
      }
    };
    const up = () => finish(true);
    const abort = () => finish(false);
    const key = keyEvent => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); keyEvent.stopImmediatePropagation(); abort(); } };
    cancel = abort;
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', abort, true); window.addEventListener('keydown', key, true);
  };
  const click = event => { if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick = false; } };
  strip.addEventListener('pointerdown', down, true); strip.addEventListener('click', click, true);
  return () => { cancel?.(); strip.removeEventListener('pointerdown', down, true); strip.removeEventListener('click', click, true); };
}
