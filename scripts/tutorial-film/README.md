# Desktop tutorial production

Capture the actual companion offline, never an employee account. Missing controls
fail a take. Evidence records actions, caption positions and network contact; it
does not replace visual review.

## Render worker

Use an isolated scratch directory on the VPS, outside the deployed application.
Provision Node, existing Playwright/Chromium, FFmpeg, and a Python venv with numpy.
Do not install packages into a running application's node_modules.

Build `desktop/work-os-companion` with `vite.film.config.ts` and upload that
filming-only output. Never ship this DEV-enabled build as an installer or website.
Upload this directory beside the app; the font and mascot are self-contained.

```sh
FILM_APP=/path/to/filming-build \
FILM_OUT=/path/to/output \
FILM_PYTHON=/path/to/venv/bin/python \
PLAYWRIGHT_PATH=/path/to/node_modules/playwright \
node /path/to/rig/batch.mjs insights settings
```

`shoot.mjs <slug> --preflight` performs the actual actions and saves scene stills
without rendering thousands of frames. `FILM_BASE=http://127.0.0.1:<port>` uses an
existing filming server; otherwise the rig serves FILM_APP on a temporary loopback
port and closes it when finished. No credentials are needed.

Each slug gets a separate directory with `evidence.json`, screenshots, VTT, MP4
and poster. Music, encoding and contact sheets run on the render worker. The
clock lesson requires the DEV-only unforced scheduled seed supported by the
current companion sources. Live attendance readback is never simulated in the
production path.

Before publishing: watch the film, check that the promised actions happened,
inspect captions at every scene, verify audio/60fps/duration, then update the
manifest and assets together. Never publish a static overview to bypass a failed
action. Do not copy contact sheets, silent intermediates or private evidence into
the public asset tree.

## Extended Otto film

The eight-part showcase has its own adapter; the ten accepted short films stay
unchanged. Build with the companion-local `vite.otto-film.config.ts`, not the
installer config. It supplies browser-only native handoff and shared-vault
adapters. `otto-fixtures.mjs` serves fictional API results exclusively on
loopback; unknown requests fail. It is never imported by shipped app code.

```sh
node --import tsx scripts/tutorial-film/otto-seed.mts /path/to/otto-seed.json
desktop/work-os-companion/node_modules/.bin/vite build --config desktop/work-os-companion/vite.otto-film.config.ts
# Copy InterVariable.woff2 to dist-otto-film/assets/film-Inter.woff2.
# Upload dist-otto-film and the dedicated otto-*.mjs modules to isolated scratch.
FILM_APP=/scratch/app FILM_OUT=/scratch FILM_SEED=/scratch/otto-seed.json \
PLAYWRIGHT_PATH=/path/to/playwright node /scratch/rig/otto-shoot.mjs --preflight
```

Omit `--preflight` to record with Xvfb and FFmpeg on the render worker. This
captures actual60fps wall time rather than speeding up screenshot-per-frame
playback. The capture rectangle excludes Chromium chrome while retaining the
entire1440×900 application viewport. Web Audio start/stop clocks record the
actual spoken sample offsets without replacing the player. The finalizer mixes
those bytes at their recorded offsets, ducking music beneath them. The compact
confirmation take lets the real player finish before recording: the previous
part has already played that recap, so its continuation is honest.

Preflight and capture evidence live separately. Every take fingerprints the
complete build, including CSS, art and audio. Finalization rejects preflight,
missing parts, missing paired voice or non60fps recordings:

```sh
FILM_APP=/scratch/app FILM_OUT=/scratch FILM_PYTHON=/path/to/venv/bin/python \
node /scratch/rig/otto-finish.mjs
```

Inspect every part and listen to the final mix before publishing the single
MP4/JPG/VTT plus measured chapter offsets. The film teaches existing employee
capabilities; its prepared AI replies are demonstration data, not live employee
answers or a new historical EOD-status capability.
