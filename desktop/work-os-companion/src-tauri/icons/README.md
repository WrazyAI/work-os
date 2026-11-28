# Runtime icons

`icon.png`, `icon.ico`, and `icon.icns` are the stable bundle icons. The
Nightly variants are runtime-only so Stable promotion can reuse the verified
Windows installer verbatim:

- `nightly-icon.svg` is the editable Nightly pill source.
- `nightly-runtime.png` is the 512 px transparent PNG embedded by
  `set_update_channel_icon` and shown on the window and macOS Dock while the app
  is on the Nightly update channel.
- `nightly-runtime.ico` is the multi-size Windows taskbar variant. The command
  writes it to a temp file and sends `WM_SETICON`/`ICON_BIG` because Tauri's
  `set_icon` updates only the small window icon.
- `nightly-tray.svg` is the menu-bar crescent source; `nightly-tray.png` is the
  44 px (2×) transparent tray export. The tray uses the moon, while the window
  and Dock use the pill.

Keep the Nightly tag inside the dark tile and clear of the W. The stable icon
must stay the default embedded in the executable and installer.
