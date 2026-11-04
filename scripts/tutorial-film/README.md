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
