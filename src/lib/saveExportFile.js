import { downloadFile } from '@/components/knowledgeweb/bereanFileFormat';

// Only the native save bridge can confirm the user's file was written.
export async function saveExportFile(blob, fileName) {
  if (!window.bexDesktop?.saveExportFile) {
    downloadFile(blob, fileName);
    return { status: 'started' };
  }
  const result = await window.bexDesktop.saveExportFile({
    fileName,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  });
  if (result?.status === 'failed') throw new Error(result.error || 'Could not save the export.');
  if (!['saved', 'canceled'].includes(result?.status)) throw new Error('The export could not be confirmed.');
  return result;
}
