import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeLineIndex as activeEsm } from '../src/core.js';

const require = createRequire(import.meta.url);
const { parseLrc, activeLineIndex, cleanTitle, primaryArtist, pickBest, getLyrics, USER_AGENT } = require('../electron/lyrics.cjs');

test('parseLrc reads stamps, repeats, offsets and ignores metadata', () => {
  const lines = parseLrc('[ar:Someone]\n[offset:+500]\n[00:01.50]Hello\n[00:10.00][00:20.00]Chorus\n[01:02.3]Bye\nno stamp');
  assert.deepEqual(lines, [
    { t: 1, text: 'Hello' }, { t: 9.5, text: 'Chorus' }, { t: 19.5, text: 'Chorus' }, { t: 61.8, text: 'Bye' },
  ]);
  assert.deepEqual(parseLrc(''), []);
});

test('activeLineIndex (both copies) finds the current line', () => {
  const lines = [{ t: 1 }, { t: 5 }, { t: 9 }];
  for (const fn of [activeLineIndex, activeEsm]) {
    assert.equal(fn(lines, 0), -1);
    assert.equal(fn(lines, 1), 0);
    assert.equal(fn(lines, 6), 1);
    assert.equal(fn(lines, 100), 2);
    assert.equal(fn([], 3), -1);
  }
});

test('Spotify title clean-up for searching', () => {
  assert.equal(cleanTitle('All The Stars (with SZA) - From "Black Panther: The Album"'), 'All The Stars');
  assert.equal(cleanTitle('Song (feat. Someone)'), 'Song');
  assert.equal(cleanTitle('Classic - Remastered 2011'), 'Classic');
  assert.equal(cleanTitle('Espresso'), 'Espresso');
  assert.equal(primaryArtist('Lady Gaga, Bruno Mars'), 'Lady Gaga');
});

test('pickBest prefers synced lyrics with a matching duration', () => {
  const hits = [
    { duration: 200, plainLyrics: 'a' },
    { duration: 251, syncedLyrics: '[00:01.00]x' },
    { duration: 400, syncedLyrics: '[00:01.00]y' },
  ];
  assert.equal(pickBest(hits, 250).duration, 251);
  assert.equal(pickBest([{ duration: 400, syncedLyrics: 'x' }], 250), null);
  assert.equal(pickBest([], 250), null);
});

function fakeFetch(routes, calls) {
  return async (url, opts) => {
    calls.push({ url, ua: opts.headers['User-Agent'] });
    for (const [pattern, body] of routes) {
      if (url.includes(pattern)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('getLyrics: exact match, caching, and only track metadata is sent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vibesync-lyrics-'));
  try {
    const calls = [];
    const fetchImpl = fakeFetch([['/api/get?', { syncedLyrics: '[00:01.00]Line one\n[00:04.00]Line two' }]], calls);
    const track = { title: 'Song', artist: 'Artist', album: 'Album', duration: 180.4 };
    const first = await getLyrics(track, { cacheDir: dir, fetchImpl });
    assert.equal(first.status, 'synced');
    assert.equal(first.lines.length, 2);
    const params = new URL(calls[0].url).searchParams;
    assert.deepEqual(Object.fromEntries(params), { track_name: 'Song', artist_name: 'Artist', album_name: 'Album', duration: '180' });
    assert.equal(calls[0].ua, USER_AGENT);
    const second = await getLyrics(track, { cacheDir: dir, fetchImpl });
    assert.equal(second.cached, true);
    assert.equal(calls.length, 1, 'served from cache');
    assert.equal(readdirSync(dir).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('getLyrics: falls back to search, handles instrumental, none and network errors', async () => {
  const calls = [];
  const viaSearch = await getLyrics({ title: 'Hit (feat. X) - From "Movie"', artist: 'A, B', duration: 200 },
    { fetchImpl: fakeFetch([['/api/search?', [{ duration: 201, syncedLyrics: '[00:02.00]Found' }]]], calls) });
  assert.equal(viaSearch.status, 'synced');
  const q = new URL(calls[1].url).searchParams;
  assert.equal(q.get('track_name'), 'Hit');
  assert.equal(q.get('artist_name'), 'A');

  const inst = await getLyrics({ title: 'Calm', artist: 'Z' }, { fetchImpl: fakeFetch([['/api/get?', { instrumental: true }]], []) });
  assert.equal(inst.status, 'instrumental');
  const none = await getLyrics({ title: 'Nope', artist: 'Z' }, { fetchImpl: fakeFetch([], []) });
  assert.equal(none.status, 'none');
  const err = await getLyrics({ title: 'X', artist: 'Y' }, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(err, { status: 'error', message: 'offline' });
  assert.deepEqual(await getLyrics({ title: '' }), { status: 'none' });
});

test('getLyrics with allowNetwork:false never calls the network', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vibesync-lyrics-'));
  try {
    const calls = [];
    const fetchImpl = fakeFetch([['/api/get?', { syncedLyrics: '[00:01.00]Hello' }]], calls);
    const track = { title: 'Song', artist: 'Artist', duration: 120 };
    // Not cached yet: cache-only lookup asks for consent and sends nothing.
    assert.deepEqual(await getLyrics(track, { cacheDir: dir, fetchImpl, allowNetwork: false }), { status: 'needs-consent' });
    assert.equal(calls.length, 0);
    // After an approved lookup, the cached answer is available without the network.
    await getLyrics(track, { cacheDir: dir, fetchImpl, allowNetwork: true });
    assert.equal(calls.length, 1);
    const cached = await getLyrics(track, { cacheDir: dir, fetchImpl, allowNetwork: false });
    assert.equal(cached.status, 'synced');
    assert.equal(cached.cached, true);
    assert.equal(calls.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
