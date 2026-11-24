// Static accessibility and wiring checks on index.html (no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS, ENUMS } from '../src/core.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('every form control has an accessible name', () => {
  const controls = html.match(/<(input|select)\b[^>]*>/g) ?? [];
  assert.ok(controls.length > 10);
  for (const tag of controls) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const labelledByFor = id && html.includes(`for="${id}"`);
    const wrapped = /type="(radio|color|file|checkbox)"/.test(tag); // these are wrapped in <label> elements
    const aria = /aria-label=/.test(tag);
    assert.ok(labelledByFor || wrapped || aria, `unlabelled control: ${tag}`);
  }
});

test('every setting key has a matching control, and every enum value a radio or handler', () => {
  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'theme') { assert.match(html, /id="theme-toggle"/); continue; }
    assert.match(html, new RegExp(`name="${key}"`), key);
  }
  for (const key of ['colorMode', 'motion']) {
    const start = html.search(new RegExp(`<select[^>]*name="${key}"`));
    const select = start < 0 ? '' : html.slice(start, html.indexOf('</select>', start));
    for (const v of ENUMS[key]) assert.match(select, new RegExp(`<option value="${v}"`), `${key}=${v}`);
  }
});

test('page has a live status region, stop controls, and a limitations note', () => {
  assert.match(html, /role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="screen-stop"/);
  assert.match(html, /id="audio-stop"/);
  assert.match(html, /id="system-audio-start"/);
  assert.match(html, /id="system-audio-stop"/);
  assert.match(html, /id="audio-detect"/);
  assert.match(html, /id="spotify-status"/);
  assert.match(html, /can't separate Spotify's sound/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /<html lang="en">/);
});

test('the microphone is never requested', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /getUserMedia/);
  assert.doesNotMatch(html, /microphone"|mic-start/i);
  const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  // Only the control window may ask for anything; display capture needs a fresh, one-shot permit;
  // every other permission (including 'media' = microphone/camera) is refused.
  assert.ok(main.includes('if (!isControlContents(wc)) return callback(false);'));
  assert.ok(main.includes("if (permission === 'display-capture') return callback(!!pendingCapture && pendingCapture.expires > Date.now());"));
  assert.ok(main.includes("callback(permission === 'fullscreen');"));
});
