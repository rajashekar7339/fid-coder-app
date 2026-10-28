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

## Ship a new version

1. Raise `version` in `package.json`. `0.1.0` has to become `0.1.1`, or the file name is the same release.
2. Run `npm run dist:win`.
3. Give people the new `release\Fid Coder 0.1.1.exe`. They quit the app and replace the old file.

Agents, chat, and browser profiles stay on the machine. They live in `%APPDATA%\fid-coder`, not inside the `.exe`.

This build does not update itself. There is no update check inside the app.

## What the exe still expects

- The GitHub Copilot CLI on `PATH`, and a Copilot sign-in. The app talks to that CLI.
- Microsoft Edge or Google Chrome for browser tools. A normal Windows machine already has one of those.

Windows SmartScreen warns on launch because the file is not code-signed.
