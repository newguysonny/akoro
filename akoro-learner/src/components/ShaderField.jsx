import { useRef, useEffect } from 'react';

/**
 * ShaderField — a domain-warped fBm noise field ( fbm(p + fbm(p + fbm(p))) )
 * rendered per-pixel on the GPU via WebGL2. Adapted from the baseline-2026
 * reference "the field" (plate 01). Fills its positioned parent.
 *
 * Progressive enhancement: no WebGL2 → renders nothing (parent's own bg shows);
 * prefers-reduced-motion → a single still frame, no animation loop.
 *
 * Palette defaults to Akoro brand purple. Pair with a light scrim on top so
 * foreground text stays readable.
 */

const VERT = `#version 300 es
void main(){
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec4 u[7];
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 k = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), k.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), k.x), k.y);
}
float fbm(vec2 p){
  float a = 0.5; float s = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++){ s += a * noise(p); p = m * p; a *= 0.5; }
  return s;
}
vec3 pal(float x){
  vec3 c = mix(u[2].xyz, u[3].xyz, smoothstep(0.0, 0.45, x));
  c = mix(c, u[4].xyz, smoothstep(0.35, 0.8, x));
  c = mix(c, u[5].xyz, smoothstep(0.75, 1.05, x) * 0.6);
  return c;
}
void main(){
  vec2 res = u[0].xy;
  vec2 uv = gl_FragCoord.xy / res;
  vec2 p = (uv - 0.5) * vec2(u[6].y, 1.0) * 3.0 + vec2(u[6].x);
  float t = u[0].z * u[5].w * 0.12 + u[0].w * 4.0;
  float w = u[4].w;
  vec2 q = vec2(fbm(p + vec2(t) * 0.10), fbm(p + vec2(5.2, 1.3) + vec2(t) * -0.07));
  vec2 r = vec2(fbm(p + q * (2.2 * w) + vec2(1.7, 9.2) + vec2(t) * 0.15),
                fbm(p + q * (2.2 * w) + vec2(8.3, 2.8) + vec2(t) * -0.12));
  float f = fbm(p + r * (2.0 * w));
  float x = f * 1.05 + 0.1 * r.y;
  vec3 col = pal(x * x * 0.92);
  col = mix(col, pal(q.x * 0.5 + 0.18), 0.3 * smoothstep(0.2, 0.9, length(q)));
  col *= (0.22 + 0.85 * pow(smoothstep(0.15, 1.05, f), 1.6));
  vec2 c2 = uv - 0.5;
  col *= (1.0 - 0.55 * dot(c2, c2));
  col += vec3((hash(gl_FragCoord.xy + vec2(u[0].z)) - 0.5) * 0.04);
  o = vec4(max(col, vec3(0.0)), 1.0);
}`;

// Brand-purple palette stops (deep indigo → violet → lavender → soft pink).
const PALETTE = [
  [0.13, 0.08, 0.34],
  [0.42, 0.23, 1.00],
  [0.68, 0.52, 1.00],
  [0.95, 0.86, 1.00],
];

export default function ShaderField({ style, className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl;
    try { gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' }); }
    catch { gl = null; }
    if (!gl) return;   // no WebGL2 → leave the parent background as-is

    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[ShaderField]', gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const prog = gl.createProgram();
    const vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[ShaderField] link failed'); return; }
    gl.useProgram(prog);
    const loc = gl.getUniformLocation(prog, 'u');

    const U = new Float32Array(28);
    U[4] = 0.5; U[5] = 0.5;                     // u[1].xy pointer (centre, unused)
    U.set(PALETTE[0], 8);  U[11] = 0.10;        // u[2]
    U.set(PALETTE[1], 12); U[15] = 0.0;         // u[3] (wireframe off)
    U.set(PALETTE[2], 16); U[19] = 0.92;        // u[4] warp base
    U.set(PALETTE[3], 20); U[23] = 1.0;         // u[5] time speed
    U[24] = 17.3;                                // u[6].x pan seed

    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0, visible = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      U[0] = canvas.width; U[1] = canvas.height;
      U[25] = canvas.width / canvas.height;     // u[6].y aspect
    };

    const draw = (nowMs) => {
      U[2] = (nowMs - start) / 1000;            // u[0].z time
      gl.uniform4fv(loc, U);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (now) => { if (!visible) return; resize(); draw(now); raf = requestAnimationFrame(loop); };

    resize();
    if (reduce) { draw(start); }               // single still frame
    else raf = requestAnimationFrame(loop);

    // Pause the loop when the field scrolls out of view (saves GPU/battery).
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !reduce && !raf) raf = requestAnimationFrame(loop);
      if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; }
    }, { threshold: 0 });
    io.observe(canvas);

    const onResize = () => { if (reduce) { resize(); draw(start); } };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('resize', onResize);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    };
  }, []);

  return (
    <canvas ref={canvasRef} aria-hidden="true" className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', ...style }} />
  );
}
