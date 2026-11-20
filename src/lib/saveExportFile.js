import { downloadFile } from '@/components/knowledgeweb/bereanFileFormat';
const desktopBridge = () => /** @type {Window & {bexDesktop?: {isDesktop?:boolean,saveExportFile?:(payload:any)=>Promise<any>,chooseExportFile?:(payload:any)=>Promise<any>,cancelExportFile?:(payload:any)=>Promise<any>}}} */ (window).bexDesktop;

// Only the native save bridge can confirm the user's file was written.
export async function saveExportFile(blob, fileName, destination = undefined) {
  const desktop = desktopBridge();
  if (!desktop?.saveExportFile) {
    if (desktop?.isDesktop) throw new Error('Restart BEX to finish loading the updated export tools.');
    downloadFile(blob, fileName);
    return { status: 'started' };
  }
  const result = await desktop.saveExportFile({
    fileName,
    bytes: new Uint8Array(await blob.arrayBuffer()),
    ...(destination?.selectionId ? { selectionId: destination.selectionId } : {}),
  });
  if (result?.status === 'failed') throw new Error(result.error || 'Could not save the export.');
  if (!['saved', 'canceled'].includes(result?.status)) throw new Error('The export could not be confirmed.');
  return result;
}

export async function chooseExportFile(fileName) {
  const desktop = desktopBridge();
  if (!desktop?.isDesktop) return { status: 'ready' };
  if (!desktop.chooseExportFile) throw new Error('Restart BEX to finish loading the updated export tools.');
  const result = await desktop.chooseExportFile({ fileName });
  if (!['ready', 'canceled'].includes(result?.status)) throw new Error(result?.error || 'Could not choose an export location.');
  return result;
}

export async function cancelExportFile(destination) {
  if (destination?.selectionId) await desktopBridge()?.cancelExportFile?.({ selectionId: destination.selectionId });
}
