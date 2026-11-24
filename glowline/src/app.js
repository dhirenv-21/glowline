import {
  DEFAULTS, PRESETS, sanitizeSettings, loadSettings, saveSettings, findPreset,
  sampleEdgeColors, computeLevel, computeRms, smoothLevel, frameState, gradientCss, nextTheme,
  describeMediaError, createBeatDetector, computeBassLevel, createActivityTracker, createAutoGain, extractPalette,
  activeLineIndex,
} from './core.js';
import { createGlowRenderer } from './glow.js';
import { createWheel } from './wheel.js';

const desktop = window.glowlineDesktop ?? null;
const $ = (sel) => document.querySelector(sel);
const form = $('#controls');
const stage = $('#stage');
const statusEl = $('#status');
document.documentElement.classList.toggle('is-desktop', !!desktop);

const storage = (() => { try { return window.localStorage; } catch { return null; } })();
let settings = loadSettings(storage);

const reducedQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
let reducedMotion = !!reducedQuery?.matches;
reducedQuery?.addEventListener?.('change', (e) => { reducedMotion = e.matches; renderHelp(); });

// ---------- Status ----------
let statusTimer = 0;
function setStatus(msg, warn = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('warn', warn);
  statusEl.classList.remove('faded');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.add('faded'), warn ? 9000 : 4500);
}
function setPill(el, state, text) {
  el.dataset.state = state;
  el.querySelector('span:last-child').textContent = text;
}

// ---------- Settings <-> controls ----------
function update(patch, { persist = true } = {}) {
  const prevOverlay = settings.overlay;
  settings = sanitizeSettings({ ...settings, ...patch });
  if (persist && !saveSettings(storage, settings)) {
    setStatus('Settings could not be saved (storage is blocked or full). They will reset when you restart.', true);
  }
  syncControls();
  desktop?.sendFrame({ settings });
  if (desktop && prevOverlay !== settings.overlay) applyOverlay();
}

function syncControls() {
  for (const [key, value] of Object.entries(settings)) {
    form.querySelectorAll(`[name="${key}"]`).forEach((input) => {
      if (input.type === 'radio') input.checked = input.value === String(value);
      else if (input.type === 'checkbox') input.checked = !!value;
      else if (input.value !== String(value)) input.value = String(value);
    });
  }
  const solid = settings.colorMode === 'solid';
  $('#balance-out').textContent = `${settings.balance}% / ${100 - settings.balance}%`;
  $('#primary-pct').textContent = solid ? '100%' : `${settings.balance}%`;
  $('#secondary-pct').textContent = solid ? 'off' : `${100 - settings.balance}%`;
  $('#glow-out').textContent = `${settings.glow}%`;
  $('#thickness-out').textContent = `${settings.thickness}px`;
  $('#speed-out').textContent = `${settings.speed}%`;
  $('#primary-hex').textContent = settings.primary;
  $('#secondary-hex').textContent = settings.secondary;
  wheels.primary.set(settings.primary);
  wheels.secondary.set(settings.secondary);
  wheels.secondary.setDisabled(solid);
  form.querySelectorAll('input[type="range"][name]').forEach(fillRange);

  $('#secondary').disabled = solid;
  $('#balance').disabled = solid;
  $('#secondary-field').classList.toggle('disabled', solid);
  $('#balance-field').classList.toggle('disabled', solid);
  const still = settings.motion === 'still';
  $('#speed').disabled = still;
  $('#speed-field').classList.toggle('disabled', still);

  const active = findPreset(settings);
  document.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === active?.id)));
  stage.style.setProperty('--np-a', settings.primary);
  stage.style.setProperty('--np-b', solid ? settings.primary : settings.secondary);

  $('#dock-glow').setAttribute('aria-pressed', String(!!settings.overlay));
  const modeName = { still: 'Still', animated: 'Animated', music: 'Music sync' }[settings.motion];
  $('#mock-caption').textContent = `${modeName} · ${solid ? '1 color' : '2 colors'}`;
  applyTheme();
  renderHelp();
}

function renderHelp() {
  let text = {
    still: 'A steady glow that never moves.',
    animated: 'The colors slowly travel around the edge.',
    music: audio.kind
      ? 'Brightness and thickness follow the music, with a pulse on each beat.'
      : 'Press "Listen" above (for Spotify), or play a local file under More. Until then the light idles softly.',
  }[settings.motion];
  if (reducedMotion && settings.motion !== 'still') {
    text += ' Your system asks for reduced motion, so movement is paused and beat pulses are off.';
  }
  $('#motion-help').textContent = text;
}

form.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.name || !(t.name in DEFAULTS)) return;
  if ((t.name === 'primary' || t.name === 'secondary') && capture.stream) stopScreen('Manual color chosen, so screen sampling stopped.');
  const value = t.type === 'range' ? Number(t.value) : t.type === 'checkbox' ? t.checked : t.value;
  const manualColor = t.name === 'primary' || t.name === 'secondary';
  update({ [t.name]: value, ...(manualColor ? { albumColors: false } : {}) });
  if (t.name === 'albumColors' && value) applyAlbumPalette();
  if (t.name === 'lyrics') loadLyrics({ force: true });
});
form.addEventListener('submit', (e) => e.preventDefault());

// Slider fill (the accent part of the track left of the thumb)
function fillRange(input) {
  const min = Number(input.min || 0), max = Number(input.max || 100);
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

// Color wheels
const wheels = {};
for (const key of ['primary', 'secondary']) {
  wheels[key] = createWheel($(`#wheel-${key}`), {
    label: key === 'primary' ? 'Primary' : 'Secondary',
    onChange: (hex) => {
      if (capture.stream) stopScreen('Manual color chosen, so screen sampling stopped.');
      update({ [key]: hex, albumColors: false });
    },
  });
}

// Presets
const presetBox = $('#presets');
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.dataset.preset = p.id;
  b.setAttribute('aria-pressed', 'false');
  b.title = p.name;
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.style.background = `linear-gradient(135deg, ${p.primary}, ${p.secondary})`;
  const name = document.createElement('span');
  name.className = 'swatch-name';
  name.textContent = `${p.name} preset`;
  b.append(dot, name);
  b.addEventListener('click', () => {
    if (capture.stream) stopScreen('Preset chosen, so screen sampling stopped.');
    update({ primary: p.primary, secondary: p.secondary, albumColors: false });
  });
  presetBox.append(b);
}

$('#reset').addEventListener('click', () => {
  update({ ...DEFAULTS, overlay: settings.overlay, autoAudio: settings.autoAudio });
  setStatus('Look and feel reset to defaults.');
});

// ---------- Theme ----------
function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  const label = { system: 'System', light: 'Light', dark: 'Dark' }[settings.theme];
  $('#theme-label').textContent = label;
  $('#theme-icon').textContent = { system: '◐', light: '☀', dark: '☾' }[settings.theme];
  $('#theme-toggle').setAttribute('aria-label', `Theme: ${label}. Activate to switch.`);
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  desktop?.setWindowTheme(dark);
}
$('#theme-toggle').addEventListener('click', () => update({ theme: nextTheme(settings.theme) }));

// ---------- Full-screen preview & (browser) display picker ----------
let screenDetails = null;
const displaySelect = $('#display-select');

$('#fullscreen-btn').addEventListener('click', async () => {
  if (!stage.requestFullscreen) {
    setStatus('Full screen is not supported here.', true);
    return;
  }
  const idx = displaySelect.value;
  const target = !desktop && idx !== 'current' && screenDetails ? screenDetails.screens[Number(idx)] : undefined;
  try {
    await stage.requestFullscreen(target ? { screen: target } : undefined);
  } catch (err) {
    setStatus(`Full screen was blocked: ${err.message || err.name}`, true);
  }
});
$('#exit-fs').addEventListener('click', () => document.exitFullscreen?.());
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement === stage) $('#exit-fs').focus();
  else $('#fullscreen-btn').focus();
});

function fillBrowserDisplays() {
  displaySelect.replaceChildren(new Option("This browser window's display", 'current'));
  screenDetails.screens.forEach((s, i) => {
    const name = s.label || `Display ${i + 1}`;
    const extra = `${s.width}×${s.height}${s.isPrimary ? ', primary' : ''}${s === screenDetails.currentScreen ? ', current' : ''}`;
    displaySelect.append(new Option(`${name} (${extra})`, String(i)));
  });
}
$('#detect-displays').addEventListener('click', async () => {
  if (!('getScreenDetails' in window)) {
    setStatus('This browser cannot list displays (the Window Management API is Chromium-only). Move this window to the display you want, then use full screen.', true);
    return;
  }
  try {
    screenDetails = await window.getScreenDetails();
    fillBrowserDisplays();
    screenDetails.addEventListener('screenschange', fillBrowserDisplays);
    setStatus(`Found ${screenDetails.screens.length} display${screenDetails.screens.length === 1 ? '' : 's'}.`);
  } catch (err) {
    setStatus(describeMediaError(err, 'Display detection'), true);
  }
});

// ---------- Desktop edge overlay ----------
const OVERLAY_DISPLAYS_KEY = 'glowline:overlay-displays:v1';
let displays = [];
let overlayDisplayIds = (() => {
  try { const v = JSON.parse(storage?.getItem(OVERLAY_DISPLAYS_KEY) ?? '[]'); return Array.isArray(v) ? v.map(Number) : []; } catch { return []; }
})();

function renderOverlayDisplays() {
  const box = $('#overlay-displays');
  box.replaceChildren();
  const known = overlayDisplayIds.filter((id) => displays.some((d) => d.id === id));
  const selected = known.length ? known : displays.filter((d) => d.primary).map((d) => d.id);
  for (const d of displays) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(d.id);
    input.checked = selected.includes(d.id);
    input.addEventListener('change', () => {
      overlayDisplayIds = [...box.querySelectorAll('input:checked')].map((i) => Number(i.value));
      try { storage?.setItem(OVERLAY_DISPLAYS_KEY, JSON.stringify(overlayDisplayIds)); } catch { /* not persisted */ }
      if (settings.overlay) applyOverlay();
    });
    const name = `${d.internal ? 'Built-in display' : d.label}${d.primary ? ' (main)' : ''} · ${d.width}×${d.height}`;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 18 14');
    icon.setAttribute('class', 'mon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<rect x="1" y="1" width="16" height="10" rx="2"/><path d="M6 13h6"/>';
    label.append(icon, name, input);
    box.append(label);
  }
}

async function applyOverlay() {
  if (!desktop) return;
  const ids = [...$('#overlay-displays').querySelectorAll('input:checked')].map((i) => Number(i.value));
  if (settings.overlay && ids.length === 0 && displays.length > 0) {
    setStatus('Tick at least one display to show the edge glow.', true);
  }
  const state = await desktop.setOverlay({ enabled: settings.overlay, displayIds: ids });
  desktop.sendFrame({ settings });
  if (settings.overlay && state.enabled) {
    setStatus(`Edge glow is on for ${state.displayIds.length} display${state.displayIds.length === 1 ? '' : 's'}. Clicks pass through it.`);
  } else if (!settings.overlay) {
    setStatus('Edge glow is off.');
  }
}

async function initDesktop() {
  const info = await desktop.getInfo();
  $('#overlay-group').hidden = false;
  $('#overlay-shortcut').textContent = info.shortcut;
  displays = await desktop.listDisplays();
  renderOverlayDisplays();
  desktop.onDisplaysChanged((list) => { displays = list; renderOverlayDisplays(); if (settings.overlay) applyOverlay(); });
  desktop.onShortcut((name) => { if (name === 'toggle-overlay') update({ overlay: !settings.overlay }); });
  if (!info.systemAudioLoopback) {
    $('#system-audio-help').textContent = 'System audio loopback is only available on Windows in this version. Use a local audio file instead.';
    $('#system-audio-start').disabled = true;
  }
  renderSpotify(await desktop.getSpotifyStatus());
  desktop.onSpotifyStatus(renderSpotify);
  desktop.onMedia(onMedia);
  const m = await desktop.getMedia();
  if (m && m.session) onMedia({ ...m, trackChanged: true });
  if (settings.overlay) applyOverlay();
}

// ---------- Spotify status (desktop only, read locally from Spotify's window title) ----------
let spotify = { state: 'unknown', title: null };
function renderSpotify(status) {
  spotify = status ?? spotify;
  const el = $('#spotify-status');
  switch (spotify.state) {
    case 'playing': setPill(el, 'on', `Spotify is playing: ${media.session && media.title ? [media.artist, media.title].filter(Boolean).join(' - ') : spotify.title}`); break;
    case 'idle': setPill(el, 'warn', 'Spotify is open but not playing'); break;
    case 'not-running': setPill(el, 'off', "Spotify isn't running"); break;
    case 'error': setPill(el, 'warn', "Couldn't check Spotify's state"); break;
    case 'unsupported': setPill(el, 'off', 'Spotify detection is only available on Windows'); break;
    default: setPill(el, 'off', desktop ? 'Spotify: checking…' : 'Spotify detection needs the desktop app');
  }
  renderNowPlaying();
  renderDetection();
}


// ---------- Now playing (Windows media controls: title, artist, cover art, transport) ----------
const coverWrap = $('#cover-wrap');
const coverImg = $('#cover');
const bgArt = $('#bg-art');
let media = { session: false };
let mediaAt = performance.now();
let mediaAvailable = false;
let currentArt = null;

function isPlaying() {
  return media.session ? media.status === 'playing' : spotify.state === 'playing';
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setArt(url) {
  currentArt = url || null;
  if (currentArt) { coverImg.src = currentArt; bgArt.src = currentArt; }
  else { coverImg.removeAttribute('src'); bgArt.removeAttribute('src'); }
  coverWrap.classList.toggle('has-art', !!currentArt);
  if (settings.albumColors) applyAlbumPalette();
}

function applyAlbumPalette() {
  if (!currentArt) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = 48; c.height = 48;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 48, 48);
    const palette = extractPalette(ctx.getImageData(0, 0, 48, 48).data, 48, 48);
    if (settings.albumColors) update(palette);
  };
  img.src = currentArt;
}

function renderNowPlaying() {
  const title = $('#np-title');
  const sub = $('#np-sub');
  const playing = isPlaying();
  if (media.session) {
    title.textContent = media.title || 'Unknown track';
    sub.textContent = [media.artist, media.album && media.album !== media.title ? media.album : ''].filter(Boolean).join(' · ') || 'Spotify';
  } else if (spotify.state === 'playing' && spotify.title) {
    const i = spotify.title.indexOf(' - ');
    title.textContent = i > 0 ? spotify.title.slice(i + 3) : spotify.title;
    sub.textContent = i > 0 ? spotify.title.slice(0, i) : 'Spotify';
  } else if (spotify.state === 'idle') {
    title.textContent = 'Paused';
    sub.textContent = 'Spotify';
  } else {
    title.textContent = 'Nothing playing';
    sub.textContent = desktop ? 'Open Spotify and press play' : 'Install the desktop app to see what Spotify is playing';
  }
  const canControl = !!desktop && mediaAvailable && media.session;
  $('#play').disabled = !canControl;
  $('#prev').disabled = !canControl || !media.canPrevious;
  $('#next').disabled = !canControl || !media.canNext;
  $('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#play-icon').innerHTML = playing ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>' : '<path d="M8 5v14l11-7z"/>';
}

function currentPosition() {
  if (!media.session) return 0;
  const elapsed = media.status === 'playing' ? (performance.now() - mediaAt) / 1000 : 0;
  return Math.min(media.duration || Infinity, media.position + elapsed);
}

function renderProgress() {
  if (!media.session || !media.duration) {
    $('#bar-fill').style.width = '0%';
    $('#pos').textContent = '0:00';
    $('#dur').textContent = '0:00';
    return;
  }
  const pos = currentPosition();
  $('#bar-fill').style.width = `${(pos / media.duration) * 100}%`;
  $('#pos').textContent = fmtTime(pos);
  $('#dur').textContent = fmtTime(media.duration);
}

function onMedia(msg) {
  if (!msg) return;
  if (msg.type === 'unsupported') { mediaAvailable = false; renderNowPlaying(); return; }
  if (msg.type === 'error') { if (!mediaAvailable) setStatus(`Cover art unavailable: ${msg.message}`, true); return; }
  mediaAvailable = true;
  if (!msg.session) {
    media = { session: false };
    setArt(null);
  } else {
    const trackChanged = msg.trackChanged;
    media = msg;
    mediaAt = performance.now();
    if (trackChanged || msg.art !== undefined) setArt(msg.art);
    if (trackChanged) loadLyrics();
  }
  renderSpotify();
}

for (const [id, cmd] of [['play', 'play-pause'], ['prev', 'previous'], ['next', 'next']]) {
  $(`#${id}`).addEventListener('click', async () => {
    if (!desktop) return;
    const ok = await desktop.mediaCommand(cmd);
    if (!ok) setStatus("Couldn't reach Spotify's media controls. Is Spotify open?", true);
  });
}


// ---------- Lyrics (full screen) ----------
const lyricsBox = $('#lyrics');
const lyricsTrack = $('#lyrics-track');
const lyricsNote = $('#lyrics-note');
const lyr = { key: null, status: 'idle', lines: [], els: [], active: -2, plainOffset: -1 };

function lyricsKey() { return media.session && media.title ? `${media.artist}|${media.title}` : null; }

function showLyrics(res) {
  lyr.status = res.status;
  lyr.lines = res.status === 'synced' ? res.lines : [];
  lyr.active = -2;
  lyr.plainOffset = -1;
  lyricsTrack.style.transform = 'translateY(0)';
  lyricsTrack.replaceChildren();
  if (res.status === 'synced') {
    lyr.els = lyr.lines.map((line) => {
      const p = document.createElement('p');
      p.className = line.text ? 'lyric-line' : 'lyric-line gap';
      p.textContent = line.text || '• • •';
      lyricsTrack.append(p);
      return p;
    });
  } else if (res.status === 'plain') {
    lyr.els = res.text.split(/\r?\n/).map((t) => {
      const p = document.createElement('p');
      p.className = 'lyric-line plain';
      p.textContent = t || ' ';
      lyricsTrack.append(p);
      return p;
    });
  } else {
    lyr.els = [];
  }
  lyricsNote.textContent = {
    loading: 'Finding lyrics…',
    none: 'No lyrics found for this song.',
    instrumental: 'Instrumental. Enjoy the light.',
    error: `Couldn't load lyrics${res.message ? `: ${res.message}` : '.'}`,
    off: '',
    idle: desktop ? 'Play something in Spotify to see lyrics.' : 'Lyrics need the desktop app.',
  }[res.status] ?? '';
}

async function loadLyrics({ force = false } = {}) {
  stage.classList.toggle('lyrics-off', !settings.lyrics || !desktop);
  if (!desktop?.getLyrics || !settings.lyrics) { lyr.key = null; showLyrics({ status: settings.lyrics ? 'idle' : 'off' }); return; }
  const key = lyricsKey();
  if (!key) { lyr.key = null; showLyrics({ status: 'idle' }); return; }
  if (key === lyr.key && !force) return;
  lyr.key = key;
  showLyrics({ status: 'loading' });
  const res = await desktop.getLyrics({ title: media.title, artist: media.artist, album: media.album, duration: media.duration });
  if (lyr.key !== key) return; // the track changed while we were waiting
  showLyrics(res ?? { status: 'error' });
}

function renderLyrics() {
  if (document.fullscreenElement !== stage || lyr.els.length === 0) return;
  const pos = currentPosition();
  const view = lyricsBox.clientHeight;
  if (lyr.status === 'synced') {
    // Show a line ~0.25 s early so the highlight lands on the sung word, not after it.
    const idx = activeLineIndex(lyr.lines, pos + 0.25);
    if (idx === lyr.active) return;
    lyr.active = idx;
    lyr.els.forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('past', i < idx);
      el.classList.toggle('near', i > idx && i <= idx + 2);
    });
    const anchor = lyr.els[Math.max(0, idx)];
    const offset = anchor.offsetTop + anchor.offsetHeight / 2 - view * 0.38;
    lyricsTrack.style.transform = `translateY(${-Math.max(0, idx < 0 ? 0 : offset)}px)`;
  } else if (lyr.status === 'plain' && media.duration) {
    const max = Math.max(0, lyricsTrack.scrollHeight - view * 0.6);
    const offset = Math.round(Math.min(1, pos / media.duration) * max);
    if (Math.abs(offset - lyr.plainOffset) < 2) return;
    lyr.plainOffset = offset;
    lyricsTrack.style.transform = `translateY(${-offset}px)`;
  }
}

let idleTimer = 0;
function wakeFullscreen() {
  stage.classList.remove('idle');
  clearTimeout(idleTimer);
  if (document.fullscreenElement === stage) idleTimer = setTimeout(() => stage.classList.add('idle'), 2500);
}
stage.addEventListener('pointermove', wakeFullscreen);
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement === stage) { loadLyrics(); lyr.active = -2; lyr.plainOffset = -1; wakeFullscreen(); }
  else { stage.classList.remove('idle'); clearTimeout(idleTimer); }
});

// ---------- Dock & settings sheet ----------
const sheet = $('#sheet');
function openSheet(focusSel) {
  sheet.hidden = false;
  $('#dock-settings').setAttribute('aria-expanded', 'true');
  const target = focusSel ? $(focusSel) : null;
  if (target) form.scrollTop = target.offsetTop - form.offsetTop;
  (target?.querySelector('input, select, button') ?? $('#sheet-close')).focus();
}
function closeSheet() {
  if (sheet.hidden) return;
  sheet.hidden = true;
  $('#dock-settings').setAttribute('aria-expanded', 'false');
  $('#dock-settings').focus();
}
$('#dock-settings').addEventListener('click', () => (sheet.hidden ? openSheet() : closeSheet()));
$('#dock-colors').addEventListener('click', () => openSheet('#colors-sect'));
$('#sheet-close').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden && !document.fullscreenElement) closeSheet(); });
$('#dock-listen').addEventListener('click', () => {
  if (audio.kind === 'system') $('#system-audio-stop').click();
  else $('#system-audio-start').click();
});
$('#dock-glow').addEventListener('click', () => {
  if (!desktop) { setStatus('The screen glow needs the desktop app.', true); return; }
  update({ overlay: !settings.overlay });
});
if (!desktop) $('#dock-glow').hidden = true;

// ---------- Screen color sampling ----------
const capture = { stream: null, timer: 0, video: null, canvas: null };

$('#screen-start').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus('Screen capture is not available here. Use the color pickers instead.', true);
    return;
  }
  try {
    if (desktop) {
      const ids = [...$('#overlay-displays').querySelectorAll('input:checked')].map((i) => i.value);
      await desktop.prepareCapture('screen', ids[0] ?? displays.find((d) => d.primary)?.id);
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    capture.stream = stream;
    capture.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: stream });
    await capture.video.play();
    capture.canvas = document.createElement('canvas');
    capture.canvas.width = 48; capture.canvas.height = 27;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopScreen('Screen sharing ended.'));
    capture.timer = setInterval(sampleScreen, 400);
    $('#screen-start').hidden = true;
    $('#screen-stop').hidden = false;
    $('#screen-stop').focus();
    setStatus('Sampling colors from your screen. Press "Stop sampling" to stop.');
  } catch (err) {
    stopScreen();
    setStatus(describeMediaError(err, 'Screen capture'), true);
  }
});
$('#screen-stop').addEventListener('click', () => stopScreen('Screen sampling stopped.'));

function sampleScreen() {
  const { video, canvas } = capture;
  if (!video || video.readyState < 2) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  update({ ...sampleEdgeColors(data, canvas.width, canvas.height), albumColors: false });
}

function stopScreen(message) {
  clearInterval(capture.timer);
  capture.stream?.getTracks().forEach((t) => t.stop());
  if (capture.video) capture.video.srcObject = null;
  Object.assign(capture, { stream: null, timer: 0, video: null, canvas: null });
  $('#screen-start').hidden = false;
  const stopBtn = $('#screen-stop');
  const hadFocus = document.activeElement === stopBtn;
  stopBtn.hidden = true;
  if (hadFocus) $('#screen-start').focus();
  if (message) setStatus(message);
}

// ---------- Audio: system loopback (Spotify) or local file ----------
const audio = {
  ctx: null, analyser: null, freq: null, time: null,
  kind: null, // 'system' | 'file' | null
  systemStream: null, systemNode: null, elementSource: null,
};
const audioEl = $('#audio-el');
const signal = { level: 0, beat: 0, bass: 0, rms: 0, audible: false };
let beatDetector = createBeatDetector();
let activity = createActivityTracker();
let gain = createAutoGain();

function ensureAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw Object.assign(new Error('Web Audio is not supported here.'), { name: 'NotSupportedError' });
  if (!audio.ctx) {
    audio.ctx = new Ctx();
    audio.analyser = audio.ctx.createAnalyser();
    audio.analyser.fftSize = 2048;
    audio.analyser.smoothingTimeConstant = 0.3; // keep drum transients sharp; visuals are smoothed separately
    audio.freq = new Uint8Array(audio.analyser.frequencyBinCount);
    audio.time = new Uint8Array(audio.analyser.fftSize);
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  return audio.ctx;
}

function resetAnalysis() {
  beatDetector = createBeatDetector();
  activity = createActivityTracker();
  gain = createAutoGain();
  Object.assign(signal, { level: 0, beat: 0, bass: 0, rms: 0, audible: false });
}

class CaptureError extends Error {
  constructor(name, message) { super(message); this.name = name; }
}

async function startSystemAudio() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new CaptureError('NotSupportedError', 'System audio capture is not available here.');
  }
  const ctx = ensureAudioContext();
  stopFile();
  stopSystemAudio();
  if (desktop) await desktop.prepareCapture('system-audio', displays.find((d) => d.primary)?.id);
  const request = navigator.mediaDevices.getDisplayMedia(
    desktop
      ? { video: true, audio: true }
      : { video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include', selfBrowserSurface: 'exclude' },
  );
  // On Windows the loopback stream rides on a screen capture. If the display is asleep or
  // another app blocks desktop duplication, that request can stall instead of failing.
  let timer;
  const stream = desktop
    ? await Promise.race([
      request,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new CaptureError('TimeoutError',
          'Windows did not start system audio capture within 10 seconds. This happens when the display is asleep or locked, or when desktop capture is blocked. Wake the screen and press "Listen" again.')), 10000);
      }),
    ]).finally(() => clearTimeout(timer))
    : await request;
  // If the stalled request completes after we gave up, release it immediately.
  if (desktop) request.then((late) => { if (late !== stream) late.getTracks().forEach((t) => t.stop()); }).catch(() => {});
  // Only the audio is used; drop the (mandatory) video track straight away.
  stream.getVideoTracks().forEach((t) => t.stop());
  const tracks = stream.getAudioTracks();
  if (tracks.length === 0) {
    throw new CaptureError(
      'NoAudioTrack',
      desktop
        ? 'Windows did not provide a system-audio (loopback) track. Check that an output device is enabled in Sound settings, then try again.'
        : 'No system audio was shared. Choose "Entire screen" and tick "Also share system audio" in the share dialog (Chrome or Edge on Windows).',
    );
  }
  audio.systemStream = new MediaStream(tracks);
  audio.systemNode = ctx.createMediaStreamSource(audio.systemStream);
  audio.systemNode.connect(audio.analyser); // analysed only, never played back
  tracks[0].addEventListener('ended', () => stopSystemAudio('System audio capture ended.'));
  audio.kind = 'system';
  resetAnalysis();
  $('#system-audio-start').hidden = true;
  $('#system-audio-stop').hidden = false;
  $('#dock-listen').setAttribute('aria-pressed', 'true');
  if (settings.motion !== 'music') update({ motion: 'music' });
  renderHelp();
  renderDetection();
  return tracks[0].label || 'system audio';
}

function stopSystemAudio(message) {
  const wasRunning = !!audio.systemStream;
  audio.systemNode?.disconnect();
  audio.systemStream?.getTracks().forEach((t) => t.stop());
  audio.systemStream = null;
  audio.systemNode = null;
  if (audio.kind === 'system') audio.kind = null;
  const stopBtn = $('#system-audio-stop');
  const hadFocus = document.activeElement === stopBtn;
  stopBtn.hidden = true;
  $('#system-audio-start').hidden = false;
  $('#dock-listen').setAttribute('aria-pressed', 'false');
  if (hadFocus) $('#system-audio-start').focus();
  if (wasRunning) resetAnalysis();
  renderHelp();
  renderDetection();
  if (message) setStatus(message);
}

$('#system-audio-start').addEventListener('click', async () => {
  try {
    await startSystemAudio();
    $('#system-audio-stop').focus();
    setStatus('Listening to system audio. Play something in Spotify and the light will follow it.');
  } catch (err) {
    stopSystemAudio();
    setStatus(err instanceof CaptureError ? err.message : describeMediaError(err, 'System audio capture'), true);
  }
});
$('#system-audio-stop').addEventListener('click', () => stopSystemAudio('System audio stopped. Nothing is being captured.'));

$('#audio-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const ctx = ensureAudioContext();
    stopSystemAudio();
    stopFile();
    if (audioEl.src) URL.revokeObjectURL(audioEl.src);
    audioEl.src = URL.createObjectURL(file);
    audioEl.hidden = false;
    if (!audio.elementSource) audio.elementSource = ctx.createMediaElementSource(audioEl);
    audio.elementSource.connect(audio.analyser);
    audio.elementSource.connect(ctx.destination);
    audio.kind = 'file';
    resetAnalysis();
    await audioEl.play();
    if (settings.motion !== 'music') update({ motion: 'music' });
    $('#audio-stop').hidden = false;
    renderHelp();
    setStatus(`Playing "${file.name}" from your computer. Music mode is on.`);
  } catch (err) {
    setStatus(describeMediaError(err, 'Audio playback'), true);
  }
  e.target.value = '';
});
$('#audio-stop').addEventListener('click', () => {
  stopFile();
  setStatus('Audio file stopped.');
});

function stopFile() {
  if (!audioEl.paused) audioEl.pause();
  audio.elementSource?.disconnect();
  if (audio.kind === 'file') { audio.kind = null; resetAnalysis(); }
  const stopBtn = $('#audio-stop');
  if (document.activeElement === stopBtn) $('#system-audio-start').focus();
  stopBtn.hidden = true;
  renderHelp();
  renderDetection();
}

// ---------- Detection indicator ----------
let lastDetectKey = '';
function renderDetection() {
  const el = $('#audio-detect');
  let state, text;
  if (!audio.kind) {
    state = 'off';
    text = isPlaying() ? 'Press the waveform button below so the light follows the music.' : 'Not listening yet';
  } else if (signal.audible) {
    state = 'on';
    text = audio.kind === 'system' ? 'Audio detected from system output: reacting' : 'Audio detected from file: reacting';
  } else {
    state = 'warn';
    text = audio.kind === 'system'
      ? (spotify.state === 'playing'
        ? 'Listening, but no sound reaches the default output. Check Spotify\'s volume and output device.'
        : 'Listening to system audio: silent. Press play in Spotify.')
      : 'File is paused or silent';
  }
  const key = `${state}|${text}`;
  if (key === lastDetectKey) return;
  lastDetectKey = key;
  setPill(el, state, text);
  $('#np-hint').textContent = state === 'on' ? '' : text;
  const chip = $('#live-chip');
  chip.dataset.state = state;
  chip.textContent = state === 'on' ? 'Reacting' : audio.kind ? 'Listening' : 'Idle';
}

// ---------- Analysis loop (timer-based so it keeps running while minimized) ----------
const meterFill = $('#meter-fill');
let tickCount = 0;
function analyse() {
  const now = performance.now();
  if (audio.kind && audio.analyser) {
    audio.analyser.getByteFrequencyData(audio.freq);
    audio.analyser.getByteTimeDomainData(audio.time);
    signal.rms = computeRms(audio.time);
    signal.audible = activity.update(signal.rms, now);
    const normalised = gain.update(computeLevel(audio.freq), now);
    signal.level = reducedMotion ? smoothLevel(signal.level, normalised, 0.12, 0.04) : smoothLevel(signal.level, normalised);
    signal.bass = computeBassLevel(audio.freq, audio.ctx.sampleRate, audio.analyser.fftSize);
    signal.beat = reducedMotion ? 0 : beatDetector.update(signal.bass, now).pulse;
  } else {
    signal.level = smoothLevel(signal.level, 0);
    signal.beat = 0;
    signal.audible = false;
  }
  renderDetection();
  if (desktop && settings.overlay) {
    tickCount = (tickCount + 1) % 30;
    desktop.sendFrame(tickCount === 0 ? { settings, level: signal.level, beat: signal.beat } : { level: signal.level, beat: signal.beat });
  }
}
setInterval(analyse, 33);

// ---------- Preview render loop ----------
const glow = createGlowRenderer($('#glow-canvas'), { radius: 20, maxScale: 1.5 });
stage.classList.toggle('gl-on', !!glow);

function frame(now) {
  if (glow) {
    glow.render(settings, { time: now, level: signal.level, beat: signal.beat, reducedMotion });
  } else {
    const st = frameState(settings, { time: now, level: signal.level, beat: signal.beat, reducedMotion });
    stage.style.setProperty('--rim-bg', gradientCss(settings, st.angle));
    stage.style.setProperty('--thickness', `${st.thickness}px`);
    stage.style.setProperty('--blur', `${st.blur}px`);
    stage.style.setProperty('--intensity', String(st.intensity));
  }
  renderLyrics();
  meterFill.style.width = `${Math.round(signal.level * 100)}%`;
  renderProgress();
  if (!reducedMotion && audio.kind && signal.beat > 0) coverWrap.style.transform = `scale(${1 + signal.beat * 0.025})`;
  else coverWrap.style.transform = '';
  requestAnimationFrame(frame);
}

syncControls();
renderSpotify();
loadLyrics();
requestAnimationFrame(frame);
window.addEventListener('pagehide', () => { stopScreen(); stopSystemAudio(); stopFile(); });

if (desktop) {
  const ready = initDesktop();
  // Called by the main process (with a user gesture) once the window has loaded.
  window.__glowlineAutoStart = async () => {
    await ready;
    if (!settings.autoAudio || audio.kind) return 'skipped';
    try {
      await startSystemAudio();
      setStatus('Listening to system audio (auto-start is on). Use "Stop system audio" to stop.');
      return 'started';
    } catch (err) {
      stopSystemAudio();
      setStatus(err instanceof CaptureError ? err.message : describeMediaError(err, 'System audio capture'), true);
      return 'failed';
    }
  };
}

// ---------- Self-test hook used by `npm run selftest` (desktop only) ----------
if (desktop) {
  window.__glowlineSelfTest = async (seconds = 6) => {
    const report = { ok: false };
    try {
      report.trackLabel = await startSystemAudio();
      const t0 = performance.now();
      let peakRms = 0, audibleTicks = 0, ticks = 0, beats = 0, lastPulse = 0, peakLevel = 0, bassSum = 0, peakBass = 0;
      await new Promise((resolve) => {
        const id = setInterval(() => {
          ticks++;
          peakRms = Math.max(peakRms, signal.rms);
          peakLevel = Math.max(peakLevel, signal.level);
          bassSum += signal.bass; peakBass = Math.max(peakBass, signal.bass);
          if (signal.audible) audibleTicks++;
          if (signal.beat > lastPulse + 0.5) beats++;
          lastPulse = signal.beat;
          if (performance.now() - t0 > seconds * 1000) { clearInterval(id); resolve(); }
        }, 33);
      });
      Object.assign(report, {
        ok: true,
        peakRms: Number(peakRms.toFixed(4)),
        peakLevel: Number(peakLevel.toFixed(3)),
        audibleFraction: Number((audibleTicks / ticks).toFixed(2)),
        beats,
        bassAvg: Number((bassSum / ticks).toFixed(3)),
        bassPeak: Number(peakBass.toFixed(3)),
        detectionText: $('#audio-detect-text').textContent,
        spotifyText: $('#spotify-text').textContent,
        nowPlaying: `${$('#np-title').textContent} / ${$('#np-sub').textContent}`,
        coverArt: $('#cover-wrap').classList.contains('has-art'),
        colors: [settings.primary, settings.secondary, settings.albumColors ? 'from album art' : 'manual'],
      });
      update({ overlay: true }, { persist: false });
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      report.error = `${err.name}: ${err.message}`;
    } finally {
      stopSystemAudio();
    }
    return report;
  };
}
