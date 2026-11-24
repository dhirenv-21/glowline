import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeSettings, DEFAULTS } from '../src/core.js';

const require = createRequire(import.meta.url);
const guard = require('../electron/ipc-guard.cjs');
const { COMMANDS } = require('../electron/media.cjs');

const ROOT = path.resolve('app-root');
const page = (name, extra = '') => pathToFileURL(path.join(ROOT, name)).href + extra;

test('isAppPageUrl accepts only the app’s own pages', () => {
  assert.equal(guard.isAppPageUrl(page('index.html'), ROOT, ['index.html']), true);
  assert.equal(guard.isAppPageUrl(page('index.html', '#x?y'), ROOT, ['index.html']), true);
  assert.equal(guard.isAppPageUrl(page('overlay.html'), ROOT, ['index.html']), false);
  assert.equal(guard.isAppPageUrl(page('../index.html'), ROOT, ['index.html']), false);
  assert.equal(guard.isAppPageUrl(pathToFileURL(path.resolve('elsewhere', 'index.html')).href, ROOT, ['index.html']), false);
  for (const bad of ['https://evil.example/index.html', 'data:text/html,hi', 'about:blank', '', null, undefined, 42, 'not a url']) {
    assert.equal(guard.isAppPageUrl(bad, ROOT, ['index.html']), false, String(bad));
  }
});

test('capture:prepare: only known kinds, bounded display ids', () => {
  assert.deepEqual(guard.validateCapturePrepare({ kind: 'system-audio', displayId: 2230904235 }), { kind: 'system-audio', displayId: 2230904235 });
  assert.deepEqual(guard.validateCapturePrepare({ kind: 'screen', displayId: '42' }), { kind: 'screen', displayId: 42 });
  assert.deepEqual(guard.validateCapturePrepare({ kind: 'screen' }), { kind: 'screen', displayId: null });
  assert.deepEqual(guard.validateCapturePrepare({ kind: 'screen', displayId: -1 }), { kind: 'screen', displayId: null });
  assert.deepEqual(guard.validateCapturePrepare({ kind: 'screen', displayId: { evil: 1 } }), { kind: 'screen', displayId: null });
  for (const bad of [null, undefined, 'system-audio', [], { kind: 'microphone' }, { kind: 'camera' }, { kind: ['screen'] }]) {
    assert.equal(guard.validateCapturePrepare(bad), null, JSON.stringify(bad));
  }
});

test('overlay:set: booleans only, unique ids, capped list', () => {
  assert.deepEqual(guard.validateOverlaySet({ enabled: true, displayIds: [1, '2', 2, -3, 'x', 1.5, null] }), { enabled: true, displayIds: [1, 2] });
  assert.deepEqual(guard.validateOverlaySet({ enabled: 'yes', displayIds: 'all' }), { enabled: false, displayIds: [] });
  assert.deepEqual(guard.validateOverlaySet(null), { enabled: false, displayIds: [] });
  const many = Array.from({ length: 10000 }, (_, i) => i);
  assert.equal(guard.validateOverlaySet({ enabled: true, displayIds: many }).displayIds.length, guard.LIMITS.maxDisplays);
});

test('media:command: only the three transport commands', () => {
  assert.deepEqual([...guard.MEDIA_COMMANDS].sort(), [...COMMANDS].sort(), 'guard and media helper agree');
  for (const ok of ['play-pause', 'next', 'previous']) assert.equal(guard.validateMediaCommand(ok), ok);
  for (const bad of ['quit', 'play-pause\nquit', 'NEXT', '', null, 1, { cmd: 'next' }]) {
    assert.equal(guard.validateMediaCommand(bad), null, JSON.stringify(bad));
  }
});

test('lyrics:get: text cleaned and capped, duration bounded, network needs explicit true', () => {
  const r = guard.validateLyricsRequest({ title: '  Song\u0000\nName ', artist: 'A'.repeat(1000), album: 7, duration: '185.2', allowNetwork: true });
  assert.equal(r.title, 'Song Name');
  assert.equal(r.artist.length, guard.LIMITS.maxText);
  assert.equal(r.album, '');
  assert.equal(r.duration, 185.2);
  assert.equal(r.allowNetwork, true);
  assert.equal(guard.validateLyricsRequest({ title: 'x', duration: 1e9 }).duration, 0);
  assert.equal(guard.validateLyricsRequest({ title: 'x', allowNetwork: 'true' }).allowNetwork, false);
  for (const bad of [null, 'title', [], { title: '' }, { title: '   ' }, { title: 5 }]) {
    assert.equal(guard.validateLyricsRequest(bad), null, JSON.stringify(bad));
  }
});

test('overlay:frame: only known fields survive, numbers clamped, settings sanitised', () => {
  const f = guard.sanitizeFrame({ level: 5, beat: -2, settings: { glow: 999, primary: 'javascript:alert(1)', extra: 'x' }, html: '<img onerror>' }, sanitizeSettings);
  assert.deepEqual(Object.keys(f).sort(), ['beat', 'level', 'settings']);
  assert.equal(f.level, 1);
  assert.equal(f.beat, 0);
  assert.equal(f.settings.glow, 100);
  assert.equal(f.settings.primary, DEFAULTS.primary);
  assert.equal('extra' in f.settings, false);
  assert.equal(guard.sanitizeFrame({ level: NaN, beat: 'loud' }, sanitizeSettings), null);
  assert.equal(guard.sanitizeFrame('frame', sanitizeSettings), null);
  assert.deepEqual(guard.sanitizeFrame({ level: 0.5 }, sanitizeSettings), { level: 0.5 });
});

test('main process: every preload channel goes through the sender-checked wrappers', async () => {
  const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const invoked = [...preload.matchAll(/ipcRenderer\.(invoke|send)\('([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.ok(invoked.length >= 10);
  for (const [kind, channel] of invoked) {
    const wrapper = kind === 'invoke' ? 'handle' : 'listen';
    assert.ok(main.includes(`${wrapper}('${channel}'`), `${channel} must be registered with ${wrapper}()`);
  }
  // Only the two wrappers may call ipcMain directly.
  assert.equal([...main.matchAll(/ipcMain\.(handle|on)\(/g)].length, 2);
  assert.match(main, /if \(!isTrustedSender\(event\)\)/);
  assert.match(main, /frame\.parent\) return false/);
  // Existing protections stay in place.
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /nodeIntegration: false/);
});
