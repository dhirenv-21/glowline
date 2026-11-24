# Glowline

Free, local ambient edge lighting for your Windows desktop. It reacts to **Spotify, or anything else playing through your speakers**. A transparent, click-through window draws a glow around the edges of the displays you pick. It pulses with the music, rotates gradually, or holds still.

No Spotify API key, no account, no paid services, no analytics. Audio is analysed on your computer and never recorded or uploaded. The microphone is never used. The **only** network request is the optional lyrics lookup on [LRCLIB](https://lrclib.net) (see [Lyrics](#full-screen-lyrics)), which you can switch off.

## Requirements

| | |
| --- | --- |
| OS | **Windows 10 (version 2004 or later) or Windows 11**, 64-bit. Built and tested on Windows 11 (build 26200). |
| To run from source | [Node.js](https://nodejs.org/) 20 or later and npm |
| Spotify | The Spotify desktop app (Microsoft Store or spotify.com installer), playing through your default output device |

System-audio loopback is a Windows feature in this build. The code runs on macOS and Linux too, but the system-audio button is disabled there (see [Limitations](#limitations)).

## Install and run

### Installed app (production)

```bash
cd glowline
npm install
npm run dist
```

This produces `dist\Glowline-Setup-<version>.exe`. Run it, choose an install folder, and start **Glowline** from the Start menu. The installer is **unsigned**, so Windows SmartScreen will say "Windows protected your PC". Click **More info → Run anyway**. You can uninstall from *Settings → Apps*.

Prebuilt installers are on the [Releases page](https://github.com/dhirenv-21/glowline/releases).

`npm run dist:dir` builds an unpacked app in `dist\win-unpacked\Glowline.exe` without an installer.

### Development

```bash
cd glowline
npm install
npm start
```

The `package.json` in the parent `music clone` folder forwards `npm start`, `npm test`, `npm run selftest`, `npm run dist` and `npm run setup` (install dependencies) to this folder, so those commands also work from there.

### Demo mode

```bash
npm run demo
```

Runs Glowline with a made-up track (generated cover art, original placeholder lyrics, a simulated 120 BPM beat), with no Spotify needed. `npm run screenshots` uses it to regenerate the images in `docs/screenshots/`. The app icon is drawn by `python build/make-icon.py` (Pillow).

### Tests

```bash
npm test
```

```bash
npm run selftest
```

`npm test` runs the unit tests: settings, color math, audio level, beat detection, auto-gain, Spotify title parsing, server, and markup and permission checks. `npm run selftest` launches the real app, starts Windows loopback capture, listens for 6 seconds, turns on the overlay, prints a `SELFTEST {...}` JSON report and exits. Play something while it runs. `peakRms` above 0 and `audibleFraction` above 0 mean system audio is reaching Glowline. Add `--selftest-out=<folder>` (`npx electron . --selftest --selftest-out=C:\temp\gl`) to also save screenshots, including a real desktop capture showing the overlay.

### Browser-only mode (optional)

`npm run web` serves the same UI at <http://localhost:5173>. In a browser there's no edge overlay and no Spotify detection. In Chrome or Edge, "Listen" works if you choose **Entire screen** and tick **Also share system audio** in the share dialog.

## Using it with Spotify

Glowline's window is a player. It shows Spotify's **cover art, track, artist and progress**, with **previous / play-pause / next** buttons, and its own edge glows exactly the way your screen will. The cover is also blurred into the background, and by default the glow colors are taken from the cover (**Settings → Colors → Match album art**).

The toolbar at the bottom has, from left to right:

| Button | What it does |
| --- | --- |
| Waveform | **Listen** to Spotify / system audio (white = listening) |
| Bulb | **Glow around my screen** on/off (also **Ctrl+Alt+G**) |
| Palette | Opens Settings at **Colors** |
| Settings | Opens the settings panel (Music status, Screen glow, Light, Colors, More). **Esc** closes it |
| Corners | Full-screen preview |

1. Play something in Spotify. The cover, title and artist appear within about a second.
2. Press the **waveform** button. No Windows permission prompt appears: loopback capture of your own output doesn't need one. The top-right chip changes to **Reacting** and the cover pulses gently on beats.
3. Press the **bulb** to put the glow around your screen. Tick which displays in **Settings → Screen glow**.
4. Press the waveform again to stop listening. Closing Glowline stops everything.

Optional: **Settings → More → Start listening when Glowline opens**.

## The light

The glow is drawn by a GPU shader (`src/glow.js`), the same code for the in-window preview and the on-screen overlay. Per pixel it measures the distance to the screen edge and the position along the perimeter, then layers:

- a **white-hot filament** right on the edge,
- a **colored bloom** a few pixels wide (set by *Thickness*),
- a **soft ambient fade** reaching inward (set by *Glow*), tone-mapped so it never clips to a flat block of color.

The two colors **flow around the screen** with slow organic noise ("light leaking" hot-spots that breathe), corners blend smoothly between sides, and the output is dithered so there's no banding. In **Music sync**, loudness brightens and widens the light, high energy adds a fine shimmer, and **every detected beat launches a wave of light** that runs around the edges from the bottom center and fades. *Speed* controls how fast colors travel. With Windows' *reduce animations* setting, the light stays still and waves are off. If the PC has no WebGL, Glowline falls back to the simpler CSS ring.

## Full-screen lyrics

Press the **full-screen** button (corners icon). The player becomes a full-screen lyrics view: cover, title and progress on the left, and **time-synced lyrics** on the right, over a slowly drifting, blurred version of the cover. The current line lifts into place in pure white, with a soft glow in the album's color that breathes with the music and a slim accent bar in the album's two colors beside it. Upcoming lines stay readable, sung lines recede, and the list glides to each new line with spring easing. Instrumental breaks show three dots that fill in over the break and pulse on the beat. Move the mouse to show the controls; they and the pointer hide after 2.5 s. **Esc** exits.

- Lyrics come from **LRCLIB** (lrclib.net), a free, open lyrics database. No account or key. A lookup sends **only the song's title, artist, album and length** (never audio, never anything about you) and caches the answer in `%APPDATA%\glowline\lyrics-cache`, so each song is looked up at most once. "Not found" is retried after a day.
- **Settings → More → Lyrics lookup** decides when that happens:
  - **Ask each time** (default for new installs): lyrics already cached on this PC show straight away; for a new song, full screen shows a card, *"Show lyrics for this song?"*, with **Look up this song**, **Always look up** and **Turn lyrics off**. Nothing is sent until you choose.
  - **Always**: every new song is looked up automatically. People upgrading from 0.4 with lyrics switched on keep this.
  - **Off**: nothing is sent and full screen shows the player only.
- Songs with only plain (unsynced) lyrics scroll gently with the song's progress. Instrumentals say so.

### Quick manual check (2 minutes)

1. Start Glowline, press the waveform button, and pause Spotify. In **Settings → Music** you should see *"Spotify is open but not playing"* and *"Listening to system audio: silent"*.
2. Play a song in Spotify. The cover and title appear in the player at once, and the Music indicator shows *"Spotify is playing: …"*. The second indicator turns green almost immediately, and the edge glow pulses with the beat.
3. Mute Spotify's volume slider (not the Windows volume). The detection indicator turns amber after about 1.5 s.
4. Press the waveform button again (or **Stop listening**). The meter drops to zero and the indicator shows *"No audio source running"*.

If step 2 shows "playing" but the audio indicator stays amber, see Troubleshooting.

### How it works

- **Audio:** Electron's `setDisplayMediaRequestHandler` answers Glowline's own capture request with `audio: 'loopback'`, which uses Windows WASAPI loopback on the default output device. `getDisplayMedia` also needs a video track. Glowline uses a capture of its own page for it (not the desktop) and stops it immediately, so system audio doesn't depend on Windows desktop duplication, which can fail while the display sleeps or on some hybrid-GPU laptops. Audio feeds a Web Audio `AnalyserNode` (never your speakers), and Glowline computes bass-weighted loudness, auto-gain (so quiet and loud playback react alike), beat pulses, and an "audible" flag with 1.5 s hold.
- **Cover art, track info and playback buttons:** Glowline runs a small PowerShell script (`electron/media-helper.ps1`) that reads Windows' *Global System Media Transport Controls*, the same local source as the media flyout next to the Windows volume indicator. Spotify publishes its cover, title, artist, position and play state there. The script sends updates to Glowline over a pipe and relays Glowline's previous / play-pause / next commands back. Cover images are read by a 40-line C# helper (`electron/MediaThumb.cs`, prebuilt as `GlowlineMediaThumb.dll` with the C# compiler that ships with Windows' .NET Framework; rebuild with `npm run build:media`). PowerShell 5.1 can't pass Windows stream objects around itself. No network, no Spotify account, no API key.
- **Album colors:** the cover is shrunk to 48×48 and its hues are ranked by how saturated and bright they are. The strongest hue and the strongest clearly different hue become the glow's two colors, lifted so they read as light. Mostly black covers use whatever color they have; black-and-white covers get a cool white glow. Picking a color or preset yourself turns *Match album art* off.
- **Spotify detection (fallback):** every 2.5 s Glowline also runs Windows' built-in `tasklist` to read Spotify's window title. Spotify shows "Spotify Premium" / "Spotify Free" when idle and "Artist - Track" while playing. This is local, needs no account, and reads nothing else.
- **Overlay:** a frameless, transparent window per selected display, `alwaysOnTop` at the `screen-saver` level, click-through (`setIgnoreMouseEvents`), hidden from the taskbar and from screen capture (`setContentProtection`), so screen-color sampling never picks up the glow itself.
- **Permissions:** the app denies microphone/camera (`media`) permission outright, and allows `display-capture` only right after one of its own buttons declares what the capture is for.

## Performance

The glow shader skips every pixel the light can't reach and only evaluates the screen sides near each pixel. Nothing over the animated light uses live backdrop blur, the album backdrop is blurred once per track on a tiny canvas, and progress and lyrics only touch the page when something changes. Audio values (sent about 30 times a second) are smoothed every frame, so the light glides instead of stepping. On the test laptop this took the window from ~90 fps with 120–140 ms hitches to ~155–170 fps with no hitches over 33 ms. `npm run selftest` prints `perf` (fps, 95th-percentile and worst frame time) to check yours.

## Features kept from the browser version

Six original presets, primary/secondary color pickers, solid or two-color gradient with adjustable share, Still / Animated / Music modes, glow, thickness and speed sliders, opt-in screen-color sampling, full-screen preview, System/Light/Dark theme, settings saved locally, responsive layout, labeled controls with keyboard support and focus rings, live status messages, and `prefers-reduced-motion` support (rotation pauses, beat pulses off).

Settings live in Glowline's own local storage under `%APPDATA%\glowline`. **More → Reset** restores the look (it keeps your overlay and auto-start choices).

## Limitations

- **It hears all system audio, not only Spotify.** Windows loopback captures the whole mix on the default output device. If YouTube or a game plays at the same time, the light reacts to that too. Glowline *knows* whether Spotify is playing, but it can't isolate Spotify's sound. Per-app capture needs Windows' process-loopback API (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`) through a native module, which this version doesn't include.
- **Default output device only.** If Spotify outputs to a different device (*Spotify → Settings → Playback*, or *Windows Settings → Sound → Volume mixer → App volume and device preferences*), loopback won't hear it. Set Spotify's output to "Default".
- **Cover art needs Spotify's Windows media integration.** It's on by default in the Spotify desktop app. If the player shows the title but no cover, wait for the next track or restart Spotify. If PowerShell is blocked by policy on your PC, the cover and playback buttons are unavailable and Glowline falls back to window-title detection.
- **Window-title fallback.** If Spotify changes its title format, the playing/paused label may be wrong. Audio reaction is unaffected because it comes from the sound itself. Detection needs Spotify's main window to exist; minimized is fine, but closed-to-tray may read as "open but not playing".
- **Where the glow can appear:** over normal windows, borderless-fullscreen apps and video players on the displays you tick. It can **not** appear over exclusive-fullscreen games, the lock screen, UAC/secure desktop prompts, or some DRM-protected video surfaces. It doesn't change monitor brightness or any hardware or RGB lighting.
- **The glow sits over screen content.** It's semi-transparent and click-through, but it tints the outer edge of whatever is underneath. Lower *Thickness* and *Glow* if it gets in the way.
- **GPU use:** the blurred glow is GPU-rendered at your refresh rate. On battery, use Still mode or turn the edge glow off.
- **macOS and Linux:** the overlay works, but system-audio loopback isn't wired up there (macOS would need ScreenCaptureKit audio with permission, Linux a PulseAudio/PipeWire monitor source). Use the local audio file fallback.
- **Unsigned build, no auto-update:** SmartScreen warns on first run, and updates are manual (run the newer installer over the old one; settings are kept). Verify downloads with the SHA-256 in the release notes. [docs/RELEASES.md](../docs/RELEASES.md) covers verification and the next steps for code signing and automatic updates.
- **Lyrics depend on LRCLIB's catalog** and its timing. Very new or niche songs may have none, or slightly off timing. Glowline highlights each line a quarter-second early to feel in sync.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| *"Listening… silent"* while Spotify plays | Make sure Spotify's output device is **Default** and its in-app volume isn't zero. Check *Windows Settings → System → Sound* that the device you hear is the default output. Bluetooth headsets in "Hands-Free" mode use a different device. |
| *"Windows did not provide a system-audio (loopback) track"* | An output device must be enabled. Plug in or enable speakers or headphones, then click Start again. Remote Desktop sessions sometimes have no loopback device. |
| *"Windows did not start audio capture within 10 seconds"* | Wake or unlock the screen and press the **waveform** button again. If it keeps happening, restart Glowline. |
| *"Listening stopped: Windows ended the audio capture…"* | Windows can end loopback capture when the PC sleeps or locks, or when you switch speakers/headphones. Press the **waveform** button to listen again. With **Start listening when Glowline opens** on, Glowline restarts it by itself after you wake or unlock the PC. |
| Light stopped reacting after plugging in headphones or changing the output device | Turn listening off and on with the **waveform** button; capture follows the *current* default output device. |
| Chip says **Listening (auto)** | Capture was started automatically (*Settings → More → Start listening when Glowline opens*). Press the waveform button to stop, or untick the setting. |
| *"System audio capture… permission was declined"* | Only happens if capture was started without a Glowline button (shouldn't happen) or the app's session was blocked by policy. Restart Glowline and use the button. |
| Glow doesn't show | Turn on **Glow around my screen** (Screen glow section) and tick at least one display. Exclusive-fullscreen games hide it. Try **Ctrl+Alt+G**. If another app owns that shortcut, Glowline logs a warning and you can use the checkbox. |
| Glow on the wrong monitor or wrong size after docking | Untick and re-tick the display, or toggle the glow. Glowline refits on display changes, but some docks report late. |
| Spotify shows "isn't running" though it's open | Spotify must be the desktop app (`Spotify.exe`). The web player in a browser isn't detected, but its audio still drives the light through system audio. |
| `npm run dist` fails downloading | electron-builder downloads Electron and NSIS from GitHub on first build. Check your connection or proxy and retry. |

## Project layout

```
glowline/
  electron/main.cjs     desktop shell: windows, loopback capture handler, permissions, overlay, shortcut, self-test
  electron/preload.cjs  narrow IPC bridge (contextIsolation + sandbox)
  electron/spotify.cjs  local Spotify window-title detection via tasklist
  index.html, styles.css    control window UI (also works in a browser)
  overlay.html, overlay.css transparent edge-glow window
  src/core.js           pure logic: settings, colors, sampling, RMS, beat detector, auto-gain, frame state
  src/app.js            control-window wiring: audio sources, detection status, overlay control
  src/overlay.js        overlay renderer
  server.mjs            optional browser-mode static server
  tests/                node:test suites
```

## Why this folder exists

This project began as a browser prototype, written in a standalone folder because no checkout of the REA reverse-engineering toolkit (`morluto/rea`) was on this machine and the two projects are unrelated. It contains no REA code.

## Attribution and license

- Glowline is independent and inspired by publicly described *feature ideas* of commercial ambient-lighting apps. It uses no third-party branding, assets, copy or code. The name, presets, icon and design are original.
- Runtime: [Electron](https://www.electronjs.org/) (MIT). Build tool: [electron-builder](https://www.electron.build/) (MIT). Both are dev dependencies; the packaged app bundles Electron and its Chromium/Node licenses (`LICENSE.electron.txt`, `LICENSES.chromium.html` in the install folder).
- Spotify is a trademark of Spotify AB. Glowline isn't affiliated with or endorsed by Spotify and doesn't use Spotify's API.
- Glowline is released under the [MIT License](../LICENSE). Copyright (c) 2026 Dhiren Vasudeva.

## Settings panel

Settings opens as a panel over the player:

- **Music**: Spotify status, one big **Listen** / **Stop listening** button, an audio-detected indicator and a level meter.
- **Screen glow**: on/off switch plus a list of displays to light.
- **Light**: *Gradient* (1 or 2 colors), *Animation* (Still / Animated / Music sync), Thickness, Glow and Speed sliders.
- **Colors**: preset swatches, two color wheels (drag or use arrow keys; brightness slider beneath each; click the hex chip for the system color picker), a Mix slider and *Match colors to my screen*.
- **More**: auto-start listening, local audio-file fallback, reset, and the limitations list.
