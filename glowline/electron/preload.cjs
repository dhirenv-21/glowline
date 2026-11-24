// Narrow, explicit bridge between the sandboxed pages and the main process.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('glowlineDesktop', {
  platform: process.platform,
  getInfo: () => ipcRenderer.invoke('app:info'),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  onDisplaysChanged: on('displays:changed'),
  /** Tell the main process what the next getDisplayMedia() call is for: 'system-audio' or 'screen'. */
  prepareCapture: (kind, displayId) => ipcRenderer.invoke('capture:prepare', { kind, displayId }),
  setOverlay: (opts) => ipcRenderer.invoke('overlay:set', opts),
  sendFrame: (frame) => ipcRenderer.send('overlay:frame', frame),
  onFrame: on('overlay:frame'),
  onOverlayState: on('overlay:state'),
  onShortcut: on('shortcut'),
  onPower: on('power'),
  getSpotifyStatus: () => ipcRenderer.invoke('spotify:get'),
  onSpotifyStatus: on('spotify:status'),
  getMedia: () => ipcRenderer.invoke('media:get'),
  onMedia: on('media:update'),
  mediaCommand: (name) => ipcRenderer.invoke('media:command', name),
  getLyrics: (track) => ipcRenderer.invoke('lyrics:get', track),
  setWindowTheme: (dark) => ipcRenderer.send('window:theme', !!dark),
});
