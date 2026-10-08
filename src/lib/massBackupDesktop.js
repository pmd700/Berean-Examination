function requireMassBackupApi() {
  const api = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!api?.isDesktop) {
    throw new Error('Mass Backup is available inside the BEX desktop app.');
  }
  return api;
}

function requireSuccess(result, fallbackMessage) {
  if (!result?.ok) {
    const error = new Error(result?.error || fallbackMessage);
    error.code = result?.code || null;
    throw error;
  }
  return result;
}

function normalizeSettings(settings) {
  const value = settings && typeof settings === 'object' ? settings : {};
  const savedFolderPath = typeof value.folderPath === 'string'
    ? value.folderPath
    : (typeof value.destinationPath === 'string' ? value.destinationPath : '');
  // A remembered path can outlive a moved or deleted folder. Do not present
  // that stale path as a usable destination or enable the backup button until
  // the user chooses an available folder again.
  const folderPath = value.available === false ? '' : savedFolderPath;
  return {
    ...value,
    folderPath,
    replacePrevious: value.replacePrevious === true,
  };
}

export async function getMassBackupSettings() {
  const api = requireMassBackupApi();
  if (typeof api.getMassBackupSettings !== 'function') {
    throw new Error('Update or restart BEX before using Mass Backup.');
  }
  const result = await api.getMassBackupSettings();
  return normalizeSettings(
    requireSuccess(result, 'BEX could not read the Mass Backup settings.').settings,
  );
}

export async function chooseMassBackupFolder() {
  const api = requireMassBackupApi();
  if (typeof api.chooseMassBackupFolder !== 'function') {
    throw new Error('Update or restart BEX before choosing a backup folder.');
  }
  const result = requireSuccess(
    await api.chooseMassBackupFolder(),
    'BEX could not choose that backup folder.',
  );
  return result.canceled ? null : normalizeSettings(result.settings);
}

export async function setMassBackupReplacePrevious(enabled) {
  const api = requireMassBackupApi();
  if (typeof api.setMassBackupReplacePrevious !== 'function') {
    throw new Error('Update or restart BEX before changing this backup setting.');
  }
  const result = await api.setMassBackupReplacePrevious(Boolean(enabled));
  return normalizeSettings(
    requireSuccess(result, 'BEX could not save the Mass Backup setting.').settings,
  );
}

export async function writeMassBackupArchives(archives) {
  const api = requireMassBackupApi();
  if (typeof api.writeMassBackupArchives !== 'function') {
    throw new Error('Update or restart BEX before creating a Mass Backup.');
  }
  const payload = (Array.isArray(archives) ? archives : []).map((archive) => ({
    category: archive.category || archive.kind,
    bytes: archive.bytes,
  }));
  const result = requireSuccess(
    await api.writeMassBackupArchives(payload),
    'BEX could not save the Mass Backup archives.',
  );
  return result.backup || result.result;
}

export async function revealMassBackupFolder() {
  const api = requireMassBackupApi();
  if (typeof api.revealMassBackupFolder !== 'function') {
    throw new Error('Update or restart BEX before opening the backup folder.');
  }
  return requireSuccess(
    await api.revealMassBackupFolder(),
    'BEX could not open the Mass Backup folder.',
  );
}
