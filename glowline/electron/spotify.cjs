// Local Spotify detection for Windows: reads the Spotify desktop app's window title with the
// built-in `tasklist` command. No Spotify account, API key or network access is involved.
// The title is "Spotify", "Spotify Free" or "Spotify Premium" when idle/paused, and
// "Artist - Track" (or e.g. "Advertisement") while something plays.
'use strict';

const { execFile } = require('node:child_process');

const IGNORED_TITLES = /^(N\/A|Default IME|MSCTFIME UI|OleMainThreadWndName|GDI\+ Window.*|)$/i;
const IDLE_TITLE = /^Spotify( Free| Premium)?$/i;

/** Split one CSV line as produced by `tasklist /fo csv`. */
function parseCsvLine(line) {
  const out = [];
  const re = /"((?:[^"]|"")*)"/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1].replace(/""/g, '"'));
  return out;
}

/**
 * Turn `tasklist /v /fo csv /nh /fi "imagename eq Spotify.exe"` output into a status.
 * @returns {{state:'not-running'|'idle'|'playing', title:string|null}}
 */
function parseSpotifyTasklist(text) {
  const rows = String(text ?? '')
    .split(/\r?\n/)
    .map(parseCsvLine)
    .filter((f) => f.length >= 9 && /^spotify\.exe$/i.test(f[0]));
  if (rows.length === 0) return { state: 'not-running', title: null };
  const title = rows.map((f) => f[8].trim()).find((t) => !IGNORED_TITLES.test(t)) ?? null;
  return classifySpotifyTitle(title);
}

function classifySpotifyTitle(title) {
  if (!title || IDLE_TITLE.test(title)) return { state: 'idle', title: title || null };
  return { state: 'playing', title };
}

function querySpotify() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ state: 'unsupported', title: null });
      return;
    }
    execFile(
      'tasklist',
      ['/v', '/fo', 'csv', '/nh', '/fi', 'imagename eq Spotify.exe'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => resolve(err ? { state: 'error', title: null } : parseSpotifyTasklist(stdout)),
    );
  });
}

/** Poll Spotify's state and call onChange only when it changes. Returns a stop function. */
function watchSpotify(onChange, intervalMs = 2500) {
  let last = '';
  let stopped = false;
  let timer = null;
  const tick = async () => {
    const status = await querySpotify();
    if (stopped) return;
    const key = `${status.state}|${status.title}`;
    if (key !== last) {
      last = key;
      onChange(status);
    }
    timer = setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

module.exports = { parseCsvLine, parseSpotifyTasklist, classifySpotifyTitle, querySpotify, watchSpotify };
