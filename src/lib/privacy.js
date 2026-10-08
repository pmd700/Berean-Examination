function requireDesktopPrivacy() {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop) {
    throw new Error('Local privacy is available only inside the BEX desktop app.');
  }
  return desktopApi;
}

function requireStatus(result, fallbackMessage) {
  if (!result?.ok || !result.status) {
    const error = new Error(result?.error || fallbackMessage);
    error.code = result?.code || null;
    error.attempts = result?.attempts ?? null;
    error.delayMs = result?.delayMs ?? null;
    error.retryAfterMs = result?.retryAfterMs ?? null;
    throw error;
  }
  return result.status;
}

function requireRecoveryResult(result, fallbackMessage) {
  const status = requireStatus(result, fallbackMessage);
  if (!result.recoveryCode) throw new Error(fallbackMessage);
  return { recoveryCode: result.recoveryCode, status };
}

export async function enablePrivacyPin(pin) {
  const result = await requireDesktopPrivacy().enablePrivacyPin(pin);
  return requireRecoveryResult(result, 'BEX could not enable the privacy PIN.');
}

export async function changePrivacyPin(pin) {
  const result = await requireDesktopPrivacy().changePrivacyPin(pin);
  return requireStatus(result, 'BEX could not change the privacy PIN.');
}

export async function disablePrivacyPin() {
  const result = await requireDesktopPrivacy().disablePrivacyPin();
  return requireStatus(result, 'BEX could not remove the privacy PIN.');
}

export async function replacePrivacyRecoveryCode() {
  const result = await requireDesktopPrivacy().replacePrivacyRecoveryCode();
  return requireRecoveryResult(result, 'BEX could not replace the recovery code.');
}

export async function readPrivacyStatus() {
  const result = await requireDesktopPrivacy().getPrivacyStatus();
  return requireStatus(result, 'BEX could not check the local privacy vault.');
}

export async function unlockPrivacyAutomatically() {
  const result = await requireDesktopPrivacy().unlockPrivacyAutomatically();
  return requireStatus(result, 'BEX could not unlock the local privacy vault.');
}

export async function unlockPrivacyWithPin(pin) {
  const result = await requireDesktopPrivacy().unlockPrivacyWithPin(pin);
  return requireStatus(result, 'BEX could not unlock the library with that PIN.');
}

export async function unlockPrivacyWithRecoveryCode(recoveryCode) {
  const result = await requireDesktopPrivacy().unlockPrivacyWithRecoveryCode(recoveryCode);
  return requireStatus(result, 'BEX could not unlock the library with that recovery code.');
}

export function subscribeToPrivacyStatus(callback) {
  return requireDesktopPrivacy().onPrivacyStatusChanged(callback);
}
