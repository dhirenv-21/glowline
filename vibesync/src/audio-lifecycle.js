// Hardware-free pieces of the audio start/stop lifecycle, kept separate so they can be tested.

/** Stop every live track of a MediaStream-like object. Never throws. Returns how many were stopped. */
export function releaseStream(stream) {
  let stopped = 0;
  if (!stream) return stopped;
  let tracks = [];
  try { tracks = stream.getTracks?.() ?? []; } catch { return stopped; }
  for (const track of tracks) {
    try {
      if (track.readyState !== 'ended') { track.stop(); stopped++; }
    } catch { /* already gone */ }
  }
  return stopped;
}

/** Disconnect a Web Audio node if there is one. Never throws. */
export function safeDisconnect(node) {
  try { node?.disconnect(); } catch { /* not connected */ }
}

/**
 * Generation counter for async starts. `begin()` returns a token; any later `begin()` or
 * `cancel()` makes older tokens stale, so a slow start that finishes late knows to give
 * its resources back instead of taking over.
 */
export function createStartGate() {
  let generation = 0;
  let busy = false;
  return {
    begin() { busy = true; return ++generation; },
    finish(token) { if (token === generation) busy = false; },
    cancel() { generation++; busy = false; },
    isCurrent(token) { return token === generation; },
    get busy() { return busy; },
  };
}

/**
 * Race `promise` against a timeout. If the timeout wins, the promise's eventual value is
 * handed to `onLate` (e.g. to stop a capture stream that arrived after we gave up), so
 * nothing is leaked either way.
 */
export function withTimeout(promise, ms, makeError, onLate) {
  let timedOut = false;
  let timer;
  promise.then((value) => { if (timedOut) onLate?.(value); }, () => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(makeError()); }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Short, actionable guidance after capture stops on its own or the system changes under it.
 * @param {'ended'|'devicechange'|'silent-after-wake'} reason
 * @param {{ autoAudio?: boolean }} opts
 */
export function recoveryHint(reason, { autoAudio = false } = {}) {
  switch (reason) {
    case 'ended':
      return autoAudio
        ? 'Listening stopped: Windows ended the audio capture (sleep, lock or an audio device change). VibeSync restarts it when you unlock; or press the waveform button.'
        : 'Listening stopped: Windows ended the audio capture (sleep, lock or an audio device change). Press the waveform button to listen again.';
    case 'devicechange':
      return 'Your audio devices changed. If the light stops reacting, turn listening off and on again with the waveform button.';
    case 'silent-after-wake':
      return 'No sound since waking up. If music is playing, turn listening off and on again with the waveform button.';
    default:
      return '';
  }
}
