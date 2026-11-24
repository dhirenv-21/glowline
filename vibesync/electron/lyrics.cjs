// Lyrics for the full-screen view, from LRCLIB (https://lrclib.net): a free, open lyrics
// database with no account or API key. Only the track title, artist, album and length are
// sent; never audio. Results (including "not found") are cached on this PC.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const API = 'https://lrclib.net/api';
const USER_AGENT = 'VibeSync/0.5 (personal desktop app)';
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000; // retry misses after a day

/** Parse LRC text into [{ t: seconds, text }] sorted by time. Handles several stamps per line and [offset:]. */
function parseLrc(lrc) {
  const lines = [];
  let offset = 0;
  for (const raw of String(lrc ?? '').split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const t = Number(m[1]) * 60 + Number(m[2].replace(':', '.'));
      if (Number.isFinite(t)) lines.push({ t, text });
    }
  }
  return lines
    .map((l) => ({ t: Math.max(0, Math.round((l.t - offset) * 100) / 100), text: l.text }))
    .sort((a, b) => a.t - b.t);
}

/** Index of the line that should be highlighted at `position` seconds (-1 before the first line). */
function activeLineIndex(lines, position) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= position) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Strip decorations Spotify adds to titles so searches match: " - From "…"", "(feat. …)", "- Remastered 2011". */
function cleanTitle(title) {
  return String(title ?? '')
    .replace(/\s+-\s+(from|remaster(ed)?|live|radio edit|single version|mono|stereo)\b.*$/i, '')
    .replace(/\s*[([](feat\.?|ft\.?|with)\s[^)\]]*[)\]]/gi, '')
    .trim();
}

function primaryArtist(artist) {
  return String(artist ?? '').split(/,|&| feat\.? | x /i)[0].trim();
}

function cacheKey({ artist, title }) {
  return crypto.createHash('sha1').update(`${primaryArtist(artist).toLowerCase()}|${cleanTitle(title).toLowerCase()}`).digest('hex');
}

function toResult(rec) {
  if (!rec) return null;
  if (rec.instrumental) return { status: 'instrumental' };
  const synced = rec.syncedLyrics ? parseLrc(rec.syncedLyrics).filter((l, i, a) => l.text || (a[i + 1] && a[i + 1].t - l.t > 4)) : [];
  if (synced.length) return { status: 'synced', lines: synced };
  if (rec.plainLyrics) return { status: 'plain', text: rec.plainLyrics.trim() };
  return null;
}

async function request(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`LRCLIB returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Pick the best search hit: prefer synced lyrics and a duration within a few seconds. */
function pickBest(hits, duration) {
  if (!Array.isArray(hits) || hits.length === 0) return null;
  const score = (h) => (h.syncedLyrics ? 0 : 50) + (duration ? Math.abs((h.duration ?? 0) - duration) : 0) + (h.instrumental ? 100 : 0);
  const best = [...hits].sort((a, b) => score(a) - score(b))[0];
  if (duration && best.duration && Math.abs(best.duration - duration) > 12) return null;
  return best;
}

/**
 * Look up lyrics. Returns { status: 'synced'|'plain'|'instrumental'|'none'|'error'|'needs-consent', lines?, text?, message? }.
 * With `allowNetwork: false` only the local cache is consulted; if the song isn't cached the
 * result is { status: 'needs-consent' } and nothing is sent anywhere.
 */
async function getLyrics(track, { cacheDir, fetchImpl = globalThis.fetch, timeoutMs = 8000, allowNetwork = true } = {}) {
  const title = String(track?.title ?? '').trim();
  const artist = String(track?.artist ?? '').trim();
  if (!title) return { status: 'none' };
  const file = cacheDir ? path.join(cacheDir, `${cacheKey({ artist, title })}.json`) : null;
  if (file) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cached.status !== 'none' || Date.now() - cached.savedAt < NOT_FOUND_TTL_MS) return { ...cached, cached: true };
    } catch { /* no cache yet */ }
  }
  if (!allowNetwork) return { status: 'needs-consent' };
  const duration = Math.round(Number(track?.duration) || 0);
  try {
    let rec = null;
    const exact = new URLSearchParams({ track_name: title, artist_name: artist });
    if (track?.album) exact.set('album_name', track.album);
    if (duration) exact.set('duration', String(duration));
    rec = await request(`${API}/get?${exact}`, fetchImpl, timeoutMs);
    let result = toResult(rec);
    if (!result) {
      const q = new URLSearchParams({ track_name: cleanTitle(title), artist_name: primaryArtist(artist) });
      result = toResult(pickBest(await request(`${API}/search?${q}`, fetchImpl, timeoutMs), duration));
    }
    const out = result ?? { status: 'none' };
    if (file) {
      try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ ...out, savedAt: Date.now() })); } catch { /* cache is optional */ }
    }
    return out;
  } catch (err) {
    return { status: 'error', message: err.name === 'AbortError' ? 'Lyrics lookup timed out.' : err.message };
  }
}

module.exports = { parseLrc, activeLineIndex, cleanTitle, primaryArtist, pickBest, getLyrics, USER_AGENT };
