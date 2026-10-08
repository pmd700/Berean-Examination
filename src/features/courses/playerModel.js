export const PLAYBACK_RATES = Object.freeze([0.75, 1, 1.25, 1.5, 1.75, 2]);

export function clampMediaTime(value, duration) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const safeDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : 0;
  return Math.min(safeDuration || Number.MAX_SAFE_INTEGER, Math.max(0, safeValue));
}

export function formatPlayerTime(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) {
    return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }
  return minutes + ':' + String(seconds).padStart(2, '0');
}

export function nextPlaybackRate(currentRate) {
  const currentIndex = PLAYBACK_RATES.indexOf(Number(currentRate));
  return PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length];
}

export function lessonIsComplete(currentTime, duration, ended = false) {
  if (ended) return true;
  const safeDuration = Math.max(0, Number(duration) || 0);
  if (!safeDuration) return false;
  return Number(currentTime) >= Math.max(safeDuration - 2, safeDuration * 0.98);
}
