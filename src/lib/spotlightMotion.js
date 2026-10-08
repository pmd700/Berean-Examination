import '../styles/spotlight.css';

/** Shared, cancellable navigation. Each leg accelerates and settles on arrival. */
export const SPOTLIGHT_HOLD_MS = 2200;
export const SPOTLIGHT_FADE_MS = 650;
export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function motionFrame(duration, update, signal) {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(false); return; }
    let frame;
    let start;
    const finish = (completed) => {
      window.cancelAnimationFrame(frame);
      signal.removeEventListener('abort', abort);
      resolve(completed);
    };
    const abort = () => finish(false);
    signal.addEventListener('abort', abort, { once: true });
    const tick = (now) => {
      start ??= now;
      const progress = duration ? Math.min(1, (now - start) / duration) : 1;
      update(progress);
      if (progress === 1) finish(true);
      else frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
  });
}

export const motionPause = (duration, signal) => motionFrame(duration, () => {}, signal);

/** A journey never fights a reader who starts navigating or editing. */
export function createSpotlightTrip() {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  events.forEach(type => window.addEventListener(type, cancel, { capture: true, passive: true }));
  const dispose = () => events.forEach(type => window.removeEventListener(type, cancel, true));
  controller.signal.addEventListener('abort', dispose, { once: true });
  return { signal: controller.signal, cancel, dispose };
}

/** Scroll only the target's scroll containers, never an unrelated pane. */
export async function scrollSpotlightTarget(target, signal) {
  const element = target?.startContainer
    ? (target.startContainer.nodeType === 1 ? target.startContainer : target.startContainer.parentElement)
    : target;
  if (!element?.isConnected || signal.aborted) return false;
  const scrollers = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
      scrollers.push(parent);
    }
  }
  const page = document.scrollingElement;
  if (page && page.scrollHeight > page.clientHeight && !scrollers.includes(page)) scrollers.push(page);
  for (const scroller of scrollers) {
    const box = scroller === page ? { top: 0 } : scroller.getBoundingClientRect();
    const height = scroller === page ? window.innerHeight : scroller.clientHeight;
    const from = scroller.scrollTop;
    const destination = () => {
      const rect = target.getBoundingClientRect();
      return Math.max(0, Math.min(scroller.scrollHeight - height,
        scroller.scrollTop + rect.top - box.top - height * 0.4));
    };
    const distance = Math.abs(destination() - from);
    if (distance < 2) continue;
    const duration = prefersReducedMotion() ? 0 : Math.min(880, 300 + Math.sqrt(distance) * 10);
    // CSS smooth scrolling must not re-ease each frame of our own animation.
    const previousBehavior = scroller.style.scrollBehavior;
    const previousAnchor = scroller.style.overflowAnchor;
    scroller.style.scrollBehavior = 'auto';
    scroller.style.overflowAnchor = 'none';
    try {
      const completed = await motionFrame(duration, progress => {
        const ease = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        scroller.scrollTop = from + (destination() - from) * ease;
      }, signal);
      if (!completed) return false;
    } finally {
      scroller.style.scrollBehavior = previousBehavior;
      scroller.style.overflowAnchor = previousAnchor;
    }
  }
  return !signal.aborted;
}

/** Native short fields use the same arrival/hold/fade rhythm as rich text. */
export function startFieldSpotlight(field, query) {
  const trip = createSpotlightTrip();
  let selection = null;
  const finished = (async () => {
    try {
      if (!field) return;
      const value = field.value.toLocaleLowerCase();
      const term = [query, ...query.split(/\s+/)].find(word => word && value.includes(word.toLocaleLowerCase()));
      if (!term || !await scrollSpotlightTarget(field, trip.signal)) return;
      const index = value.indexOf(term.toLocaleLowerCase());
      field.classList.add('bex-spotlight-field-arrival');
      field.style.setProperty('--bex-spotlight-alpha', '0.75');
      field.focus({ preventScroll: true });
      field.setSelectionRange(index, index + term.length);
      selection = [index, index + term.length];
      if (!await motionPause(SPOTLIGHT_HOLD_MS, trip.signal)) return;
      await motionFrame(prefersReducedMotion() ? 0 : SPOTLIGHT_FADE_MS, progress => {
        field.style.setProperty('--bex-spotlight-alpha', String(0.75 * (1 - progress)));
      }, trip.signal);
    } finally {
      // Never clear a selection the reader made after interrupting the trip.
      if (!trip.signal.aborted && selection && field.selectionStart === selection[0] && field.selectionEnd === selection[1]) {
        field.setSelectionRange(selection[1], selection[1]);
      }
      field?.classList.remove('bex-spotlight-field-arrival');
      field?.style.removeProperty('--bex-spotlight-alpha');
      trip.dispose();
    }
  })();
  return { cancel: trip.cancel, finished };
}
