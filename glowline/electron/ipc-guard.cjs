// Validation for everything the renderer sends to the main process.
// Pure functions (no Electron imports) so they can be unit-tested; main.cjs wires them up.
'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const LIMITS = Object.freeze({
  maxDisplays: 16,      // overlay:set never needs more display ids than this
  maxText: 300,         // title / artist / album characters sent to the lyrics lookup
  maxDurationSec: 6 * 60 * 60,
});

const CAPTURE_KINDS = Object.freeze(['system-audio', 'screen']);
const MEDIA_COMMANDS = Object.freeze(['play-pause', 'next', 'previous']);

/**
 * True when `url` is a file: URL pointing at one of `allowedFiles` inside `root`
 * (the app's own pages). Query strings and fragments are ignored; anything else
 * (http, data:, other folders, path tricks) is rejected.
 */
function isAppPageUrl(url, root, allowedFiles) {
  let file;
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'file:') return false;
    file = path.normalize(fileURLToPath(u));
  } catch {
    return false;
  }
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  return allowedFiles.some((name) => norm(file) === norm(path.join(root, name)));
}

/** Non-negative safe integer, from a number or an all-digit string; otherwise null. */
function toDisplayId(value) {
  const n = typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** capture:prepare → { kind, displayId|null } or null (rejected). */
function validateCapturePrepare(payload) {
  if (!isPlainObject(payload) || !CAPTURE_KINDS.includes(payload.kind)) return null;
  return { kind: payload.kind, displayId: payload.displayId == null ? null : toDisplayId(payload.displayId) };
}

/** overlay:set → { enabled, displayIds } with at most LIMITS.maxDisplays unique ids. Never throws. */
function validateOverlaySet(payload) {
  const enabled = isPlainObject(payload) && payload.enabled === true;
  const raw = isPlainObject(payload) && Array.isArray(payload.displayIds) ? payload.displayIds.slice(0, LIMITS.maxDisplays) : [];
  const displayIds = [...new Set(raw.map(toDisplayId).filter((id) => id !== null))];
  return { enabled, displayIds };
}

/** media:command → the command string, or null when it isn't one of the three transport commands. */
function validateMediaCommand(name) {
  return typeof name === 'string' && MEDIA_COMMANDS.includes(name) ? name : null;
}

/** Collapse control characters, trim and cap length. Non-strings become ''. */
function cleanText(value, max = LIMITS.maxText) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, max);
}

/**
 * lyrics:get → { title, artist, album, duration, allowNetwork } or null.
 * `allowNetwork` must be exactly true for a request to leave the PC (cache-only otherwise).
 */
function validateLyricsRequest(track) {
  if (!isPlainObject(track)) return null;
  const title = cleanText(track.title);
  if (!title) return null;
  const d = Number(track.duration);
  return {
    title,
    artist: cleanText(track.artist),
    album: cleanText(track.album),
    duration: Number.isFinite(d) && d > 0 && d <= LIMITS.maxDurationSec ? d : 0,
    allowNetwork: track.allowNetwork === true,
  };
}

const unit = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);

/**
 * overlay:frame → a fresh object with only known, bounded fields, or null if nothing usable.
 * `sanitizeSettings` is the app's own settings sanitizer (from src/core.js).
 */
function sanitizeFrame(frame, sanitizeSettings) {
  if (!isPlainObject(frame)) return null;
  const out = {};
  if (isPlainObject(frame.settings)) out.settings = sanitizeSettings(frame.settings);
  const level = unit(frame.level);
  const beat = unit(frame.beat);
  if (level !== undefined) out.level = level;
  if (beat !== undefined) out.beat = beat;
  return Object.keys(out).length ? out : null;
}

module.exports = {
  LIMITS,
  CAPTURE_KINDS,
  MEDIA_COMMANDS,
  isAppPageUrl,
  toDisplayId,
  validateCapturePrepare,
  validateOverlaySet,
  validateMediaCommand,
  validateLyricsRequest,
  sanitizeFrame,
  cleanText,
};
