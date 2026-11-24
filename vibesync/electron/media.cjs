// "Now playing" for Spotify via Windows' Global System Media Transport Controls.
// Runs electron/media-helper.ps1 (Windows PowerShell, built in) as a long-lived child process.
// Everything stays local: no network, no Spotify account or API key.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const COMMANDS = new Set(['play-pause', 'next', 'previous']);

/** Parse one JSON line from the helper. Returns null for anything that isn't a known message. */
function parseMediaLine(line) {
  let msg;
  try { msg = JSON.parse(String(line).trim()); } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type === 'error') return { type: 'error', message: String(msg.message ?? 'unknown error') };
  if (msg.type !== 'media') return null;
  if (!msg.session) return { type: 'media', session: false };
  const str = (v) => (typeof v === 'string' ? v : '');
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const art = typeof msg.art === 'string' && /^data:image\/(png|jpeg|jpg|webp|bmp|gif);base64,[A-Za-z0-9+/=]+$/.test(msg.art) ? msg.art : null;
  return {
    type: 'media',
    session: true,
    app: str(msg.app),
    status: ['playing', 'paused', 'stopped', 'changing', 'opened', 'closed'].includes(msg.status) ? msg.status : 'unknown',
    title: str(msg.title),
    artist: str(msg.artist),
    album: str(msg.album),
    position: num(msg.position),
    duration: num(msg.duration),
    canNext: !!msg.canNext,
    canPrevious: !!msg.canPrevious,
    trackChanged: !!msg.trackChanged,
    art: msg.trackChanged ? art : undefined, // undefined = unchanged
  };
}

/**
 * Start the helper. onUpdate(msg) receives parsed messages.
 * Returns { command(name), stop() }. Restarts the helper (with back-off) if it exits.
 */
function startMediaWatcher(onUpdate, { helperDir = __dirname } = {}) {
  if (process.platform !== 'win32') {
    onUpdate({ type: 'unsupported' });
    return { command: () => false, stop: () => {} };
  }
  // Inside a packaged app the helper lives in app.asar.unpacked (PowerShell can't read the archive).
  const dir = helperDir.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1').replace(/app\.asar$/, 'app.asar.unpacked');
  const script = path.join(dir, 'media-helper.ps1');
  let child = null;
  let stopped = false;
  let restarts = 0;
  let timer = null;
  let buffer = '';

  const launch = () => {
    buffer = '';
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const msg = parseMediaLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (msg) { restarts = 0; onUpdate(msg); }
      }
      if (buffer.length > 8 * 1024 * 1024) buffer = ''; // guard against a runaway line
    });
    child.on('error', (err) => onUpdate({ type: 'error', message: `Media helper failed to start: ${err.message}` }));
    child.on('exit', () => {
      child = null;
      if (stopped) return;
      restarts += 1;
      if (restarts > 5) {
        onUpdate({ type: 'error', message: 'Media helper keeps stopping; cover art and playback controls are unavailable.' });
        return;
      }
      timer = setTimeout(launch, Math.min(30000, 1000 * 2 ** restarts));
    });
  };
  launch();

  return {
    command(name) {
      if (!COMMANDS.has(name) || !child) return false;
      child.stdin.write(`${name}\n`);
      return true;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (child) {
        try { child.stdin.write('quit\n'); } catch { /* already closed */ }
        const c = child;
        setTimeout(() => { if (c.exitCode === null) c.kill(); }, 1500);
      }
    },
  };
}

module.exports = { parseMediaLine, startMediaWatcher, COMMANDS };
