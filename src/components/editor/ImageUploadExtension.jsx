import { resolveMediaSource, initialMediaSource } from '@/lib/mediaSource';
import { Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { toast } from 'sonner';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const MIN_IMAGE_WIDTH = 80;

/**
 * Size an image to an explicit width, or hand it back to the stylesheet.
 *
 * The default rule caps images at 320px wide and 240px tall, so an explicit
 * width has to lift both caps — otherwise dragging past 320px would do
 * nothing. `max-width: 100%` still keeps it inside the column.
 */
function applyImageWidth(img, width) {
  if (width) {
    img.style.width = `${width}px`;
    img.style.height = 'auto';
    img.style.maxWidth = '100%';
    img.style.maxHeight = 'none';
  } else {
    img.style.removeProperty('width');
    img.style.removeProperty('height');
    img.style.removeProperty('max-width');
    img.style.removeProperty('max-height');
  }
}

function toDimension(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** How wide an image is allowed to get: the editor's text column. */
function availableWidth(editor) {
  const dom = editor?.view?.dom;
  if (!dom) return Number.MAX_SAFE_INTEGER;
  const style = window.getComputedStyle(dom);
  const inner = dom.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
  return Math.max(MIN_IMAGE_WIDTH, Math.round(inner));
}

/** Send a file to local Media, returning its URL (or null, having told the user why). */
async function uploadImageFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    toast.error('Image too large. Max size is 10MB.');
    return null;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    toast.error('Invalid file type. Only PNG, JPG, GIF, and WebP are supported.');
    return null;
  }
  try {
    const { desktopClient } = await import('@/api/desktopClient');
    const response = await desktopClient.media.uploadFile({ file });
    return response.file_url;
  } catch (error) {
    console.error('Upload failed:', error);
    toast.error(error?.message || String(error) || 'Failed to upload image. Please try again.');
    return null;
  }
}

function findPlaceholder(state, uploadId) {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'imageUpload' && node.attrs.uploadId === uploadId) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * The one path every image takes to get into a document — drag-and-drop,
 * paste, and the /image command all land here.
 *
 * Drops a placeholder in immediately so the document doesn't jump around
 * while the upload runs, then swaps it for the real image (or an error node
 * the user can see and retry).
 */
export async function insertImageFromFile(editor, file, position) {
  if (!editor || !file) return null;
  const { view } = editor;
  const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const at = Number.isInteger(position) ? position : view.state.selection.$anchor.pos;

  view.dispatch(view.state.tr.insert(at, view.state.schema.nodes.imageUpload.create({
    uploading: true,
    uploadId,
    alt: 'Uploading...',
  })));

  const store = editor.storage.imageUpload;
  if (store) store.uploadsInProgress = (store.uploadsInProgress || 0) + 1;

  const url = await uploadImageFile(file);

  // Release the counter before the swap: replacing the placeholder is itself a
  // document change, and that's what re-reads the count for the "Uploading…"
  // banner. Decrementing afterwards would leave it stuck on screen.
  if (store) store.uploadsInProgress = Math.max(0, store.uploadsInProgress - 1);

  const placeholderPos = findPlaceholder(view.state, uploadId);
  if (placeholderPos !== -1) {
    const attrs = url
      ? { src: url, alt: file.name, uploading: false, uploadId: null }
      : { error: 'Upload failed. Please try again.', uploadId, uploading: false };
    view.dispatch(view.state.tr.replaceWith(
      placeholderPos,
      placeholderPos + 1,
      view.state.schema.nodes.imageUpload.create(attrs),
    ));
  }

  return url;
}

/** Embed an image that already lives at a URL, no upload involved. */
export function insertImageFromUrl(editor, url, position) {
  const src = String(url || '').trim();
  if (!editor || !src) return false;
  if (!/^(https?:\/\/|data:image\/)/i.test(src)) {
    toast.error('Enter an image address starting with http:// or https://');
    return false;
  }
  const { view } = editor;
  const at = Number.isInteger(position) ? position : view.state.selection.$anchor.pos;
  view.dispatch(view.state.tr.insert(at, view.state.schema.nodes.imageUpload.create({ src, alt: '' })));
  return true;
}

export const ImageUpload = Node.create({
  name: 'imageUpload',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      uploading: {
        default: false,
      },
      error: {
        default: null,
      },
      uploadId: {
        default: null,
      },
      width: {
        default: null,
      },
      height: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (dom) => ({
          src: dom.getAttribute('src'),
          alt: dom.getAttribute('alt'),
          title: dom.getAttribute('title'),
          // Numbers, not the raw strings — a resize compares against these to
          // decide whether anything actually changed.
          width: toDimension(dom.getAttribute('width')),
          height: toDimension(dom.getAttribute('height')),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { uploading, error, uploadId, ...attrs } = HTMLAttributes;
    
    // Don't render placeholders/errors to final HTML/markdown
    if (uploading || error || !attrs.src) {
      return ['span', {}];
    }
    
    // Only render real images with src
    return ['img', {
      src: attrs.src,
      alt: attrs.alt || '',
      title: attrs.title || undefined,
      width: attrs.width || undefined,
      height: attrs.height || undefined,
    }];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'image-upload-node';

      if (node.attrs.uploading) {
        dom.innerHTML = `
          <div class="image-upload-placeholder">
            <div class="placeholder-shimmer"></div>
            <div class="placeholder-content">
              <div class="upload-spinner"></div>
              <span class="upload-label">Uploading…</span>
            </div>
          </div>
        `;
        return { dom };
      }

      if (node.attrs.error) {
        dom.innerHTML = `
          <div class="image-upload-error">
            <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>Upload failed</span>
          </div>
        `;
        return { dom };
      }

      if (!node.attrs.src) return { dom };

      // A shrink-wrapped frame around the image so the resize handle can sit
      // on the picture's own bottom-right corner rather than out at the edge
      // of the text column.
      const frame = document.createElement('span');
      frame.className = 'image-resize-frame';

      const img = document.createElement('img');
      img.src = initialMediaSource(node.attrs.src);
      let destroyed = false;
      resolveMediaSource(node.attrs.src).then(source => { if (!destroyed) img.src = source; }).catch(() => { if (!destroyed) img.alt = 'Image is still downloading'; });
      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.title) img.title = node.attrs.title;
      img.className = 'uploaded-image';
      img.draggable = false;
      applyImageWidth(img, node.attrs.width);

      const handle = document.createElement('span');
      handle.className = 'image-resize-handle';
      handle.title = 'Drag to resize';
      handle.setAttribute('aria-hidden', 'true');
      frame.append(img, handle);
      dom.appendChild(frame);

      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        // Keep this out of ProseMirror's hands: without this the drag turns
        // into a node drag or a text selection instead of a resize.
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const startWidth = img.getBoundingClientRect().width;
        const maxWidth = availableWidth(editor);
        frame.classList.add('is-resizing');
        try { handle.setPointerCapture(event.pointerId); } catch { /* older engines */ }

        const onMove = (moveEvent) => {
          const next = Math.round(startWidth + (moveEvent.clientX - startX));
          applyImageWidth(img, Math.min(Math.max(next, MIN_IMAGE_WIDTH), maxWidth));
        };

        const finish = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', finish);
          handle.removeEventListener('pointercancel', finish);
          frame.classList.remove('is-resizing');

          const width = Math.round(img.getBoundingClientRect().width);
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (!Number.isInteger(pos)) return;
          const target = editor.view.state.doc.nodeAt(pos);
          if (!target || target.type.name !== 'imageUpload') return;
          if (target.attrs.width === width) return;

          // Width only — height follows from the aspect ratio, so a resized
          // image can never come back squashed.
          editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...target.attrs,
            width,
            height: null,
          }));
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
      };

      handle.addEventListener('pointerdown', onPointerDown);

      return {
        dom,

        update(updatedNode) {
          // Anything that changes which of the three states we render (or
          // which picture) needs a fresh node view.
          if (updatedNode.type !== node.type) return false;
          if (updatedNode.attrs.src !== node.attrs.src) return false;
          if (updatedNode.attrs.uploading || updatedNode.attrs.error) return false;
          node = updatedNode;
          applyImageWidth(img, node.attrs.width);
          if (node.attrs.alt) img.alt = node.attrs.alt;
          return true;
        },

        // Only the handle's own events are ours; clicks on the image still
        // reach the editor so select-and-delete and the lightbox keep working.
        stopEvent: (event) => handle.contains(event.target),

        // We restyle the <img> during a drag; that isn't a document edit.
        ignoreMutation: (mutation) => mutation.type === 'attributes' || handle.contains(mutation.target),

        destroy() {
          destroyed = true;
          handle.removeEventListener('pointerdown', onPointerDown);
        },
      };
    };
  },

  addCommands() {
    return {
      setImage: (options) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: options,
        });
      },
    };
  },

  // tiptap seeds editor.storage.imageUpload with {} before onCreate runs, so a
  // truthiness guard there never fires and the counter stayed undefined.
  // Declaring it as storage is the reliable way to have it exist from the start.
  addStorage() {
    return { uploadsInProgress: 0 };
  },

  addProseMirrorPlugins() {
    // `this` inside a props method is the props object, not the extension, so
    // capture the editor here where it is actually in scope.
    const extensionEditor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('imageUpload'),
        props: {
          handlePaste(view, event) {
            const imageItems = Array.from(event.clipboardData?.items || [])
              .filter(item => item.type.startsWith('image/'));
            if (imageItems.length === 0) return false;

            event.preventDefault();
            const position = view.state.selection.$anchor.pos;
            imageItems.forEach((item) => {
              const file = item.getAsFile();
              if (file) insertImageFromFile(extensionEditor, file, position);
            });
            return true;
          },

          handleDrop(view, event) {
            const imageFiles = Array.from(event.dataTransfer?.files || [])
              .filter(file => file.type.startsWith('image/'));
            if (imageFiles.length === 0) return false;

            event.preventDefault();
            const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!coordinates) return true;

            // Drop where the cursor landed, in the order the files came in.
            imageFiles.forEach((file) => {
              insertImageFromFile(extensionEditor, file, coordinates.pos);
            });
            return true;
          },
        },
      }),
    ];
  },
});
