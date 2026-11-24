// GPU edge-light renderer (WebGL fragment shader), shared by the in-app preview and the
// on-screen overlay. Per pixel it computes the distance to the screen edge and the position
// along the perimeter, then layers:
//   • a white-hot core hugging the edge   • a coloured bloom   • a wide, soft ambient wash
// Colours flow around the perimeter with organic noise; in Music sync each beat launches a
// wave of light that races around the edges from the bottom centre and fades out.
import { frameState, degreesPerSecond, hexToRgb } from './core.js';

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uRadius, uCore, uBloom, uAmb, uIntensity, uPhase, uTime, uShimmer, uBalance, uSolid, uEnergy;
uniform vec3 uC1, uC2;
uniform vec4 uWaveAge;   // seconds since each beat wave started (< 0 = unused)
uniform vec4 uWaveStr;   // strength of each wave

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(float x) { float i = floor(x); float f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), u); }
float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

// Colour, edge "leak" brightness and beat-wave boost at perimeter position u (0..1).
vec3 edgeColour(float u) {
  float warp = noise(u * 7.0 + uPhase * 1.7) * 0.6 + noise(u * 19.0 - uTime * 0.35) * 0.25;
  float g = 0.5 + 0.5 * sin(6.28318 * (u * 2.0 - uPhase) + warp * 2.4);
  g = smoothstep(uBalance - 0.28, uBalance + 0.28, g);
  return mix(uC1, uC2, g * (1.0 - uSolid));
}
float edgeGain(float u) {
  float leak = 0.82 + 0.3 * noise(u * 11.0 + uTime * 0.22) + 0.12 * noise(u * 31.0 - uTime * 0.6);
  float shimmer = 1.0 + uShimmer * (noise(u * 70.0 + uTime * 6.0) - 0.5) * 0.7;
  float du = abs(fract(u - 0.75 + 0.5) - 0.5);           // distance from the bottom centre
  float wave = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = uWaveAge[i];
    if (age >= 0.0) wave += exp(-pow((du - age * 0.42) / 0.045, 2.0)) * exp(-age * 1.35) * uWaveStr[i];
  }
  return leak * shimmer * (1.0 + wave * 1.5);
}

void main() {
  vec2 px = vUv * uRes;
  vec2 c = uRes * 0.5;
  float sd = sdRoundBox(px - c, c, uRadius);
  if (sd > 0.5) { gl_FragColor = vec4(0.0); return; }
  float d = max(0.0, -sd);
  float reachMax = max(uAmb * 2.6, uBloom * 7.0) * (1.0 + uEnergy * 0.3);
  if (d > reachMax) { gl_FragColor = vec4(0.0); return; }   // most of the screen: nothing to draw

  // Blend the four sides smoothly (no seams on the corner diagonals).
  float W = uRes.x, H = uRes.y, P = 2.0 * (W + H);
  vec4 dist = vec4(H - px.y, W - px.x, px.y, px.x);                      // top, right, bottom, left
  vec4 us = vec4(px.x, W + (H - px.y), W + H + (W - px.x), 2.0 * W + H + px.y) / P;
  float blend = max(uBloom * 0.6, 12.0);
  vec4 wts = exp(-(dist - d) / blend);
  wts /= (wts.x + wts.y + wts.z + wts.w);
  vec3 col = vec3(0.0);
  float gain = 0.0;
  // Away from the corners only one side has weight; skip the others (big saving per pixel).
  if (wts.x > 0.01) { col += edgeColour(us.x) * wts.x; gain += edgeGain(us.x) * wts.x; }
  if (wts.y > 0.01) { col += edgeColour(us.y) * wts.y; gain += edgeGain(us.y) * wts.y; }
  if (wts.z > 0.01) { col += edgeColour(us.z) * wts.z; gain += edgeGain(us.z) * wts.z; }
  if (wts.w > 0.01) { col += edgeColour(us.w) * wts.w; gain += edgeGain(us.w) * wts.w; }
  float wsum = (wts.x > 0.01 ? wts.x : 0.0) + (wts.y > 0.01 ? wts.y : 0.0) + (wts.z > 0.01 ? wts.z : 0.0) + (wts.w > 0.01 ? wts.w : 0.0);
  col /= max(wsum, 1e-4);
  gain /= max(wsum, 1e-4);
  float reach = 1.0 + (gain - 1.0) * 0.25 + uEnergy * 0.3;

  float core = exp(-d / max(uCore * reach, 0.8));
  float bloom = exp(-d / max(uBloom * reach, 1.0));
  float amb = exp(-pow(d / max(uAmb * reach, 1.0), 2.0));
  float light = (core * 1.25 + bloom * 0.55 + amb * 0.16) * gain;

  vec3 rgb = col * light * uIntensity;
  rgb += vec3(1.0) * pow(core, 3.0) * 0.55 * uIntensity * min(gain, 2.0);   // white-hot filament on the very edge
  rgb = 1.0 - exp(-rgb * 1.25);                                               // soft tone-map: rich, never clipped
  rgb += (hash2(px + uTime) - 0.5) / 255.0;                                   // dither: no 8-bit banding
  rgb = max(rgb, 0.0);
  float a = clamp(max(max(rgb.r, rgb.g), rgb.b), 0.0, 1.0);
  gl_FragColor = vec4(rgb, a);                                                // premultiplied alpha
}`;

const UNIFORMS = ['uRes', 'uRadius', 'uCore', 'uBloom', 'uAmb', 'uIntensity', 'uPhase', 'uTime', 'uShimmer',
  'uBalance', 'uSolid', 'uEnergy', 'uC1', 'uC2', 'uWaveAge', 'uWaveStr'];

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
  return sh;
}

const rgb01 = (hex) => { const { r, g, b } = hexToRgb(hex); return [r / 255, g / 255, b / 255]; };

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ radius?: number, maxScale?: number }} opts  radius in CSS px; maxScale caps devicePixelRatio
 * @returns {{ render(settings, state): void, dispose(): void } | null}  null when WebGL is unavailable
 */
export function createGlowRenderer(canvas, { radius = 0, maxScale = 2 } = {}) {
  let gl;
  try {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
  } catch { gl = null; }
  if (!gl) return null;
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) {
    console.warn('[glowline] WebGL glow unavailable, using CSS fallback:', err.message);
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));

  let phase = 0;
  let lastTime = null;
  let lastBeat = 0;
  // Smoothed copies of the audio signal: fast attack, gentle release, updated every frame,
  // so 30 Hz input never looks steppy on a 60-144 Hz display.
  let sLevel = 0;
  let sBeat = 0;
  let sFlow = 0;
  const approach = (cur, target, dt, up, down) => cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? up : down)));
  const waves = []; // { start, strength }

  function render(settings, { time = performance.now(), level = 0, beat = 0, reducedMotion = false } = {}) {
    const scale = Math.min(maxScale, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);

    const secs = time / 1000;
    const dt = lastTime === null ? 0 : Math.min(0.1, Math.max(0, secs - lastTime));
    lastTime = secs;
    sLevel = approach(sLevel, level, dt, 0.06, 0.28);
    sBeat = approach(sBeat, beat, dt, 0.025, 0.32);
    const st = frameState(settings, { time, level: sLevel, beat: sBeat, reducedMotion });
    const moving = !reducedMotion && settings.motion !== 'still';
    const flow = moving ? (degreesPerSecond(settings.speed) / 360) * (settings.motion === 'music' ? 0.5 + sLevel : 1) : 0;
    sFlow = approach(sFlow, flow, dt, 0.4, 0.8);   // speed changes glide instead of jumping
    phase = (phase + dt * sFlow) % 1000;

    if (moving && settings.motion === 'music' && beat > 0.9 && lastBeat < 0.6) {
      waves.push({ start: secs, strength: 0.55 + 0.45 * Math.min(1, sLevel) });
      if (waves.length > 4) waves.shift();
    }
    lastBeat = beat;
    const ages = [0, 1, 2, 3].map((i) => (waves[i] ? secs - waves[i].start : -1)).map((a) => (a > 3 ? -1 : a));
    const strs = [0, 1, 2, 3].map((i) => (waves[i] ? waves[i].strength : 0));

    const glow = settings.glow / 100;
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uRadius, radius * scale);
    // Thickness sets the bright core + bloom; Glow sets how far the soft light reaches inward.
    gl.uniform1f(u.uCore, Math.max(1.2, st.thickness * 0.3) * scale);
    gl.uniform1f(u.uBloom, (st.thickness * 0.9 + 6 + glow * 18) * scale);
    gl.uniform1f(u.uAmb, (st.thickness * 1.6 + 18 + glow * 70) * scale);
    gl.uniform1f(u.uIntensity, st.intensity * 1.1);
    gl.uniform1f(u.uPhase, phase);
    gl.uniform1f(u.uTime, reducedMotion ? 0 : secs);
    gl.uniform1f(u.uShimmer, settings.motion === 'music' && !reducedMotion ? Math.min(1, sLevel * 1.2) : 0.15 * (moving ? 1 : 0));
    gl.uniform1f(u.uBalance, settings.colorMode === 'solid' ? 0.5 : settings.balance / 100);
    gl.uniform1f(u.uSolid, settings.colorMode === 'solid' ? 1 : 0);
    gl.uniform1f(u.uEnergy, settings.motion === 'music' && !reducedMotion ? Math.min(1, sLevel) : 0);
    gl.uniform3fv(u.uC1, rgb01(settings.primary));
    gl.uniform3fv(u.uC2, rgb01(settings.secondary));
    gl.uniform4fv(u.uWaveAge, ages);
    gl.uniform4fv(u.uWaveStr, strs);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return {
    render,
    dispose() { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ } },
  };
}
