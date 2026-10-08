function requireDesktopApi() {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop) {
    throw new Error('The local owner is available only inside the BEX desktop app.');
  }
  return desktopApi;
}

function requireOwner(result, fallbackMessage) {
  if (!result?.ok || !result.owner?.is_local_owner) {
    throw new Error(result?.error || fallbackMessage);
  }
  return result.owner;
}

export async function readLocalOwner() {
  const result = await requireDesktopApi().getLocalOwner();
  return requireOwner(result, 'BEX could not read the local owner.');
}

export async function saveLocalOwnerPreferences(patch) {
  const result = await requireDesktopApi().updateLocalOwner(patch);
  return requireOwner(result, 'BEX could not save the local owner settings.');
}
