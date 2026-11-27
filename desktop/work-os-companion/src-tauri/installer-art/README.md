# Installer artwork

Branded artwork used by the Windows NSIS/MSI installers and the macOS DMG.
Every image is derived from the companion app mark
(`src-tauri/icons/icon.png`) and the shared palette in `docs/design/tokens.md`.

| File | Used by | Dimensions |
|---|---|---|
| `nsis-header.bmp` | NSIS installer and uninstaller header | 150 × 57 |
| `nsis-sidebar.bmp` | NSIS welcome and finish pages | 164 × 314 |
| `wix-banner.bmp` | MSI installer banner | 493 × 58 |
| `wix-dialog.bmp` | MSI welcome and completion dialogs | 493 × 312 |
| `dmg-background.png` | macOS DMG install window | 660 × 400 |

The DMG icon positions in `tauri.macos.conf.json` (`appPosition` and
`applicationFolderPosition`) line up with the arrow in `dmg-background.png`.
Update them together if the window layout changes.

Keep the bitmaps 24-bit RGB; NSIS and WiX do not accept alpha in these slots.
