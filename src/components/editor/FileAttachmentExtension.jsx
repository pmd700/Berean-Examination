import React from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { File, FileText, Film, Music, MoreHorizontal, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent as SharedMenuContent,
  DropdownMenuItem as SharedMenuItem, DropdownMenuCheckboxItem as SharedMenuCheckboxItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import AttachmentViewer from '@/components/attachments/AttachmentViewer';
import AttachmentPreview from '@/components/attachments/AttachmentPreview';
import {
  getAttachmentPreviewKind, isVaultAttachmentUrl, openAttachmentExternally,
} from '@/components/attachments/attachmentModel';
import './fileAttachment.css';

// The shared JS wrappers retain Radix props at runtime; annotate those props
// here because checkJs infers only RefAttributes from the untyped wrappers.
const DropdownMenuContent = /** @type {typeof import('@radix-ui/react-dropdown-menu').Content} */ (/** @type {unknown} */ (SharedMenuContent));
const DropdownMenuItem = /** @type {typeof import('@radix-ui/react-dropdown-menu').Item} */ (/** @type {unknown} */ (SharedMenuItem));
const DropdownMenuCheckboxItem = /** @type {typeof import('@radix-ui/react-dropdown-menu').CheckboxItem} */ (/** @type {unknown} */ (SharedMenuCheckboxItem));

const attributeNames = {
  url: 'data-file-url', name: 'data-file-name', mimeType: 'data-file-type',
  size: 'data-file-size', kind: 'data-file-kind', display: 'data-file-display',
};

function safeAttribute(key, value) {
  if (key === 'url') return isVaultAttachmentUrl(value) ? value : '';
  if (key === 'display') return value === 'preview' ? 'preview' : 'icon';
  if (key === 'size') return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  if (key === 'kind') return ['pdf', 'audio', 'video', 'image', 'file'].includes(value) ? value : 'file';
  return String(value || '').slice(0, key === 'name' ? 255 : 100);
}

export function FileAttachmentView({ node, updateAttributes, deleteNode, editor, selected }) {
  const attachment = node.attrs;
  const [expanded, setExpanded] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const previewKind = getAttachmentPreviewKind(attachment);
  const editable = editor?.isEditable !== false;
  const valid = isVaultAttachmentUrl(attachment.url);
  const Icon = previewKind === 'pdf' ? FileText : previewKind === 'audio' ? Music : previewKind === 'video' ? Film : File;

  const openExternal = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await openAttachmentExternally(attachment.url);
    } catch (error) {
      toast.error(error?.message || 'BEX could not open this file.');
    } finally {
      setOpening(false);
    }
  };
  const open = () => previewKind ? setExpanded(true) : openExternal();

  return (
    <NodeViewWrapper className={`bex-file-attachment ${selected ? 'is-selected' : ''}`} contentEditable={false} data-testid="file-attachment">
      <div className="bex-file-attachment__row">
        <button type="button" className="bex-file-attachment__open" onClick={open} disabled={!valid || opening} title={previewKind ? 'Open in BEX' : 'Open in default app'} data-testid="file-attachment-open">
          <Icon size={18} aria-hidden="true" />
          <span title={attachment.name || 'Attached file'}>{attachment.name || 'Attached file'}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="bex-file-attachment__menu" aria-label={`Options for ${attachment.name || 'attached file'}`} data-testid="file-attachment-options"><MoreHorizontal size={16} /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[100001] bg-surface text-ink border-line">
            {previewKind && editable && (
              <DropdownMenuCheckboxItem checked={attachment.display === 'preview'} onCheckedChange={show => updateAttributes({ display: show ? 'preview' : 'icon' })} data-testid="file-attachment-preview-toggle">
                Show preview
              </DropdownMenuCheckboxItem>
            )}
            {previewKind && <DropdownMenuItem onSelect={openExternal} disabled={!valid || opening}><ExternalLink />Open in default app</DropdownMenuItem>}
            {editable && <>
              {previewKind && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={deleteNode} title="Remove from this note; the vault copy is kept"><Trash2 />Remove attachment</DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!valid && <p className="bex-file-attachment__error">This attachment reference is unavailable.</p>}
      {!expanded && valid && previewKind && attachment.display === 'preview' && <AttachmentPreview attachment={attachment} onOpen={open} />}
      {expanded && <AttachmentViewer attachment={attachment} onClose={() => setExpanded(false)} />}
    </NodeViewWrapper>
  );
}

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return Object.fromEntries(Object.entries(attributeNames).map(([key, attribute]) => [key, {
      default: safeAttribute(key, ''),
      parseHTML: element => safeAttribute(key, element.getAttribute(attribute)),
      renderHTML: attributes => ({ [attribute]: safeAttribute(key, attributes[key]) }),
    }]));
  },
  parseHTML() { return [{ tag: 'div[data-bex-file]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-bex-file': 'true', class: 'bex-file-attachment' },
      ['span', {}, safeAttribute('name', node.attrs.name) || 'Attached file']];
  },
  renderText({ node }) { return node.attrs.name || 'Attached file'; },
  addNodeView() { return ReactNodeViewRenderer(FileAttachmentView); },
});

export default FileAttachment;
