// Glowline desktop shell (Electron main process).
'use strict';

const { app, BrowserWindow, ipcMain, screen, session, desktopCapturer, globalShortcut, shell, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const guard = require('./ipc-guard.cjs');
const { watchSpotify } = require('./spotify.cjs');
const { startMediaWatcher } = require('./media.cjs');
const { getLyrics } = require('./lyrics.cjs');

const ROOT = path.join(__dirname, '..');
const PRELOAD = path.join(__dirname, 'preload.cjs');
const SELFTEST = process.argv.find((a) => a.startsWith('--selftest'));
const SELFTEST_OUT = (process.argv.find((a) => a.startsWith('--selftest-out=')) || '').split('=')[1] || '';
const OVERLAY_SHORTCUT = 'Control+Alt+G';
const SHOTS_DIR = (process.argv.find((a) => a.startsWith('--screenshots=')) || '').split('=').slice(1).join('=');
const DEMO = process.argv.includes('--demo') || !!SHOTS_DIR;

let control = null;
/** @type {Map<number, BrowserWindow>} */
const overlays = new Map();
/** One-shot capture permit set by a Glowline control: { kind, displayId, expires }. */
let pendingCapture = null;
/** Settings sanitizer from src/core.js (ES module, loaded at startup). */
let sanitizeSettings = null;
let spotifyStatus = { state: 'unknown', title: null };
let stopSpotify = null;
let media = null;
let lastMedia = { type: 'media', session: false };
let lastArt = null;

// Self-test runs use their own profile so they never touch (or collide with) your real settings.
if (SELFTEST || DEMO) app.setPath('userData', path.join(app.getPath('temp'), DEMO ? 'glowline-demo' : 'glowline-selftest'));
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
    icon: path.join(ROOT, 'build', 'icon.png'),
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

// ---------- Who is allowed to talk to the main process ----------
function isControlContents(wc) {
  return !!control && !control.isDestroyed() && wc === control.webContents;
}

/** '' when the sender is the control window's top-level frame showing Glowline's own index.html; otherwise why not. */
function untrustedReason(event) {
  const frame = event?.senderFrame;
  if (!frame) return 'no sender frame';
  if (frame.parent) return 'sub-frame';                       // main frame only, never an iframe
  if (!control || control.isDestroyed()) return 'control window closed';
  if (!isControlContents(event.sender)) return `not the control window (webContents ${event.sender?.id} vs ${control.webContents.id})`;
  if (!guard.isAppPageUrl(frame.url, ROOT, ['index.html'])) return `unexpected page ${String(frame.url).slice(0, 80)}`;
  return '';
}
function isTrustedSender(event) { return untrustedReason(event) === ''; }

let lastRejectLog = 0;
function logRejected(channel, why) {
  if (why === 'control window closed') return; // normal during shutdown: a last frame in flight
  const now = Date.now();
  if (now - lastRejectLog < 2000) return; // don't let a misbehaving page flood the log
  lastRejectLog = now;
  console.warn(`[glowline] rejected ${channel}: ${why}`);
}

/** ipcMain.handle with a sender check. Untrusted callers get an error, nothing runs. */
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const why = untrustedReason(event);
    if (why) { logRejected(channel, why); throw new Error('Request rejected.'); }
    return fn(event, ...args);
  });
}

/** ipcMain.on with a sender check. Untrusted messages are dropped. */
function listen(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    const why = untrustedReason(event);
    if (why) { logRejected(channel, why); return; }
    fn(event, ...args);
  });
}

function takeCapturePermit() {
  const permit = pendingCapture;
  pendingCapture = null;
  return permit && permit.expires > Date.now() ? permit : null;
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

function setOverlay(request) {
  const { enabled, displayIds } = guard.validateOverlaySet(request);
  const displays = screen.getAllDisplays();
  const wanted = new Set(
    enabled
      ? (displayIds.length ? displayIds : [screen.getPrimaryDisplay().id]).filter((id) => displays.some((d) => d.id === id))
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
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    if (!isControlContents(wc)) return callback(false);
    if (permission === 'display-capture') return callback(!!pendingCapture && pendingCapture.expires > Date.now());
    callback(permission === 'fullscreen');
  });
  ses.setPermissionCheckHandler((wc, permission) => permission === 'fullscreen' && isControlContents(wc));

  // getDisplayMedia() in the renderer lands here. The renderer first declares (via IPC) whether
  // it wants system-audio loopback or a screen for colour sampling, triggered by a button press.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const want = takeCapturePermit();
    try {
      const frame = request.frame;
      const main = control && !control.isDestroyed() ? control.webContents.mainFrame : null;
      const fromControl = !!frame && !!main && frame.processId === main.processId && frame.routingId === main.routingId
        && guard.isAppPageUrl(frame.url, ROOT, ['index.html']);
      if (!fromControl) throw new Error('Capture requested by an unexpected page.');
      if (!want) throw new Error('No capture was requested by a Glowline control (or the request expired).');
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
  handle('app:info', () => ({
    platform: process.platform,
    electron: process.versions.electron,
    systemAudioLoopback: process.platform === 'win32',
    overlaySupported: true,
    shortcut: OVERLAY_SHORTCUT.replace('Control', 'Ctrl'),
    demo: DEMO,
  }));
  handle('displays:list', () => describeDisplays());
  handle('capture:prepare', (_e, payload) => {
    const req = guard.validateCapturePrepare(payload);
    if (!req) { logRejected('capture:prepare', 'invalid payload'); return false; }
    pendingCapture = { ...req, expires: Date.now() + 15000 }; // one capture, within 15 s
    return true;
  });
  handle('overlay:set', (_e, payload) => setOverlay(payload));
  listen('overlay:frame', (_e, payload) => {
    if (overlays.size === 0 || !sanitizeSettings) return;
    const frame = guard.sanitizeFrame(payload, sanitizeSettings);
    if (!frame) return;
    for (const win of overlays.values()) {
      if (!win.isDestroyed()) win.webContents.send('overlay:frame', frame);
    }
  });
  handle('spotify:get', () => spotifyStatus);
  handle('media:get', () => ({ ...lastMedia, art: lastArt }));
  handle('media:command', (_e, name) => {
    const cmd = guard.validateMediaCommand(name);
    if (!cmd) { logRejected('media:command', 'unknown command'); return false; }
    return media?.command(cmd) ?? false;
  });
  handle('lyrics:get', (_e, payload) => {
    const req = guard.validateLyricsRequest(payload);
    if (!req) return { status: 'none' };
    const { allowNetwork, ...track } = req;
    return getLyrics(track, { cacheDir: path.join(app.getPath('userData'), 'lyrics-cache'), allowNetwork });
  });
  listen('window:theme', (_e, dark) => {
    try { control?.setTitleBarOverlay({ color: '#00000000', symbolColor: dark === true ? '#f4f4f6' : '#111114', height: 44 }); } catch { /* not supported */ }
  });
}

// Every web page Glowline creates (control and overlays) may not open windows, navigate away
// or embed <webview>s.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
  wc.on('will-navigate', (ev) => ev.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

// ---------- Self-test (used for automated verification; see README) ----------
async function runSelfTest() {
  const outDir = SELFTEST_OUT || app.getPath('temp');
  if (process.argv.includes('--selftest-autostart')) {
    // Exercise the launch auto-start path exactly as the app uses it, then report what the UI says.
    const js = (code) => control.webContents.executeJavaScript(code, true);
    await js("document.getElementById('autoAudio').checked || document.getElementById('autoAudio').click()");
    const result = await js("window.__glowlineAutoStart('launch')");
    await new Promise((r) => setTimeout(r, 1500));
    const ui = await js(`({
      status: document.getElementById('status').textContent,
      chip: document.getElementById('live-chip').textContent,
      detection: document.getElementById('audio-detect-text').textContent,
      listenPressed: document.getElementById('dock-listen').getAttribute('aria-pressed'),
    })`);
    const again = await js("window.__glowlineAutoStart('resume')");
    await js("document.getElementById('system-audio-stop').click()");
    const stopped = await js("({ chip: document.getElementById('live-chip').textContent, status: document.getElementById('status').textContent, listenPressed: document.getElementById('dock-listen').getAttribute('aria-pressed') })");
    process.stdout.write(`SELFTEST-AUTOSTART ${JSON.stringify({ result, ui, secondCall: again, stopped })}\n`);
  }
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
        "({ note: document.getElementById('lyrics-note').textContent, consent: !document.getElementById('lyrics-consent').hidden, lines: document.querySelectorAll('.lyric-line').length, active: document.querySelector('.lyric-line.active')?.textContent ?? null })",
      )).catch((e) => ({ error: e.message }));
      process.stdout.write(`SELFTEST-LYRICS ${JSON.stringify(lyricsState)}\n`);
      await within(control.webContents.executeJavaScript('document.exitFullscreen()')).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
    }
    // Capture only the overlay window's own content (never the whole desktop, which can show
    // whatever private windows the user has open).
    const ov = overlays.values().next().value;
    if (ov && !ov.isDestroyed()) await save('selftest-overlay.png', () => ov.webContents.capturePage());
  }
  const ov = overlays.values().next().value;
  if (ov && !ov.isDestroyed()) {
    const overlayState = await ov.webContents.executeJavaScript(
      "({ framesReceived: window.__glowlineFrames ?? 0, gpu: document.documentElement.classList.contains('gl-on') })",
    ).catch((e) => ({ error: e.message }));
    process.stdout.write(`SELFTEST-OVERLAY ${JSON.stringify(overlayState)}\n`);
  }
  app.exit(report.ok ? 0 : 1);
}

// ---------- Marketing screenshots (`electron . --screenshots=<dir>`, uses demo mode) ----------
async function captureScreenshots() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code, gesture = false) => control.webContents.executeJavaScript(code, gesture).catch(() => null);
  const shot = async (name) => {
    const img = await control.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS_DIR, name), img.toPNG());
    process.stdout.write(`SCREENSHOT ${name} ${img.getSize().width}x${img.getSize().height}
`);
  };
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  control.setContentSize(1440, 900);
  control.center();
  await wait(3500);
  await shot('player.png');
  await js("document.getElementById('dock-settings').click(); document.activeElement.blur()");
  await wait(700);
  await shot('settings.png');
  await js("document.getElementById('sheet-close').click(); document.getElementById('dock-colors').click(); document.activeElement.blur()");
  await wait(700);
  await shot('colors.png');
  await js("document.getElementById('sheet-close').click()");
  await js("document.getElementById('stage').requestFullscreen()", true);
  await wait(3500);
  await shot('lyrics.png');
  await js('document.exitFullscreen()');
  await wait(500);
  app.exit(0);
}

app.whenReady().then(async () => {
  ({ sanitizeSettings } = await import(pathToFileURL(path.join(ROOT, 'src', 'core.js')).href));
  installCaptureHandlers();
  installIpc();
  createControlWindow();

  if (!DEMO) stopSpotify = watchSpotify((status) => {
    spotifyStatus = status;
    control?.webContents.send('spotify:status', status);
  });

  screen.on('display-added', () => control?.webContents.send('displays:changed', describeDisplays()));
  screen.on('display-removed', () => { refitOverlays(); control?.webContents.send('displays:changed', describeDisplays()); });
  screen.on('display-metrics-changed', () => { refitOverlays(); control?.webContents.send('displays:changed', describeDisplays()); });

  if (!DEMO) media = startMediaWatcher((msg) => {
    if (msg.type === 'media') {
      if (msg.session && msg.trackChanged) lastArt = msg.art ?? null;
      if (!msg.session) lastArt = null;
      lastMedia = msg;
    }
    control?.webContents.send('media:update', msg);
  });

  // Sleep, lock and resume can end Windows' loopback capture; tell the window so it can explain
  // what happened and (if auto-start is on) start listening again.
  for (const evt of ['suspend', 'resume', 'lock-screen', 'unlock-screen']) {
    powerMonitor.on(evt, () => control?.webContents.send('power', evt));
  }
  powerMonitor.on('resume', () => setTimeout(() => {
    control?.webContents.executeJavaScript('window.__glowlineAutoStart?.("resume")', true).catch(() => {});
  }, 2500));
  powerMonitor.on('unlock-screen', () => setTimeout(() => {
    control?.webContents.executeJavaScript('window.__glowlineAutoStart?.("unlock")', true).catch(() => {});
  }, 1500));

  if (!globalShortcut.register(OVERLAY_SHORTCUT, () => control?.webContents.send('shortcut', 'toggle-overlay'))) {
    console.warn(`[glowline] ${OVERLAY_SHORTCUT} is in use by another app; use the on-screen toggle instead.`);
  }

  if (SHOTS_DIR) control.webContents.once('did-finish-load', () => setTimeout(captureScreenshots, 300));
  else if (SELFTEST) control.webContents.once('did-finish-load', () => setTimeout(runSelfTest, 500));
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
