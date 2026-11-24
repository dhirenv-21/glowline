import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseCsvLine, parseSpotifyTasklist, classifySpotifyTitle } = require('../electron/spotify.cjs');

const row = (pid, title) => `"Spotify.exe","${pid}","Console","1","150,000 K","Running","PC\\\\me","0:00:10","${title}"`;

test('parseCsvLine handles quotes and commas', () => {
  assert.deepEqual(parseCsvLine('"a","b, c","say ""hi"""'), ['a', 'b, c', 'say "hi"']);
});

test('not running', () => {
  assert.deepEqual(parseSpotifyTasklist('INFO: No tasks are running which match the specified criteria.\r\n'), { state: 'not-running', title: null });
  assert.deepEqual(parseSpotifyTasklist(''), { state: 'not-running', title: null });
});

test('idle Spotify (real output shape captured on Windows 11)', () => {
  const out = [row(5724, 'Spotify Premium'), row(30540, 'N/A'), row(35512, 'OleMainThreadWndName'), row(35752, 'N/A')].join('\r\n');
  assert.deepEqual(parseSpotifyTasklist(out), { state: 'idle', title: 'Spotify Premium' });
  assert.equal(classifySpotifyTitle('Spotify Free').state, 'idle');
  assert.equal(classifySpotifyTitle('Spotify').state, 'idle');
});

test('playing Spotify reports the window title', () => {
  const out = [row(1, 'N/A'), row(2, 'Daft Punk - One More Time'), row(3, 'OleMainThreadWndName')].join('\n');
  assert.deepEqual(parseSpotifyTasklist(out), { state: 'playing', title: 'Daft Punk - One More Time' });
  assert.equal(classifySpotifyTitle('Advertisement').state, 'playing');
});

test('running without a visible window counts as idle', () => {
  assert.deepEqual(parseSpotifyTasklist([row(1, 'N/A'), row(2, 'N/A')].join('\n')), { state: 'idle', title: null });
});
