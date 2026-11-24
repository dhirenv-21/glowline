// Carry a user's data over from the app's former name (Glowline) to VibeSync.
// Electron creates the new profile folder during startup, before this code runs, so we can't
// simply rename the whole folder; instead the folders that hold user data are moved into it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Folders inside the profile that hold the user's own data (settings, display choices, cached lyrics). */
const USER_DATA_ENTRIES = Object.freeze(['Local Storage', 'Session Storage', 'IndexedDB', 'lyrics-cache']);

/**
 * Move user data from `legacyDir` into `currentDir` if the legacy profile has saved settings and
 * the current one doesn't yet. Never overwrites anything that already exists in `currentDir`.
 * Returns { migrated: boolean, moved: string[], reason?: string }.
 */
function migrateProfile(legacyDir, currentDir, fsImpl = fs) {
  if (path.resolve(legacyDir).toLowerCase() === path.resolve(currentDir).toLowerCase()) return { migrated: false, moved: [], reason: 'same folder' };
  if (!fsImpl.existsSync(path.join(legacyDir, 'Local Storage'))) return { migrated: false, moved: [], reason: 'no legacy settings' };
  if (fsImpl.existsSync(path.join(currentDir, 'Local Storage'))) return { migrated: false, moved: [], reason: 'already has settings' };
  fsImpl.mkdirSync(currentDir, { recursive: true });
  const moved = [];
  for (const entry of USER_DATA_ENTRIES) {
    const from = path.join(legacyDir, entry);
    const to = path.join(currentDir, entry);
    if (!fsImpl.existsSync(from) || fsImpl.existsSync(to)) continue;
    fsImpl.renameSync(from, to);
    moved.push(entry);
  }
  // Leave a note in the old folder so it's clear where the data went (the folder can be deleted).
  try {
    fsImpl.writeFileSync(path.join(legacyDir, 'MOVED-TO-VIBESYNC.txt'),
      `Your settings were moved to ${currentDir} when Glowline became VibeSync. This folder can be deleted.\n`);
  } catch { /* optional */ }
  return { migrated: moved.length > 0, moved };
}

module.exports = { migrateProfile, USER_DATA_ENTRIES };
