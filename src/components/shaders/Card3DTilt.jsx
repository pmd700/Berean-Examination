import { useRef } from 'react';
import HolographicShader from './HolographicShader';
import LiquidGlow from './LiquidGlow';

// Sleek, thin, 3D card surface with a live shader backdrop.
//
// Layout (back-to-front):
//   1. Outer perspective container — gives children real CSS 3D depth.
//   2. Tilt wrapper — rotates on mousemove, snaps back on leave.
//   3. Shader layer — full-bleed WebGL canvas, low-opacity glow under glass.
//   4. Glass surface — translucent dark fill so text stays legible.
//   5. Children — the actual form lives here.
//
// Why a separate component: the tilt math wants direct DOM access (ref +
// inline transform) so we don't trigger React re-renders 60×/sec while
// the user moves their mouse. Keeping it here also lets us reuse this
// surface for other "premium" cards later without copy-pasting.
export default function Card3DTilt({
  children,
  className = '',
  innerClassName = '',
  appearance = 'holographic',
  glowColor = 'rgb(var(--ink-muted) / 0.10)',
  glowSize = 360,
  glowFalloff = 68,
  glowAppearance = 'soft',
  glowBehindContent = false,
  glowOpacity = 1,
  tiltClassName = '',
  shaderIntensity = 0.55,
  shaderHueShift = 0.0,
  maxTiltDeg = 7,
  'data-testid': dataTestId,
}) {
  const hostRef = useRef(null);
  const tiltRef = useRef(null);
  const glowRef = useRef(null);
  const isHolographic = appearance === 'holographic';
  const glowOffset = glowSize / 2;

  const handleMove = (e) => {
    const host = hostRef.current;
    const el = tiltRef.current;
    if (!host || !el) return;
    // Measure the stationary outer frame. Measuring the already-tilted card
    // makes its bounding box shift under the cursor and offsets the light.
    const rect = host.getBoundingClientRect();
    const localX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const localY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    // -0.5..+0.5 around the card centre.
    const px = localX / rect.width - 0.5;
    const py = localY / rect.height - 0.5;
    // Invert Y so pushing the mouse up tips the card AWAY from you,
    // which matches how a real card behaves under a fingertip.
    const rx = (-py * maxTiltDeg).toFixed(2);
    const ry = (px * maxTiltDeg).toFixed(2);
    el.style.transform = `perspective(1100px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`;
    // Move the light itself instead of rebuilding a gradient on every frame.
    // Its centre lands exactly beneath the pointer.
    if (glowRef.current) {
      glowRef.current.style.opacity = String(glowOpacity);
      glowRef.current.dataset.active = 'true';
      glowRef.current.style.transform = `translate3d(${localX - glowOffset}px, ${localY - glowOffset}px, 0)`;
    }
  };

  const handleLeave = () => {
    const el = tiltRef.current;
    if (!el) return;
    el.style.transform = 'perspective(1100px) rotateX(0deg) rotateY(0deg) translateZ(0)';
    if (glowRef.current) {
      glowRef.current.style.opacity = '0';
      glowRef.current.dataset.active = 'false';
    }
  };

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ perspective: '1100px' }}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      data-testid={dataTestId}
    >
      <div
        ref={tiltRef}
        className={`relative h-full ${isHolographic ? 'overflow-hidden rounded-xl' : ''} ${tiltClassName}`}
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          // Stacked shadow: a tight inner one for the bezel, a wide diffuse
          // one for the floating-above-the-page feel.
          boxShadow: isHolographic
            ? '0 1px 0 rgba(255,255,255,0.04) inset, 0 -1px 0 rgba(0,0,0,0.5) inset, 0 18px 50px -20px rgba(0,0,0,0.75), 0 4px 14px -6px rgba(107,76,154,0.25)'
            : undefined,
          // Hairline border that picks up the shader colour through alpha.
          border: isHolographic ? '1px solid rgb(var(--ink-muted) / 0.10)' : undefined,
          background: isHolographic
            ? 'linear-gradient(180deg, rgb(var(--surface) / 0.86) 0%, rgb(var(--app) / 0.92) 100%)'
            : undefined,
        }}
      >
        {/* Shader layer — sits behind the glass. mix-blend-screen so the
            iridescent colours light up the dark base instead of muddying it. */}
        {isHolographic && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ mixBlendMode: 'screen', opacity: 0.85 }}
            aria-hidden="true"
          >
            <HolographicShader
              intensity={shaderIntensity}
              hueShift={shaderHueShift}
              speed={0.9}
            />
          </div>
        )}

        {/* Glass overlay — keeps the surface readable on top of the shader.
            Slight gradient sheen to sell the "tempered glass" look. */}
        {isHolographic && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'linear-gradient(180deg, rgb(var(--surface) / 0.55) 0%, rgb(var(--app) / 0.78) 100%)',
            }}
            aria-hidden="true"
          />
        )}

        {/* Cursor-tracking specular highlight. */}
        {glowAppearance !== 'none' && <div
          ref={glowRef}
          data-card-glow=""
          data-active="false"
          className={`pointer-events-none absolute left-0 top-0 ${glowBehindContent ? 'z-0' : 'z-20'} rounded-full opacity-0`}
          style={{
            width: glowSize,
            height: glowSize,
            background: glowAppearance === 'liquid' ? undefined : `radial-gradient(circle, ${glowColor} 0%, transparent ${glowFalloff}%)`,
            mixBlendMode: 'screen',
            transition: 'opacity 140ms ease-out',
            willChange: 'transform, opacity',
          }}
          aria-hidden="true"
        >
          {glowAppearance === 'liquid' && <LiquidGlow color={glowColor} />}
        </div>}

        {/* Top edge highlight — fakes a chamfer where light catches the rim. */}
        {isHolographic && (
          <div
            className="absolute inset-x-0 top-0 h-px pointer-events-none"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgb(var(--ink-muted) / 0.35), transparent)',
            }}
            aria-hidden="true"
          />
        )}

        {/* Children sit above the background glow when requested. We deliberately
            do NOT translateZ them: lifting children forward in 3D space
            shifted the hit-test area far enough that buttons (especially
            the gradient submit) could fail to register clicks when the
            card was tilted. A flat z-index lift keeps stacking right
            without breaking pointer hit-testing. */}
        <div className={`relative z-10 ${innerClassName}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
