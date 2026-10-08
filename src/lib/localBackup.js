function requireDesktopBackup() {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop) {
    throw new Error('Library backup and restore are available only inside the BEX desktop app.');
  }
  return desktopApi;
}

function resultError(result, fallbackMessage) {
  const error = new Error(result?.error || fallbackMessage);
  error.code = result?.code || null;
  error.rolledBack = result?.rolledBack === true;
  return error;
}

export async function createLibraryBackup() {
  const result = await requireDesktopBackup().createLocalBackup();
  if (!result?.ok || !result.backup) {
    throw resultError(result, 'BEX could not create the encrypted backup.');
  }
  return result.backup;
}

export async function chooseAndRestoreLibraryBackup() {
  const result = await requireDesktopBackup().restoreLocalBackup();
  if (!result?.ok) {
    throw resultError(result, 'BEX could not restore the encrypted backup.');
  }
  return result;
}
