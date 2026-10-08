import { useEffect, useRef } from 'react';

// A self-contained, dependency-free WebGL "shader" backdrop.
// Renders a flowing iridescent gradient driven by a fragment shader,
// suitable for layering behind cards, headers, or hero blocks. Falls
// back to a plain transparent canvas if WebGL is unavailable, so it's
// always safe to mount.
//
// Props:
//   - intensity   (0..1) overall brightness of the effect (default 0.5)
//   - speed       multiplier on time (default 1.0)
//   - hueShift    rotates the palette (0..1)
//   - className   passes through to the canvas element
//   - style       passes through to the canvas element
//
// Intentionally light: one program, one quad, one RAF loop. Auto-pauses
// when the canvas is offscreen (IntersectionObserver) to keep it from
// pegging the GPU on background tabs / scrolled-away cards.
export default function HolographicShader({
  intensity = 0.5,
  speed = 1.0,
  hueShift = 0.0,
  className = '',
  style = {},
}) {
  const canvasRef = useRef(null);
  // Mirror props in refs so the RAF loop can read live values without
  // having to re-init the GL program on every prop change.
  const intensityRef = useRef(intensity);
  const speedRef = useRef(speed);
  const hueShiftRef = useRef(hueShift);
  useEffect(() => { intensityRef.current = intensity; }, [intensity]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { hueShiftRef.current = hueShift; }, [hueShift]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      canvas.getContext('webgl', { premultipliedAlpha: true, antialias: true }) ||
      canvas.getContext('experimental-webgl');
    if (!gl) return; // browser without WebGL — silent no-op

    const VERT = `
      attribute vec2 aPos;
      varying vec2 vUv;
      void main() {
        vUv = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;
    const FRAG = `
      precision mediump float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uIntensity;
      uniform float uHueShift;
      uniform vec2  uResolution;

      // Purple-locked palette. Three stops in the violet/indigo/lavender
      // family — no rainbow cycling, just brightness/saturation drift.
      // hueShift biases between the cooler indigo and the warmer magenta
      // edge of purple without ever leaving the purple family.
      vec3 purplePalette(float n, float bias) {
        vec3 deep   = vec3(0.18, 0.08, 0.36); // deep violet
        vec3 mid    = vec3(0.48, 0.25, 0.82); // brand purple
        vec3 bright = vec3(0.78, 0.58, 1.00); // soft lavender
        // Slight magenta vs indigo skew based on hueShift bias.
        vec3 warm = vec3(0.58, 0.20, 0.78);   // magenta-leaning
        vec3 cool = vec3(0.34, 0.22, 0.86);   // indigo-leaning
        vec3 tint = mix(cool, warm, clamp(bias, 0.0, 1.0));
        // Two-stop gradient deep -> bright via mid, then mix in tint
        // for a touch of color personality.
        vec3 base = n < 0.5
          ? mix(deep, mid,    n * 2.0)
          : mix(mid,  bright, (n - 0.5) * 2.0);
        return mix(base, tint, 0.18);
      }

      void main() {
        // Stretch uv so the wave field doesn't squish on tall cards.
        vec2 uv = vUv;
        float aspect = uResolution.x / max(uResolution.y, 1.0);
        vec2 p = vec2(uv.x * aspect, uv.y);

        // Four crossing sine sheets — slightly more amplitude and a
        // fourth slow drifting term give the field "more movement"
        // while staying smooth.
        float w1 = sin(p.x * 2.8 + uTime * 0.65);
        float w2 = cos(p.y * 3.3 - uTime * 0.52);
        float w3 = sin((p.x + p.y) * 1.9 + uTime * 0.38);
        float w4 = cos((p.x - p.y) * 1.4 + uTime * 0.28);
        float field = (w1 + w2 + w3 + w4) / 4.0;
        // Normalize -1..1 -> 0..1 for the palette ramp.
        float n = field * 0.5 + 0.5;
        // Subtle slow brightness pulse so the card feels alive even
        // without dramatic hue changes.
        n = clamp(n + sin(uTime * 0.22) * 0.05, 0.0, 1.0);

        vec3 col = purplePalette(n, uHueShift);

        // Radial vignette so the effect feels like a soft glow under the
        // card surface instead of a flat fill — sleeker, more 3D.
        float d = length(uv - 0.5);
        float vignette = smoothstep(0.85, 0.15, d);
        col *= vignette;

        // Output as additive-ish glow. Alpha carries the intensity so
        // the host card can blend it however it likes.
        float a = uIntensity * vignette;
        gl_FragColor = vec4(col * uIntensity, a);
      }
    `;

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        // Shader failed — log once and abort. The canvas just stays
        // transparent, the surrounding UI is unaffected.
        // eslint-disable-next-line no-console
        console.warn('[HolographicShader] shader compile failed:', gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      // eslint-disable-next-line no-console
      console.warn('[HolographicShader] program link failed:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // Full-screen quad — two triangles covering clip space.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uIntensity = gl.getUniformLocation(prog, 'uIntensity');
    const uHueShift = gl.getUniformLocation(prog, 'uHueShift');
    const uResolution = gl.getUniformLocation(prog, 'uResolution');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Match the canvas's backing-store size to its CSS size, capped at
    // 1.5x DPR so phones with retina screens don't shade 4M pixels for
    // a 320x180 backdrop.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    // Defer the resize out of the ResizeObserver callback with rAF so changing
    // the canvas backing store can't synchronously feed back into the same
    // observer tick — that feedback is what throws the browser's "ResizeObserver
    // loop completed with undelivered notifications" error (dispatched as a
    // window error event with a null error object, which the dev overlay then
    // reports as an uncaught crash). The 3D-tilt ancestor makes this easy to hit.
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(resize);
    });
    ro.observe(canvas);

    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(canvas);

    let raf = 0;
    const start = performance.now();
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden) return;
      const t = ((performance.now() - start) / 1000) * speedRef.current;
      gl.uniform1f(uTime, t);
      gl.uniform1f(uIntensity, intensityRef.current);
      gl.uniform1f(uHueShift, hueShiftRef.current);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      io.disconnect();
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      // Lose the context explicitly so Chrome doesn't keep a GPU
      // surface around for a card that may be unmounted on auth.
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height: '100%', ...style }}
      aria-hidden="true"
    />
  );
}
