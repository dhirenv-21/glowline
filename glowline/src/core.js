// Pure, DOM-free logic for Glowline. Everything here is unit-tested in tests/core.test.mjs.

export const STORAGE_KEY = 'glowline:settings:v1';

export const PRESETS = Object.freeze([
  { id: 'ember', name: 'Ember', primary: '#ff6a3d', secondary: '#ffc861' },
  { id: 'lagoon', name: 'Lagoon', primary: '#00c2c7', secondary: '#3a5bff' },
  { id: 'orchid', name: 'Orchid', primary: '#c552ff', secondary: '#ff5fa2' },
  { id: 'aurora', name: 'Aurora', primary: '#3dffa8', secondary: '#7a5cff' },
  { id: 'citrus', name: 'Citrus', primary: '#d4ff3a', secondary: '#ff9f1c' },
  { id: 'moonlight', name: 'Moonlight', primary: '#e8eefc', secondary: '#8aa4d6' },
]);

export const RANGES = Object.freeze({
  glow: { min: 0, max: 100 },
  thickness: { min: 1, max: 80 },
  speed: { min: 0, max: 100 },
  balance: { min: 10, max: 90 },
});

export const ENUMS = Object.freeze({
  colorMode: ['solid', 'gradient'],
  motion: ['still', 'animated', 'music'],
  theme: ['system', 'light', 'dark'],
});

export const DEFAULTS = Object.freeze({
  colorMode: 'gradient',
  primary: PRESETS[2].primary,
  secondary: PRESETS[2].secondary,
  balance: 60,
  motion: 'animated',
  glow: 60,
  thickness: 14,
  speed: 35,
  theme: 'system',
  overlay: false,
  autoAudio: false,
  albumColors: true,
  lyrics: true,
});

const BOOLEANS = ['overlay', 'autoAudio', 'albumColors', 'lyrics'];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHex(value) {
  return typeof value === 'string' && HEX.test(value);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Return a complete, valid settings object; invalid or missing fields fall back to defaults. */
export function sanitizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = { ...DEFAULTS };
  for (const key of ['primary', 'secondary']) {
    if (isHex(src[key])) out[key] = src[key].toLowerCase();
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (allowed.includes(src[key])) out[key] = src[key];
  }
  for (const key of BOOLEANS) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  for (const [key, { min, max }] of Object.entries(RANGES)) {
    const n = typeof src[key] === 'string' && src[key].trim() !== '' ? Number(src[key]) : src[key];
    if (typeof n === 'number' && Number.isFinite(n)) out[key] = Math.round(clamp(n, min, max));
  }
  return out;
}

/** Read settings from a Storage-like object. Never throws. */
export function loadSettings(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULTS };
  }
}

/** Write settings to a Storage-like object. Returns false if storage is unavailable or full. */
export function saveSettings(storage, settings) {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

export function findPreset(settings) {
  return PRESETS.find((p) => p.primary === settings.primary && p.secondary === settings.secondary) ?? null;
}

export function hexToRgb(hex) {
  if (!isHex(hex)) throw new TypeError(`Invalid hex color: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const part = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function mixColors(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const k = clamp(t, 0, 1);
  return rgbToHex({ r: x.r + (y.r - x.r) * k, g: x.g + (y.g - x.g) * k, b: x.b + (y.b - x.b) * k });
}

/** Hex → { h: 0..360, s: 0..1, v: 0..1 } */
export function hexToHsv(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** { h: 0..360, s: 0..1, v: 0..1 } → hex */
export function hsvToHex({ h, s, v }) {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = clamp(v, 0, 1) * clamp(s, 0, 1);
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = clamp(v, 0, 1) - c;
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

/** Relative luminance-ish brightness, 0..255. */
export function brightness({ r, g, b }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Lift very dark colors so a sampled black screen still produces a visible glow. */
export function ensureVisible(hex, minBrightness = 60) {
  const rgb = hexToRgb(hex);
  const lum = brightness(rgb);
  if (lum >= minBrightness) return hex;
  if (lum === 0) return rgbToHex({ r: minBrightness, g: minBrightness, b: minBrightness });
  const k = minBrightness / lum;
  return rgbToHex({ r: rgb.r * k, g: rgb.g * k, b: rgb.b * k });
}

/** Average RGBA pixel data over columns [x0, x1) of a w×h image. Transparent pixels are skipped. */
export function averageRegion(data, w, h, x0 = 0, x1 = w) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 16) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
  }
  if (count === 0) return '#000000';
  return rgbToHex({ r: r / count, g: g / count, b: b / count });
}

/**
 * Pick two glow colors from album art pixels (RGBA). Builds a hue histogram weighted by
 * saturation × brightness, takes the strongest hue and the strongest clearly different hue,
 * and lifts both so they read as light. Greyscale covers fall back to their average tone.
 */
export function extractPalette(data, w, h) {
  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  let total = 0;
  for (let i = 0; i < w * h * 4; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    total++;
    const { h: hue, s, v } = hexToHsv(rgbToHex({ r, g, b }));
    if (s < 0.22 || v < 0.18) continue;
    const wgt = s * v * v;
    const bin = bins[Math.floor(hue / (360 / BINS)) % BINS];
    bin.weight += wgt; bin.r += r * wgt; bin.g += g * wgt; bin.b += b * wgt;
  }
  const lift = (hex, minS = 0.5, minV = 0.85) => {
    const c = hexToHsv(hex);
    return hsvToHex({ h: c.h, s: Math.max(c.s, minS), v: Math.max(c.v, minV) });
  };
  const binColor = (bin) => rgbToHex({ r: bin.r / bin.weight, g: bin.g / bin.weight, b: bin.b / bin.weight });
  const ranked = bins.map((b, i) => ({ ...b, i })).filter((b) => b.weight > 0).sort((a, b) => b.weight - a.weight);
  if (total === 0) return { primary: DEFAULTS.primary, secondary: DEFAULTS.secondary };
  const colorfulShare = ranked.reduce((sum, b) => sum + b.weight, 0) / total;
  if (ranked.length === 0 || colorfulShare < 0.002) {
    // Black-and-white cover: a bright, cool neutral glow (grey would look dim on screen).
    return { primary: '#f2f4ff', secondary: '#9fb4ff' };
  }
  const top = ranked[0];
  const dist = (a, b) => Math.min(Math.abs(a - b), BINS - Math.abs(a - b));
  const second = ranked.find((b) => dist(b.i, top.i) >= 3 && b.weight >= top.weight * 0.08);
  const primary = lift(binColor(top));
  if (second) return { primary, secondary: lift(binColor(second)) };
  // One dominant hue: pair it with a neighbouring hue so the gradient still moves.
  const p = hexToHsv(primary);
  return { primary, secondary: hsvToHex({ h: p.h + 40, s: Math.max(0.45, p.s * 0.85), v: 1 }) };
}

/** Sample a captured frame: left half drives the primary color, right half the secondary. */
export function sampleEdgeColors(data, w, h) {
  const mid = Math.max(1, Math.floor(w / 2));
  return {
    primary: ensureVisible(averageRegion(data, w, h, 0, mid)),
    secondary: ensureVisible(averageRegion(data, w, h, mid, w)),
  };
}

/** Turn analyser frequency bytes (0..255) into a 0..1 level, weighted toward bass and low mids. */
export function computeLevel(freq) {
  if (!freq || freq.length === 0) return 0;
  const n = Math.max(1, Math.floor(freq.length / 4));
  let sum = 0, weight = 0;
  for (let i = 0; i < n; i++) {
    const w = 1 - (i / n) * 0.6;
    sum += freq[i] * w;
    weight += 255 * w;
  }
  return clamp(sum / weight, 0, 1);
}

/**
 * Kick-drum band energy (0..1): mean of the frequency bins between ~40 and ~150 Hz.
 * Used for beat detection, before any auto-gain, so drum hits stand out from sustained sound.
 */
export function computeBassLevel(freq, sampleRate = 48000, fftSize = 2048, lowHz = 40, highHz = 150) {
  if (!freq || freq.length === 0) return 0;
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.floor(lowHz / binHz));
  const hi = Math.min(freq.length - 1, Math.max(lo, Math.ceil(highHz / binHz)));
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += freq[i];
  return clamp(sum / ((hi - lo + 1) * 255), 0, 1);
}

/** Root-mean-square loudness (0..1) of analyser time-domain bytes, where 128 is silence. */
export function computeRms(timeData) {
  if (!timeData || timeData.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) {
    const v = (timeData[i] - 128) / 128;
    sum += v * v;
  }
  return clamp(Math.sqrt(sum / timeData.length), 0, 1);
}

/** RMS above this counts as "audio detected" (about -46 dBFS; digital silence is 0). */
export const AUDIBLE_RMS = 0.005;

/**
 * Tracks whether a stream is audible, with hold time so short gaps between songs or
 * quiet passages don't flicker the indicator.
 */
export function createActivityTracker({ threshold = AUDIBLE_RMS, holdMs = 1500 } = {}) {
  let lastLoud = -Infinity;
  return {
    update(rms, now) {
      if (rms >= threshold) lastLoud = now;
      return now - lastLoud <= holdMs;
    },
  };
}

/**
 * Energy-based beat detector: a beat is a level spike well above its recent average,
 * with a refractory period. `pulse` jumps to 1 on a beat and decays toward 0.
 */
export function createBeatDetector({ sensitivity = 1.15, minLevel = 0.12, refractoryMs = 250, decayPerSec = 4 } = {}) {
  let avg = 0;
  let lastBeat = -Infinity;
  let lastTime = null;
  let pulse = 0;
  return {
    update(level, now) {
      const dt = lastTime === null ? 0 : Math.max(0, (now - lastTime) / 1000);
      lastTime = now;
      pulse = Math.max(0, pulse - dt * decayPerSec);
      const isBeat = level > minLevel && level > avg * sensitivity && now - lastBeat > refractoryMs;
      if (isBeat) { lastBeat = now; pulse = 1; }
      avg = avg === 0 ? level : avg + (level - avg) * Math.min(1, dt * 2.5 || 0.05);
      return { beat: isBeat, pulse, average: avg };
    },
  };
}

/**
 * Automatic gain: divides a level by a slowly decaying recent peak so the light reacts the
 * same whether Spotify plays quietly or loudly. Floor keeps silence from being amplified.
 */
export function createAutoGain({ floor = 0.08, halfLifeMs = 8000 } = {}) {
  let peak = floor;
  let lastTime = null;
  return {
    update(level, now) {
      const dt = lastTime === null ? 0 : Math.max(0, now - lastTime);
      lastTime = now;
      peak = Math.max(floor, peak * Math.pow(0.5, dt / halfLifeMs), level);
      return clamp(level / peak, 0, 1);
    },
  };
}

/** Asymmetric smoothing: rise fast (attack), fall slowly (release). */
export function smoothLevel(prev, next, attack = 0.5, release = 0.08) {
  const k = next > prev ? attack : release;
  return prev + (next - prev) * k;
}

/** Degrees per second for a speed setting of 0..100. */
export function degreesPerSecond(speed) {
  return 6 + clamp(speed, 0, 100) * 1.14;
}

/**
 * Compute the visual state for one animation frame.
 * @returns {{angle:number, intensity:number, thickness:number, blur:number}}
 */
export function frameState(settings, { time = 0, level = 0, beat = 0, reducedMotion = false } = {}) {
  const s = sanitizeSettings(settings);
  const base = s.glow / 100;
  const secs = time / 1000;
  let angle = 0;
  let intensity = base;
  let thickness = s.thickness;

  if (s.motion === 'animated' && !reducedMotion) {
    angle = (secs * degreesPerSecond(s.speed)) % 360;
    intensity = base * (0.85 + 0.15 * Math.sin(secs * 1.6));
  } else if (s.motion === 'music') {
    const lv = clamp(level, 0, 1);
    const pulse = clamp(beat, 0, 1);
    if (reducedMotion) {
      intensity = base * (0.6 + 0.4 * lv);
    } else {
      angle = (secs * degreesPerSecond(s.speed) * 0.5) % 360;
      intensity = base * (0.4 + 0.45 * lv + 0.3 * pulse);
      thickness = s.thickness * (1 + 0.5 * lv + 0.35 * pulse);
    }
  }

  return {
    angle: Math.round(angle * 100) / 100,
    intensity: Math.round(clamp(intensity, 0, 1) * 1000) / 1000,
    thickness: Math.round(thickness * 10) / 10,
    blur: Math.round((thickness * 0.6 + s.glow * 0.9) * 10) / 10,
  };
}

/** CSS background for the light band. */
export function gradientCss(settings, angle = 0) {
  const s = sanitizeSettings(settings);
  if (s.colorMode === 'solid') return s.primary;
  return `conic-gradient(from ${angle}deg, ${s.primary} 0%, ${s.secondary} ${s.balance}%, ${s.primary} 100%)`;
}

export function nextTheme(theme) {
  const order = ENUMS.theme;
  return order[(order.indexOf(theme) + 1) % order.length];
}

/** Map a DOMException from a permission-gated API to a user-facing explanation. */
export function describeMediaError(err, what) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `${what} permission was declined or blocked. Nothing is being captured. You can try again or keep using manual colors.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what.toLowerCase()} source was found on this device.`;
  if (name === 'NotReadableError') return `The ${what.toLowerCase()} source is busy or unavailable (another app may be using it).`;
  if (name === 'AbortError') return `${what} request was cancelled.`;
  return `${what} could not start${err?.message ? `: ${err.message}` : '.'}`;
}

/** Index of the lyric line to highlight at `position` seconds (-1 before the first line). Lines sorted by `t`. */
export function activeLineIndex(lines, position) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= position) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
