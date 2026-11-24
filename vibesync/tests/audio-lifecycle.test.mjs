import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseStream, safeDisconnect, createStartGate, withTimeout, recoveryHint } from '../src/audio-lifecycle.js';

function fakeTrack(kind = 'audio') {
  return { kind, readyState: 'live', stops: 0, stop() { this.stops++; this.readyState = 'ended'; } };
}
function fakeStream(...tracks) {
  return { getTracks: () => tracks };
}

test('releaseStream stops every live track exactly once and never throws', () => {
  const a = fakeTrack('audio');
  const v = fakeTrack('video');
  const ended = fakeTrack('audio');
  ended.readyState = 'ended';
  assert.equal(releaseStream(fakeStream(a, v, ended)), 2);
  assert.equal(a.stops, 1);
  assert.equal(v.stops, 1);
  assert.equal(ended.stops, 0);
  assert.equal(releaseStream(fakeStream(a, v)), 0, 'second release is a no-op');
  assert.equal(releaseStream(null), 0);
  assert.equal(releaseStream({ getTracks() { throw new Error('gone'); } }), 0);
  const angry = fakeTrack();
  angry.stop = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => releaseStream(fakeStream(angry, fakeTrack())));
});

test('safeDisconnect tolerates missing or already-disconnected nodes', () => {
  let n = 0;
  safeDisconnect({ disconnect: () => n++ });
  assert.equal(n, 1);
  assert.doesNotThrow(() => safeDisconnect(null));
  assert.doesNotThrow(() => safeDisconnect({ disconnect() { throw new Error('not connected'); } }));
});

test('start gate: a newer start or a stop makes older starts stale', () => {
  const gate = createStartGate();
  const first = gate.begin();
  assert.equal(gate.busy, true);
  const second = gate.begin();          // double click
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.finish(first);                   // stale finish doesn't clear busy
  assert.equal(gate.busy, true);
  gate.finish(second);
  assert.equal(gate.busy, false);
  const third = gate.begin();
  gate.cancel();                        // stop pressed / page closing while starting
  assert.equal(gate.isCurrent(third), false);
  assert.equal(gate.busy, false);
});

test('withTimeout: on time → value; too late → error now, value released later', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 50, () => new Error('slow')), 'ok');

  let resolveLate;
  const slow = new Promise((r) => { resolveLate = r; });
  const released = [];
  await assert.rejects(withTimeout(slow, 10, () => new Error('timed out'), (v) => released.push(v)), /timed out/);
  const lateStream = fakeStream(fakeTrack());
  resolveLate(lateStream);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(released, [lateStream], 'late stream handed to the cleanup callback');

  // A value that arrives in time is never passed to onLate.
  const notLate = [];
  await withTimeout(Promise.resolve('fast'), 50, () => new Error('x'), (v) => notLate.push(v));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(notLate, []);

  // Rejections pass through untouched.
  await assert.rejects(withTimeout(Promise.reject(new Error('denied')), 50, () => new Error('x')), /denied/);
});

test('recovery hints are short, actionable and mention the waveform button', () => {
  const manual = recoveryHint('ended', { autoAudio: false });
  const auto = recoveryHint('ended', { autoAudio: true });
  assert.match(manual, /sleep, lock or an audio device change/);
  assert.match(manual, /waveform button/);
  assert.match(auto, /restarts it when you unlock/);
  assert.notEqual(manual, auto);
  assert.match(recoveryHint('devicechange'), /audio devices changed/);
  assert.match(recoveryHint('silent-after-wake'), /waking up/);
  assert.equal(recoveryHint('nonsense'), '');
  for (const r of ['ended', 'devicechange', 'silent-after-wake']) assert.ok(recoveryHint(r).length < 200);
});
