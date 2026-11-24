// Glowline desktop shell (Electron main process).
'use strict';

const { app, BrowserWindow, ipcMain, screen, session, desktopCapturer, globalShortcut, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { watchSpotify } = require('./spotify.cjs');
const { startMediaWatcher } = require('./media.cjs');
const { getLyrics } = require('./lyrics.cjs');

const ROOT = path.join(__dirname, '..');
const PRELOAD = path.join(__dirname, 'preload.cjs');
const SELFTEST = process.argv.find((a) => a.startsWith('--selftest'));
const SELFTEST_OUT = (process.argv.find((a) => a.startsWith('--selftest-out=')) || '').split('=')[1] || '';
const OVERLAY_SHORTCUT = 'Control+Alt+G';

let control = null;
/** @type {Map<number, BrowserWindow>} */
const overlays = new Map();
let pendingCapture = null;
let spotifyStatus = { state: 'unknown', title: null };
let stopSpotify = null;
let media = null;
let lastMedia = { type: 'media', session: false };
let lastArt = null;

// Self-test runs use their own profile so they never touch (or collide with) your real settings.
if (SELFTEST) app.setPath('userData', path.join(app.getPath('temp'), 'glowline-selftest'));
else if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (control) { if (control.isMinimized()) control.restore(); control.focus(); }
});

const webPreferences = {
  preload: PRELOAD,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  backgroundThrottling: false, // keep analysing audio while the control window is minimized
};

function createControlWindow() {
  control = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    title: 'Glowline',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    // Dark, frameless title bar with native Windows buttons drawn over the page.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#f4f4f6', height: 44 },
    show: true,
    webPreferences,
  });
  control.loadFile(path.join(ROOT, 'index.html'));
  // Links (if any) open in the default browser, never inside the app.
  control.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  control.webContents.on('will-navigate', (e) => e.preventDefault());
  control.on('closed', () => {
    control = null;
    app.quit();
  });
}

// ---------- Edge-glow overlay windows ----------
function createOverlay(display) {
  const win = new BrowserWindow({
    ...display.bounds,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    title: 'Glowline overlay',
    webPreferences,
  });
  win.setIgnoreMouseEvents(true); // clicks pass straight through to the apps underneath
  win.setAlwaysOnTop(true, 'screen-saver');
  // Hide the overlay from screen capture so screen-colour sampling never sees its own glow.
  if (!SELFTEST) win.setContentProtection(true);
  win.loadFile(path.join(ROOT, 'overlay.html'));
  win.once('ready-to-show', () => {
    win.setBounds(display.bounds); // re-apply after load to get per-monitor DPI right
    win.showInactive();
  });
  win.on('closed', () => overlays.delete(display.id));
  overlays.set(display.id, win);
  return win;
}

function setOverlay({ enabled, displayIds }) {
  const displays = screen.getAllDisplays();
  const wanted = new Set(
    enabled
      ? (displayIds?.length ? displayIds.map(Number) : [screen.getPrimaryDisplay().id]).filter((id) => displays.some((d) => d.id === id))
      : [],
  );
  for (const [id, win] of overlays) {
    if (!wanted.has(id)) win.destroy();
  }
  for (const d of displays) {
    if (wanted.has(d.id) && !overlays.has(d.id)) createOverlay(d);
  }
  const state = { enabled: wanted.size > 0, displayIds: [...wanted] };
  control?.webContents.send('overlay:state', state);
  return state;
}

function refitOverlays() {
  for (const d of screen.getAllDisplays()) overlays.get(d.id)?.setBounds(d.bounds);
  for (const [id, win] of overlays) {
    if (!screen.getAllDisplays().some((d) => d.id === id)) win.destroy();
  }
}

function describeDisplays() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    scaleFactor: d.scaleFactor,
    primary: d.id === primary,
    internal: !!d.internal,
  }));
}

// ---------- Capture & permissions ----------
function installCaptureHandlers() {
  const ses = session.defaultSession;

  // Glowline never asks for the microphone or camera ('media' is always denied). The only
  // capture it allows is 'display-capture', and only right after a Glowline control declared
  // what it is for (system-audio loopback or screen colour sampling).
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'display-capture') return callback(pendingCapture !== null);
    callback(permission === 'fullscreen');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');

  // getDisplayMedia() in the renderer lands here. The renderer first declares (via IPC) whether
  // it wants system-audio loopback or a screen for colour sampling, triggered by a button press.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const want = pendingCapture;
    pendingCapture = null;
    try {
      if (!want) throw new Error('No capture was requested by a Glowline control.');
      if (want.kind === 'system-audio') {
        if (process.platform !== 'win32') throw new Error('System audio loopback is only supported on Windows in this build.');
        // getDisplayMedia needs a video track. Use Glowline's own page (an in-process capture)
        // rather than the desktop, so loopback never depends on Windows desktop duplication,
        // which fails while the display sleeps or on some hybrid-GPU laptops. The renderer
        // stops this video track immediately and keeps only the WASAPI loopback audio.
        callback({ video: request.frame, audio: 'loopback' });
        return;
      }
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      if (sources.length === 0) throw new Error('No screen sources are available.');
      const source = sources.find((s) => String(s.display_id) === String(want.displayId)) ?? sources[0];
      callback({ video: source });
    } catch (err) {
      console.warn('[glowline] capture refused:', err.message);
      callback({});
    }
  });
}

// ---------- IPC ----------
function installIpc() {
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    electron: process.versions.electron,
    systemAudioLoopback: process.platform === 'win32',
    overlaySupported: true,
    shortcut: OVERLAY_SHORTCUT.replace('Control', 'Ctrl'),
  }));
  ipcMain.handle('displays:list', () => describeDisplays());
  ipcMain.handle('capture:prepare', (_e, { kind, displayId }) => {
    if (!['system-audio', 'screen'].includes(kind)) return false;
    pendingCapture = { kind, displayId };
    setTimeout(() => { if (pendingCapture?.kind === kind) pendingCapture = null; }, 15000);
    return true;
  });
  ipcMain.handle('overlay:set', (_e, opts) => setOverlay(opts ?? {}));
  ipcMain.on('overlay:frame', (_e, frame) => {
    for (const win of overlays.values()) {
      if (!win.isDestroyed()) win.webContents.send('overlay:frame', frame);
    }
  });
  ipcMain.handle('spotify:get', () => spotifyStatus);
  ipcMain.handle('media:get', () => ({ ...lastMedia, art: lastArt }));
  ipcMain.handle('media:command', (_e, name) => media?.command(name) ?? false);
  ipcMain.handle('lyrics:get', (_e, track) => getLyrics(
    { title: track?.title, artist: track?.artist, album: track?.album, duration: track?.duration },
    { cacheDir: path.join(app.getPath('userData'), 'lyrics-cache') },
  ));
  ipcMain.on('window:theme', (_e, dark) => {
    try { control?.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f4f4f6' : '#111114', height: 44 }); } catch { /* not supported */ }
  });
}

// ---------- Self-test (used for automated verification; see README) ----------
async function runSelfTest() {
  const outDir = SELFTEST_OUT || app.getPath('temp');
  const report = await control.webContents.executeJavaScript('window.__glowlineSelfTest()', true);
  report.spotify = spotifyStatus;
  report.overlays = [...overlays.keys()];
  report.displays = describeDisplays();
  // Print the audio result first: screenshots are optional and capturePage() can stall when
  // the window is covered or the display is asleep.
  process.stdout.write(`SELFTEST ${JSON.stringify(report)}\n`);
  if (SELFTEST_OUT) {
    const within = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
    const save = async (name, getImage) => {
      try {
        fs.writeFileSync(path.join(outDir, name), (await within(getImage())).toPNG());
      } catch (err) {
        process.stdout.write(`SELFTEST-SCREENSHOT ${name}: ${err.message}\n`);
      }
    };
    fs.mkdirSync(outDir, { recursive: true });
    await save('selftest-control.png', () => control.webContents.capturePage());
    await within(control.webContents.executeJavaScript("const p = document.querySelector('#controls'); p.scrollTop = p.querySelector('#spotify-status').offsetTop - 80")).catch(() => {});
    await save('selftest-sources.png', () => control.webContents.capturePage());
    if (process.argv.includes('--selftest-fullscreen')) {
      await within(control.webContents.executeJavaScript("document.getElementById('stage').requestFullscreen()", true)).catch(() => {});
      await new Promise((r) => setTimeout(r, 3500)); // let lyrics load and scroll into place
      await save('selftest-fullscreen.png', () => control.webContents.capturePage());
      const lyricsState = await within(control.webContents.executeJavaScript(
        "({ note: document.getElementById('lyrics-note').textContent, lines: document.querySelectorAll('.lyric-line').length, active: document.querySelector('.lyric-line.active')?.textContent ?? null })",
      )).catch((e) => ({ error: e.message }));
      process.stdout.write(`SELFTEST-LYRICS ${JSON.stringify(lyricsState)}\n`);
      await within(control.webContents.executeJavaScript('document.exitFullscreen()')).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
    }
    // Real desktop capture (content protection is off in self-test) to show the overlay on screen.
    const d = screen.getPrimaryDisplay();
    await save('selftest-desktop.png', async () => {
      const [src] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: d.size.width, height: d.size.height } });
      if (!src) throw new Error('no screen source');
      return src.thumbnail;
    });
  }
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(() => {
  installCaptureHandlers();
  installIpc();
  createControlWindow();

  stopSpotify = watchSpotify((status) => {
    spotifyStatus = status;
    control?.webContents.send('spotify:status', status);
  });

  screen.on('display-added', () => control?.webContents.send('displays:changed', describeDisplays()));
  screen.on('display-removed', () => { refitOverlays(); control?.webContents.send('displays:changed', describeDisplays()); });
  screen.on('display-metrics-changed', () => { refitOverlays(); control?.webContents.send('displays:changed', describeDisplays()); });

  media = startMediaWatcher((msg) => {
    if (msg.type === 'media') {
      if (msg.session && msg.trackChanged) lastArt = msg.art ?? null;
      if (!msg.session) lastArt = null;
      lastMedia = msg;
    }
    control?.webContents.send('media:update', msg);
  });

  if (!globalShortcut.register(OVERLAY_SHORTCUT, () => control?.webContents.send('shortcut', 'toggle-overlay'))) {
    console.warn(`[glowline] ${OVERLAY_SHORTCUT} is in use by another app; use the on-screen toggle instead.`);
  }

  if (SELFTEST) control.webContents.once('did-finish-load', () => setTimeout(runSelfTest, 500));
  else control.webContents.once('did-finish-load', () => {
    control.webContents.executeJavaScript('window.__glowlineAutoStart?.()', true).catch(() => {});
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopSpotify?.();
  media?.stop();
});
app.on('window-all-closed', () => app.quit());
