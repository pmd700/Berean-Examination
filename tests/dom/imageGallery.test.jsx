import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ImageUpload } from '@/components/editor/ImageUploadExtension';
import { ImageGallery, groupSelectedImages } from '@/components/editor/ImageGalleryExtension';
import { moveGalleryImage } from '@/components/editor/imageGalleryReorder';
import { BlockDrag, blockDragPluginKey } from '@/components/editor/BlockDragExtension';
import { getDraggableBlocks } from '@/components/editor/blockDragModel';
import ImageGalleryTools from '@/components/editor/ImageGalleryTools';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: { Keyword: { list: async () => [] } } } }));
let editor;
afterEach(() => { editor?.destroy(); editor = null; });
const picture = n => `<img src="https://example.com/${n}.png" alt="Image ${n}" width="640">`;
const selectImages = () => editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { type: 'selection', selected: getDraggableBlocks(editor.state.doc).filter(b => b.node.type.name === 'imageUpload').map(b => b.index), source: 'marquee', previewing: false }));
function open(content) {
  editor = new Editor({ extensions: [StarterKit, ImageUpload, ImageGallery, BlockDrag], content, editorProps: { handleScrollToSelection: () => true } });
  document.body.append(editor.view.dom);
}
it('groups selected images without removing intervening text, preserves dimensions, and undoes in one step', () => {
  open(`<p>Before</p>${picture(1)}<p>Keep this text</p>${picture(2)}${picture(3)}<p>After</p>`);
  const original = editor.getJSON(); selectImages();
  expect(groupSelectedImages(editor)).toBe(true);
  const gallery = editor.state.doc.child(1);
  expect(gallery.type.name).toBe('imageGallery');
  expect(gallery.childCount).toBe(3);
  expect(gallery.firstChild.attrs.width).toBe(640);
  expect(editor.state.doc.textContent).toBe('BeforeKeep this textAfter');
  editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
  editor.commands.redo(); expect(editor.getHTML()).toContain('data-image-gallery');
});
it('round trips grouped HTML and ungrouping keeps every original image', () => {
  open(picture(1) + picture(2) + picture(3) + picture(4)); selectImages(); groupSelectedImages(editor);
  const html = editor.getHTML(); editor.commands.setContent(html);
  expect(editor.state.doc.firstChild.type.name).toBe('imageGallery');
  expect(editor.state.doc.firstChild.childCount).toBe(4);
  expect(editor.view.dom.querySelector('[data-gallery-count]').textContent).toContain('4');
  editor.view.dom.querySelector('.bex-image-gallery__ungroup').click();
  expect(editor.view.dom.querySelector('[data-image-gallery]')).toBeNull();
  expect(editor.getHTML().match(/<img/g)).toHaveLength(4);
});
it('does not group incomplete uploads', () => {
  open(picture(1));
  editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'imageUpload', attrs: { uploading: true } });
  selectImages(); expect(groupSelectedImages(editor)).toBe(false);
});
it('opens the selected thumbnail and browses every image with arrows and keyboard', () => {
  open(picture(1) + picture(2) + picture(3) + picture(4));
  render(<ImageGalleryTools editor={editor} />);
  act(() => selectImages());
  const button = screen.getByTestId('group-selected-images');
  fireEvent.pointerDown(button, { button: 0 }); fireEvent.click(button);
  expect(editor.state.doc.firstChild.type.name).toBe('imageGallery');
  fireEvent.click(editor.view.dom.querySelectorAll('img')[1]);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('2 of 4');
  fireEvent.click(screen.getByLabelText('Next image'));
  expect(screen.getByRole('status').textContent).toBe('3 of 4');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
  expect(screen.getByRole('status').textContent).toBe('4 of 4');
  fireEvent.change(screen.getByLabelText('Image zoom'), { target: { value: '200' } });
  expect(screen.getByLabelText('Image zoom').value).toBe('200');
  fireEvent.click(screen.getByLabelText('Close image viewer'));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('the universal editor preserves gallery HTML on load and exposes its viewer', async () => {
  render(<MemoryRouter><TEXT_EDITOR_MACHINERY content={`<div data-image-gallery>${picture(1)}${picture(2)}</div>`} onChange={() => {}} onEditorReady={value => { editor = value; }} /></MemoryRouter>);
  await waitFor(() => expect(editor).toBeTruthy());
  expect(editor.state.doc.firstChild.type.name).toBe('imageGallery');
  fireEvent.click(editor.view.dom.querySelector('[data-gallery-count]'));
  expect(screen.getByRole('status').textContent).toBe('1 of 2');
});

it('reorders exact image instances, preserves metadata, and persists through HTML reload and Undo', () => {
  open(picture(1) + picture(2) + picture(3) + picture(4)); selectImages(); groupSelectedImages(editor);
  const original = editor.getJSON();
  expect(moveGalleryImage(editor, 0, 0, 3)).toBe(true);
  const order = () => editor.state.doc.firstChild.content.content.map(child => child.attrs.alt);
  expect(order()).toEqual(['Image 2', 'Image 3', 'Image 1', 'Image 4']);
  editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
  editor.commands.redo();
  const html = editor.getHTML(); editor.commands.setContent(html);
  expect(order()).toEqual(['Image 2', 'Image 3', 'Image 1', 'Image 4']);
  expect(moveGalleryImage(editor, 0, 2, 0)).toBe(true);
  expect(order()).toEqual(['Image 1', 'Image 2', 'Image 3', 'Image 4']);
  expect(moveGalleryImage(editor, 0, 0, 1)).toBe(false);
});

it('keeps the drop indicator out of saved content and commits only on release', async () => {
  open(picture(1) + picture(2)); selectImages(); groupSelectedImages(editor);
  const original = editor.getJSON();
  const strip = editor.view.dom.querySelector('.bex-image-gallery__images');
  Array.from(strip.children).forEach((child, index) => { child.getBoundingClientRect = () => new DOMRect(index * 208, 20, 200, 150); });
  const pointer = (target, type, x) => target.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, cancelable: true, clientX: x, clientY: 80 }));
  pointer(strip.querySelector('img'), 'pointerdown', 100);
  pointer(window, 'pointermove', 400);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(editor.view.dom.querySelector('.bex-gallery-drop-marker')).toBeTruthy();
  expect(editor.getJSON()).toEqual(original);
  pointer(window, 'pointerup', 400);
  expect(editor.view.dom.querySelector('.bex-gallery-drop-marker')).toBeNull();
  expect(editor.state.doc.firstChild.firstChild.attrs.alt).toBe('Image 2');
  expect(editor.getHTML()).not.toContain('bex-gallery-drop-marker');
});
