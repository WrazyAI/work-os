# Work OS brand assets

The canonical logo set for Work OS. The mark is the reference design: a very
dark rounded tile, an off-white stylized "w", and a lime-green dot at the
upper right. Do not restyle, recolor, or re-proportion it; new surfaces should
consume these files rather than drifting copies.

| File | Use |
| --- | --- |
| `work-os-logo-primary.svg` | App-icon master; 1024px canvas, scales from the 64-unit geometry |
| `work-os-logo-primary.png` | 1024x1024 raster master, transparent surround |
| `work-os-logo-mark.svg` | Embeddable symbol; byte-identical to the companion `public/work-os-mark.svg` |
| `work-os-logo-mark.png` | 512x512 symbol raster |

Palette: tile `#151713`, "w" `#F2F0E8`, dot `#B8FF5A`.

## Derivative copies

These ship inside the desktop companion. Regenerate them from this folder;
never hand-edit them.

- `desktop/work-os-companion/public/work-os-mark.svg` — favicon and README copy of `work-os-logo-mark.svg`
- `desktop/work-os-companion/public/work-os-mark.png` — 128x128 favicon render
- `desktop/work-os-companion/src/assets/work-os-mark.png` — 256x256 in-app wordmark render
- `desktop/work-os-companion/src-tauri/icons/` — platform icon bundle (PNG, ICO, ICNS, Windows square logos, Android, iOS)

## Regenerating

Rasterize the SVGs at native density (for example with `sharp` or
`rsvg-convert`), then rebuild the platform icon bundle from the 1024px master:

```bash
cd desktop/work-os-companion
./node_modules/.bin/tauri icon ../../brand/work-os-logo-primary.png
```

The Tauri config bundles `icons/32x32.png`, `icons/128x128.png`,
`icons/128x128@2x.png`, `icons/icon.png`, and `icons/icon.ico`; the macOS
config adds `icons/icon.icns`. Keep those paths in place when regenerating.
