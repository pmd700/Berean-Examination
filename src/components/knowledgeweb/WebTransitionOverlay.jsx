import React, { useEffect, useRef, useState } from 'react';

// Full-screen transition that plays when the user opens a web-link
// canvas object. Deliberately understated: a soft, eased crossfade
// to a dark veil with the destination web's title gently rising into
// view, then fading back out to reveal the new web. No starbursts,
// no warping, no irises — just a smooth dissolve so the jump feels
// considered rather than theatrical.
//
// Phases:
//   0     – 280ms : veil fades in to fully opaque, title rises in
//                    with it. At the peak (≈280ms) the screen is fully
//                    covered, so we call onMidpoint() to swap the
//                    active web; the user never sees the destination
//                    snap into place.
//   280   – 560ms : veil fades back out, revealing the new web. Title
//                    fades out a little faster than the veil so it
//                    doesn't linger over the new content.
//
// We accept `origin` for API compatibility with the previous overlay
// but don't use it: a centered crossfade reads more calmly than a
// directional iris and avoids drawing the eye to one corner.

const FADE_IN_MS = 280;
const FADE_OUT_MS = 280;
const TOTAL_MS = FADE_IN_MS + FADE_OUT_MS;
const MIDPOINT_MS = FADE_IN_MS;

export default function WebTransitionOverlay({
  // eslint-disable-next-line no-unused-vars
  origin,
  title,
  isPrivate,
  onMidpoint,
  onComplete,
}) {
  const [t, setT] = useState(0);
  const startRef = useRef(performance.now());
  const calledMidRef = useRef(false);
  const calledDoneRef = useRef(false);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const elapsed = performance.now() - startRef.current;
      setT(elapsed);
      if (!calledMidRef.current && elapsed >= MIDPOINT_MS) {
        calledMidRef.current = true;
        try { onMidpoint?.(); } catch (e) { /* swallow — animation must complete */ }
      }
      if (elapsed >= TOTAL_MS) {
        if (!calledDoneRef.current) {
          calledDoneRef.current = true;
          try { onComplete?.(); } catch (e) { /* swallow */ }
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [onMidpoint, onComplete]);

  // easeInOutCubic gives the veil a gentle acceleration into full
  // opacity and a gentle deceleration as it lifts away — no abrupt
  // start/stop on either side.
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  // Veil opacity rises 0 → 1 across fade-in, then 1 → 0 across fade-out.
  let veil;
  if (t < FADE_IN_MS) veil = easeInOut(t / FADE_IN_MS);
  else veil = 1 - easeInOut(Math.min(1, (t - FADE_IN_MS) / FADE_OUT_MS));
  veil = Math.max(0, Math.min(1, veil));

  // Title fades in alongside the veil, holds at peak, then fades out
  // slightly faster (0.7× the fade-out duration) so it lifts away
  // before the veil does and doesn't sit on top of the new web.
  let titleAlpha;
  if (t < FADE_IN_MS) {
    titleAlpha = easeInOut(t / FADE_IN_MS);
  } else {
    const p = Math.min(1, (t - FADE_IN_MS) / (FADE_OUT_MS * 0.7));
    titleAlpha = 1 - easeInOut(p);
  }
  titleAlpha = Math.max(0, Math.min(1, titleAlpha));

  // A tiny rise on the title so it has a sense of motion without
  // being distracting. ±6px total drift over the whole transition.
  let titleY;
  if (t < FADE_IN_MS) {
    titleY = (1 - easeInOut(t / FADE_IN_MS)) * 6; // 6 → 0
  } else {
    const p = Math.min(1, (t - FADE_IN_MS) / FADE_OUT_MS);
    titleY = -easeInOut(p) * 6; // 0 → -6
  }

  const accentSoft = isPrivate ? 'rgba(167,139,250,0.45)' : 'rgba(125,211,252,0.45)';

  return (
    <div
      className="fixed inset-0 z-[200] overflow-hidden"
      data-testid="overlay-web-transition"
      // pointer-events MUST stay auto: this overlay is the modal layer
      // for the duration of the transition. If clicks fall through, a
      // user can fire a second web-link jump mid-animation and the
      // overlay's internal "midpoint" guard refuses to re-trigger
      // loadWeb, leaving the canvas stuck on the wrong web.
      style={{ pointerEvents: 'auto' }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* The veil itself — a near-black wash with the faintest accent
          tint so private vs public webs are subtly distinguished. */}
      <div
        className="absolute inset-0"
        style={{
          background: '#0B0E13',
          opacity: veil,
          willChange: 'opacity',
        }}
      />

      {/* Centered title — kept simple: no icons, no chrome, just the
          name of where you're going. */}
      <div
        className="absolute inset-0 flex items-center justify-center px-8"
        style={{
          opacity: titleAlpha,
          transform: `translateY(${titleY}px)`,
          willChange: 'opacity, transform',
        }}
      >
        <div
          className="text-center font-semibold text-white"
          style={{
            fontSize: 'clamp(22px, 3.6vw, 40px)',
            textShadow: `0 0 24px ${accentSoft}`,
            letterSpacing: '-0.01em',
            lineHeight: 1.15,
            maxWidth: '70vw',
          }}
        >
          {title || 'Knowledge Web'}
        </div>
      </div>
    </div>
  );
}
