// Renders the edge glow inside a transparent, click-through, always-on-top window.
// It receives settings + the live audio signal from the control window over IPC and
// computes its own animation locally so motion stays smooth at the display's frame rate.
import { DEFAULTS, frameState, gradientCss } from './core.js';
import { createGlowRenderer } from './glow.js';

const edge = document.getElementById('edge');
let settings = { ...DEFAULTS };
let signal = { level: 0, beat: 0 };
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => { reducedMotion = e.matches; });

window.__glowlineFrames = 0; // read by the self-test to confirm frames arrive
window.glowlineDesktop?.onFrame((frame) => {
  window.__glowlineFrames++;
  if (frame.settings) settings = frame.settings;
  if (typeof frame.level === 'number') signal = { level: frame.level, beat: frame.beat ?? 0 };
});

const glow = createGlowRenderer(document.getElementById('glow-canvas'), { radius: 0, maxScale: 1.5 });
document.documentElement.classList.toggle('gl-on', !!glow);

function draw(now) {
  if (glow) {
    glow.render(settings, { time: now, level: signal.level, beat: signal.beat, reducedMotion });
    requestAnimationFrame(draw);
    return;
  }
  const st = frameState(settings, { time: now, level: signal.level, beat: signal.beat, reducedMotion });
  edge.style.setProperty('--rim-bg', gradientCss(settings, st.angle));
  edge.style.setProperty('--thickness', `${st.thickness}px`);
  edge.style.setProperty('--blur', `${st.blur}px`);
  edge.style.setProperty('--intensity', String(st.intensity));
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
