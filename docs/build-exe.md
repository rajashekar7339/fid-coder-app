# Build the Windows exe

The packaged app is a portable `.exe`. A coworker copies that file and double-clicks it. They do not need this repo, Node, or an installer.

`npm run build` only compiles the app. It does not produce the `.exe`.

## Build

From the repo root, on Windows:

```powershell
npm install
npm run dist:win
```

`dist:win` compiles the main process, preload script, and renderer, then runs `electron-builder` for a 64-bit portable Windows build. The config is the `"build"` block in `package.json`.

The file is written to:

```text
release\Fid Coder 0.1.0.exe
```

The `0.1.0` segment is the `version` in `package.json`. `release/` is gitignored.

The first build downloads the Electron Windows binary and can take a few minutes.

## App icon

The icon lives in `assets/app-icon/`:

- `icon.svg` is the source artwork.
- `icon.png` is the 512 px image used by the window and Windows notifications.
- `tray.png` is the 32 px tray image.
- `icon.ico` contains the 16, 24, 32, 48, 64, 128, and 256 px frames for Windows.

`src/main/icon.ts` chooses the dev or packaged folder. In development the window icon comes from the repo. In the packaged app, `win.icon` embeds the ICO in the `.exe`, and the `extraResources` entry copies the folder to `resources/app-icon` so `BrowserWindow`, the tray, and the toast shortcut can find it.

`BrowserWindow` uses `icon.png`, not `icon.ico`. Electron's Windows window loader applies the PNG reliably; the multi-size ICO is for the executable, the Start Menu shortcut, and the shell. Keep the window on `appIconPath()` and the shortcut on `appIconIcoPath()`.

Development uses `com.fidcoder.desktop.dev` and `Fid Coder (dev).lnk`; the packaged app uses `com.fidcoder.desktop` and `Fid Coder.lnk`. The separate dev identity keeps the development taskbar button and toast registration from inheriting the packaged app's Electron icon. `src/main/identity.ts` owns the id, shortcut name, and display name.

To change the mark, edit `icon.svg` and the matching geometry in `scripts/generate-app-icon.ps1`, then regenerate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-app-icon.ps1
npm run dist:win
```

Windows caches the icon of a pinned taskbar shortcut. After a change, unpin Fid Coder and pin it again. The toast shortcut is replaced the next time the app starts.

## Ship a new version

1. Raise `version` in `package.json`. `0.1.0` has to become `0.1.1`, or the file name is the same release.
2. Run `npm run dist:win`.
3. Give people the new `release\Fid Coder 0.1.1.exe`. They quit the app and replace the old file.

Agents, chat, and browser profiles stay on the machine. They live in `%USERPROFILE%\.fid_coder_app`, not inside the `.exe`.

This build does not update itself. There is no update check inside the app.

## What the exe still expects

- The GitHub Copilot CLI on `PATH`, and a Copilot sign-in. The app talks to that CLI.
- Microsoft Edge or Google Chrome for browser tools. A normal Windows machine already has one of those.

Windows SmartScreen warns on launch because the file is not code-signed.
