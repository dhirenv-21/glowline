# Contributing to Glowline

Thanks for your interest! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/dhirenv-21/glowline/issues/new/choose) using the bug template and include:

- your Windows version and Glowline version,
- what you expected and what happened,
- the output of `npm run selftest` if it's about audio, cover art or performance (it prints a `SELFTEST {...}` line with detection and frame-timing data).

Please don't paste anything personal (file paths with your name, account details) into issues.

## Development setup

```bash
git clone https://github.com/dhirenv-21/glowline.git
cd glowline/glowline
npm install
npm start        # run from source
npm run demo     # run with a demo track (no Spotify needed)
npm test         # unit tests
```

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep changes focused; one feature or fix per PR.
3. Add or update tests in `glowline/tests/` for logic changes (they use `node:test` and must not need the network or audio hardware).
4. Run `npm test` and make sure it passes.
5. If you change the UI, check keyboard access and the *reduce animations* setting, and include a before/after screenshot.

## Ground rules

- **Privacy first:** audio must stay on the user's PC. No analytics, telemetry or new network calls without a clear, opt-out setting.
- **No microphone** use as a stand-in for system audio.
- **No new dependencies** unless they're clearly worth it.
- Keep the app's own branding; don't add third-party logos or copyrighted artwork (use `npm run demo` for screenshots).

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
