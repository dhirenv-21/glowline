// Demo mode (`electron . --demo`): a made-up track with a generated cover, original
// placeholder lyrics and a simulated 120 BPM beat. Used for screenshots and for trying the
// app without Spotify. Nothing here touches the network or real audio.

/** Abstract cover art drawn on a canvas (no third-party artwork). */
export function demoCoverArt(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#120a2e');
  bg.addColorStop(1, '#041a24');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  const blob = (x, y, r, color) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, size, size);
  };
  blob(size * 0.28, size * 0.3, size * 0.55, 'rgba(124,108,255,0.95)');
  blob(size * 0.78, size * 0.7, size * 0.55, 'rgba(0,214,190,0.85)');
  blob(size * 0.7, size * 0.18, size * 0.35, 'rgba(255,79,160,0.75)');
  // a glowing rounded "screen" outline, Glowline's mark
  g.lineWidth = size * 0.035;
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.shadowColor = 'rgba(255,255,255,0.9)';
  g.shadowBlur = size * 0.06;
  const w = size * 0.5, h = size * 0.36, x = (size - w) / 2, y = (size - h) / 2, r = size * 0.06;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.stroke();
  return c.toDataURL('image/png');
}

export const DEMO_TRACK = {
  title: 'Neon Tides',
  artist: 'Glowline Demo',
  album: 'Night Drive',
  duration: 214,
  start: 52,
};

// Original placeholder lyrics written for the demo.
export const DEMO_LYRICS = [
  [0, ''],
  [12, 'City lights are humming low'],
  [17, 'Every window keeps a glow'],
  [22, 'We were drifting, half awake'],
  [27, 'Counting colours on the lake'],
  [33, ''],
  [41, 'Turn it up and let it shine'],
  [46, 'Edges burning, yours and mine'],
  [51, 'Hold the moment, feel the tide'],
  [56, 'Neon pulling us outside'],
  [62, 'Every beat a wave of light'],
  [67, 'Running round the screen tonight'],
  [73, ''],
  [81, 'Slow it down, the bassline falls'],
  [86, 'Shadows dancing on the walls'],
  [92, 'Turn it up and let it shine'],
  [97, 'Edges burning, yours and mine'],
].map(([t, text]) => ({ t, text }));

/** Simulated music signal: 120 BPM kick with a swelling level. */
export function demoSignal(nowMs) {
  const s = nowMs / 1000;
  const beatPhase = (s * 2) % 1;              // 2 beats per second
  const beat = Math.exp(-beatPhase * 6);      // sharp attack, smooth decay
  const level = 0.55 + 0.25 * Math.sin(s * 0.7) + 0.15 * beat;
  return { level: Math.min(1, level), beat: beatPhase < 0.05 ? 1 : beat, rms: 0.3 };
}
