import { useId, useMemo } from 'react';
import './liquidGlow.css';

// An original local effect inspired by organic particle/blur experiments:
// https://tympanus.net/codrops/2025/09/11/when-cells-collide-the-making-of-an-organic-particle-experiment-with-rapier-three-js/
// SVG turbulence breaks the soft light into wisps. Independent, randomized
// shapes and dust move without a physics engine, downloads or React updates.
export default function LiquidGlow({ color }) {
  const filterId = `liquid-glow-${useId().replace(/:/g, '')}`;
  const shapes = useMemo(() => Array.from({ length: 5 }, () => ({
    left: `${18 + Math.random() * 38}%`, top: `${18 + Math.random() * 38}%`,
    width: `${30 + Math.random() * 26}%`, height: `${18 + Math.random() * 24}%`,
    '--angle': `${Math.random() * 180}deg`, '--drift-x': `${Math.random() * 70 - 35}px`,
    '--drift-y': `${Math.random() * 56 - 28}px`, '--duration': `${3.5 + Math.random() * 4}s`,
    '--delay': `${-Math.random() * 8}s`,
  })), []);
  const particles = useMemo(() => Array.from({ length: 14 }, () => ({
    left: `${15 + Math.random() * 70}%`, top: `${15 + Math.random() * 70}%`,
    width: `${1 + Math.random() * 2.5}px`, height: `${1 + Math.random() * 2.5}px`,
    '--drift-x': `${Math.random() * 72 - 36}px`, '--drift-y': `${-15 - Math.random() * 50}px`,
    '--duration': `${2 + Math.random() * 3}s`, '--delay': `${-Math.random() * 5}s`,
  })), []);
  const seed = useMemo(() => Math.floor(Math.random() * 1000), []);

  return <div className="liquid-glow" style={{ '--liquid-color': color }}>
    <svg className="liquid-glow__defs" width="0" height="0" focusable="false" aria-hidden="true">
      <defs><filter id={filterId} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.013 0.019" numOctaves="2" seed={seed} result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="48" xChannelSelector="R" yChannelSelector="G" />
        <feGaussianBlur stdDeviation="5" />
      </filter></defs>
    </svg>
    <div className="liquid-glow__mist" style={{ filter: `url(#${filterId})` }}>
      {shapes.map((style, i) => <span key={i} className="liquid-glow__wisp" style={style} />)}
    </div>
    <div className="liquid-glow__dust">
      {particles.map((style, i) => <span key={i} className="liquid-glow__particle" style={style} />)}
    </div>
  </div>;
}
