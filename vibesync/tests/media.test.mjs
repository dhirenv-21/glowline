import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { extractPalette, hexToHsv } from '../src/core.js';

const require = createRequire(import.meta.url);
const { parseMediaLine, COMMANDS } = require('../electron/media.cjs');

// Shape captured from the real helper on Windows 11 with Spotify playing.
const real = '{"art":"data:image/png;base64,iVBORw0KGgo=","type":"media","artist":"Sabrina Carpenter","session":true,"canNext":true,"app":"SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify","title":"Espresso","canPrevious":true,"position":115.9,"duration":190.1,"trackChanged":true,"status":"playing","album":"Espresso"}';

test('parses a real now-playing line', () => {
  const m = parseMediaLine(real);
  assert.equal(m.type, 'media');
  assert.equal(m.session, true);
  assert.equal(m.title, 'Espresso');
  assert.equal(m.artist, 'Sabrina Carpenter');
  assert.equal(m.status, 'playing');
  assert.equal(m.duration, 190.1);
  assert.equal(m.art, 'data:image/png;base64,iVBORw0KGgo=');
});

test('art is only reported on track changes and must be an image data URL', () => {
  const same = JSON.parse(real); same.trackChanged = false;
  assert.equal(parseMediaLine(JSON.stringify(same)).art, undefined);
  const evil = JSON.parse(real); evil.art = 'https://example.com/track.png';
  assert.equal(parseMediaLine(JSON.stringify(evil)).art, null);
  const script = JSON.parse(real); script.art = 'data:text/html;base64,PHNjcmlwdD4=';
  assert.equal(parseMediaLine(JSON.stringify(script)).art, null);
});

test('no session, errors and garbage', () => {
  assert.deepEqual(parseMediaLine('{"type":"media","session":false}'), { type: 'media', session: false });
  assert.deepEqual(parseMediaLine('{"type":"error","message":"boom"}'), { type: 'error', message: 'boom' });
  assert.equal(parseMediaLine('not json'), null);
  assert.equal(parseMediaLine('{"type":"other"}'), null);
  const odd = parseMediaLine('{"type":"media","session":true,"status":"exploding","position":"x"}');
  assert.equal(odd.status, 'unknown');
  assert.equal(odd.position, 0);
});

test('only the three transport commands are allowed', () => {
  assert.deepEqual([...COMMANDS].sort(), ['next', 'play-pause', 'previous']);
});

const pixels = (...groups) => Uint8ClampedArray.from(groups.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b, 255]).flat()));

test('extractPalette picks the two strongest distinct hues and lifts them', () => {
  const data = pixels([230, 40, 40, 60], [30, 60, 220, 30], [10, 10, 10, 10]);
  const { primary, secondary } = extractPalette(data, 100, 1);
  assert.ok(Math.abs(hexToHsv(primary).h - 0) < 10 || hexToHsv(primary).h > 350);
  assert.ok(Math.abs(hexToHsv(secondary).h - 230) < 15);
  assert.ok(hexToHsv(primary).v >= 0.85);
});

test('extractPalette handles single-hue and greyscale covers', () => {
  const single = extractPalette(pixels([200, 40, 160, 50]), 50, 1);
  assert.notEqual(single.primary, single.secondary);
  const grey = extractPalette(pixels([128, 128, 128, 50]), 50, 1);
  assert.ok(hexToHsv(grey.primary).v > 0.9, 'black-and-white covers get a bright neutral glow');
  // Mostly black cover with a few bronze highlights (like the Black Panther soundtrack): use the bronze.
  const sparse = extractPalette(pixels([5, 5, 5, 990], [180, 120, 60, 10]), 1000, 1);
  const hue = hexToHsv(sparse.primary).h;
  assert.ok(hue > 15 && hue < 45, `expected a bronze hue, got ${sparse.primary}`);
  const empty = extractPalette(new Uint8ClampedArray(16), 2, 2);
  assert.ok(empty.primary && empty.secondary);
});
