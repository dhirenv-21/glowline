import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { migrateProfile } = require('../electron/profile-migration.cjs');

function makeProfiles() {
  const root = mkdtempSync(join(tmpdir(), 'vibesync-migrate-'));
  const legacy = join(root, 'Glowline');
  const current = join(root, 'VibeSync');
  mkdirSync(join(legacy, 'Local Storage', 'leveldb'), { recursive: true });
  writeFileSync(join(legacy, 'Local Storage', 'leveldb', '000003.log'), 'settings');
  mkdirSync(join(legacy, 'lyrics-cache'));
  writeFileSync(join(legacy, 'lyrics-cache', 'abc.json'), '{"status":"synced"}');
  mkdirSync(join(legacy, 'GPUCache'));
  // Electron has already created the new profile (caches only) before our code runs.
  mkdirSync(join(current, 'GPUCache'), { recursive: true });
  return { root, legacy, current };
}

test('moves settings and cached lyrics into the profile Electron already created', () => {
  const { root, legacy, current } = makeProfiles();
  try {
    const r = migrateProfile(legacy, current);
    assert.equal(r.migrated, true);
    assert.deepEqual(r.moved, ['Local Storage', 'lyrics-cache']);
    assert.equal(readFileSync(join(current, 'Local Storage', 'leveldb', '000003.log'), 'utf8'), 'settings');
    assert.ok(existsSync(join(current, 'lyrics-cache', 'abc.json')));
    assert.equal(existsSync(join(legacy, 'Local Storage')), false, 'moved, not copied');
    assert.ok(existsSync(join(legacy, 'GPUCache')), 'caches are left behind');
    assert.ok(existsSync(join(legacy, 'MOVED-TO-VIBESYNC.txt')));
    // Running again (every launch) does nothing.
    assert.deepEqual(migrateProfile(legacy, current), { migrated: false, moved: [], reason: 'no legacy settings' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('never overwrites settings the new profile already has', () => {
  const { root, legacy, current } = makeProfiles();
  try {
    mkdirSync(join(current, 'Local Storage'));
    writeFileSync(join(current, 'Local Storage', 'mine'), 'new');
    const r = migrateProfile(legacy, current);
    assert.equal(r.migrated, false);
    assert.equal(r.reason, 'already has settings');
    assert.equal(readFileSync(join(current, 'Local Storage', 'mine'), 'utf8'), 'new');
    assert.ok(existsSync(join(legacy, 'Local Storage')), 'old data untouched');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no old profile, or the same folder: nothing happens', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibesync-migrate-'));
  try {
    assert.equal(migrateProfile(join(root, 'Glowline'), join(root, 'VibeSync')).reason, 'no legacy settings');
    assert.equal(migrateProfile(join(root, 'Same'), join(root, 'same')).reason, 'same folder');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
