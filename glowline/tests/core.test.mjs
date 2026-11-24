import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, PRESETS, STORAGE_KEY, sanitizeSettings, loadSettings, saveSettings, findPreset,
  hexToRgb, rgbToHex, mixColors, ensureVisible, averageRegion, sampleEdgeColors,
  computeLevel, smoothLevel, frameState, gradientCss, nextTheme, describeMediaError,
  computeRms, computeBassLevel, createActivityTracker, createBeatDetector, createAutoGain, AUDIBLE_RMS,
} from '../src/core.js';

test('computeRms: silence is 0, full-scale square wave is 1', () => {
  assert.equal(computeRms(new Uint8Array(256).fill(128)), 0);
  const square = Uint8Array.from({ length: 256 }, (_, i) => (i % 2 ? 0 : 256 - 1e-9));
  assert.ok(computeRms(square) > 0.99);
  assert.equal(computeRms(new Uint8Array(0)), 0);
});

test('computeBassLevel only measures the kick-drum band', () => {
  // 48 kHz / 2048 → 23.4 Hz per bin, so 40–150 Hz is bins 1..7
  const kick = new Uint8Array(1024); kick.fill(255, 1, 8);
  const hats = new Uint8Array(1024); hats.fill(255, 200);
  assert.equal(computeBassLevel(kick, 48000, 2048), 1);
  assert.equal(computeBassLevel(hats, 48000, 2048), 0);
  assert.equal(computeBassLevel(new Uint8Array(0)), 0);
});

test('activity tracker holds through short gaps then drops', () => {
  const a = createActivityTracker({ holdMs: 1000 });
  assert.equal(a.update(0, 0), false);
  assert.equal(a.update(AUDIBLE_RMS * 2, 100), true);
  assert.equal(a.update(0, 900), true);
  assert.equal(a.update(0, 1200), false);
});

test('beat detector fires on spikes, respects refractory time, and decays', () => {
  const d = createBeatDetector({ refractoryMs: 200 });
  let t = 0;
  for (let i = 0; i < 30; i++) d.update(0.2, (t += 33)); // steady background
  const hit = d.update(0.9, (t += 33));
  assert.equal(hit.beat, true);
  assert.equal(hit.pulse, 1);
  assert.equal(d.update(0.95, (t += 33)).beat, false); // within refractory window
  let pulse = 1;
  for (let i = 0; i < 10; i++) pulse = d.update(0.2, (t += 33)).pulse;
  assert.ok(pulse < 0.01);
  const quiet = createBeatDetector();
  assert.equal(quiet.update(0.05, 0).beat, false); // below minLevel
});

test('auto gain normalises quiet and loud sources alike', () => {
  const quiet = createAutoGain();
  const loud = createAutoGain();
  let q = 0, l = 0;
  for (let t = 0; t < 2000; t += 33) { q = quiet.update(0.2, t); l = loud.update(0.8, t); }
  assert.ok(Math.abs(q - l) < 0.01 && q > 0.95);
  assert.equal(createAutoGain().update(0.01, 0), 0.125); // floor stops silence being boosted to 1
});

test('frameState: beat pulse boosts music mode but is ignored under reduced motion', () => {
  const s = { ...DEFAULTS, motion: 'music', glow: 80 };
  assert.ok(frameState(s, { level: 0.5, beat: 1 }).intensity > frameState(s, { level: 0.5, beat: 0 }).intensity);
  assert.deepEqual(frameState(s, { level: 0.5, beat: 1, reducedMotion: true }), frameState(s, { level: 0.5, beat: 0, reducedMotion: true }));
});

test('boolean settings are validated', () => {
  assert.equal(sanitizeSettings({ overlay: true, autoAudio: 'yes' }).overlay, true);
  assert.equal(sanitizeSettings({ overlay: true, autoAudio: 'yes' }).autoAudio, false);
});

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

test('sanitizeSettings fills defaults and rejects bad values', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULTS);
  const s = sanitizeSettings({
    primary: '#ABCDEF', secondary: 'red', motion: 'disco', colorMode: 'solid',
    glow: 250, thickness: -4, speed: '42', balance: Number.NaN, theme: 'dark', extra: 'ignored',
  });
  assert.equal(s.primary, '#abcdef');
  assert.equal(s.secondary, DEFAULTS.secondary);
  assert.equal(s.motion, DEFAULTS.motion);
  assert.equal(s.colorMode, 'solid');
  assert.equal(s.glow, 100);
  assert.equal(s.thickness, 1);
  assert.equal(s.speed, 42);
  assert.equal(s.balance, DEFAULTS.balance);
  assert.equal(s.theme, 'dark');
  assert.equal('extra' in s, false);
});

test('settings round-trip through storage', () => {
  const store = memoryStorage();
  assert.equal(saveSettings(store, { ...DEFAULTS, glow: 12, motion: 'music' }), true);
  const loaded = loadSettings(store);
  assert.equal(loaded.glow, 12);
  assert.equal(loaded.motion, 'music');
  assert.ok(store.map.has(STORAGE_KEY));
});

test('load/save survive corrupt, missing or throwing storage', () => {
  assert.deepEqual(loadSettings(memoryStorage({ [STORAGE_KEY]: '{not json' })), DEFAULTS);
  assert.deepEqual(loadSettings(null), DEFAULTS);
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(loadSettings(throwing), DEFAULTS);
  assert.equal(saveSettings(throwing, DEFAULTS), false);
  assert.equal(saveSettings(null, DEFAULTS), false);
});

test('presets are valid and discoverable', () => {
  for (const p of PRESETS) {
    assert.deepEqual(sanitizeSettings(p).primary, p.primary);
    assert.equal(findPreset({ primary: p.primary, secondary: p.secondary }).id, p.id);
  }
  assert.equal(findPreset({ primary: '#000001', secondary: '#000002' }), null);
});

test('color helpers convert and mix', () => {
  assert.deepEqual(hexToRgb('#ff8000'), { r: 255, g: 128, b: 0 });
  assert.equal(rgbToHex({ r: 300, g: -5, b: 15.6 }), '#ff0010');
  assert.equal(mixColors('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixColors('#000000', '#ffffff', 2), '#ffffff');
  assert.throws(() => hexToRgb('blue'), TypeError);
});

test('ensureVisible lifts dark colors but keeps bright ones', () => {
  assert.equal(ensureVisible('#ffffff'), '#ffffff');
  assert.equal(ensureVisible('#000000'), '#3c3c3c');
  const lifted = hexToRgb(ensureVisible('#100000'));
  assert.ok(lifted.r > 0x10 && lifted.g === 0);
});

test('screen sampling averages left and right halves', () => {
  const w = 4, h = 2;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const left = x < 2;
      data.set(left ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
    }
  }
  assert.equal(averageRegion(data, w, h, 0, 2), '#ff0000');
  const { primary, secondary } = sampleEdgeColors(data, w, h);
  assert.equal(primary, '#ff0000');
  assert.equal(hexToRgb(secondary).b, 255);
  assert.equal(averageRegion(new Uint8ClampedArray(16), 2, 2), '#000000'); // all transparent
});

test('audio level is bounded and bass-weighted', () => {
  assert.equal(computeLevel(new Uint8Array(0)), 0);
  assert.equal(computeLevel(new Uint8Array(64)), 0);
  assert.equal(computeLevel(new Uint8Array(64).fill(255)), 1);
  const bass = new Uint8Array(64); bass.fill(255, 0, 16);
  const treble = new Uint8Array(64); treble.fill(255, 16);
  assert.ok(computeLevel(bass) > 0.99);
  assert.equal(computeLevel(treble), 0);
});

test('smoothLevel rises fast and falls slowly', () => {
  assert.equal(smoothLevel(0, 1), 0.5);
  assert.ok(Math.abs(smoothLevel(1, 0) - 0.92) < 1e-9);
});

test('frameState: still mode never moves', () => {
  const s = { ...DEFAULTS, motion: 'still', glow: 50, thickness: 10 };
  const a = frameState(s, { time: 0 });
  const b = frameState(s, { time: 5000, level: 1 });
  assert.deepEqual(a, b);
  assert.equal(a.intensity, 0.5);
  assert.equal(a.angle, 0);
});

test('frameState: animated mode rotates unless reduced motion is requested', () => {
  const s = { ...DEFAULTS, motion: 'animated', speed: 50 };
  assert.ok(frameState(s, { time: 1000 }).angle > 0);
  assert.equal(frameState(s, { time: 1000, reducedMotion: true }).angle, 0);
  const faster = frameState({ ...s, speed: 100 }, { time: 1000 }).angle;
  assert.ok(faster > frameState(s, { time: 1000 }).angle);
});

test('frameState: music mode follows level', () => {
  const s = { ...DEFAULTS, motion: 'music', glow: 100, thickness: 10 };
  const quiet = frameState(s, { level: 0 });
  const loud = frameState(s, { level: 1 });
  assert.ok(loud.intensity > quiet.intensity);
  assert.ok(loud.thickness > quiet.thickness);
  const calm = frameState(s, { level: 1, reducedMotion: true });
  assert.equal(calm.thickness, 10); // no thickness pulsing under reduced motion
  assert.equal(calm.angle, 0);
  assert.equal(frameState(s, { level: 9, beat: 9 }).intensity, 1); // clamped
});

test('gradientCss handles solid and gradient modes', () => {
  assert.equal(gradientCss({ ...DEFAULTS, colorMode: 'solid', primary: '#112233' }), '#112233');
  const css = gradientCss({ ...DEFAULTS, primary: '#111111', secondary: '#222222', balance: 70 }, 45);
  assert.equal(css, 'conic-gradient(from 45deg, #111111 0%, #222222 70%, #111111 100%)');
});

test('theme cycles and errors are explained', () => {
  assert.equal(nextTheme('system'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'system');
  assert.match(describeMediaError({ name: 'NotAllowedError' }, 'Microphone'), /declined/);
  assert.match(describeMediaError({ name: 'NotFoundError' }, 'Microphone'), /No microphone/);
  assert.match(describeMediaError(new Error('boom'), 'Screen sharing'), /boom/);
});

test('HSV conversion round-trips and handles greys', async () => {
  const { hexToHsv, hsvToHex } = await import('../src/core.js');
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#7c6cff', '#3dffa8', '#123456']) {
    assert.equal(hsvToHex(hexToHsv(hex)), hex);
  }
  assert.deepEqual(hexToHsv('#808080').s, 0);
  assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), '#00ff00');
  assert.equal(hsvToHex({ h: 480, s: 1, v: 1 }), '#00ff00'); // hue wraps
});
