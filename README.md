<p align="center">
  <img src="build/icon.png" width="112" alt="LavaNotes">
</p>

<h1 align="center">LavaNotes</h1>

<p align="center">
  <b>Desktop sticky notes that look like real paper — scattered, tilted sheets with washi tape, images and tables, and a ✓ to tear off what is done.</b>
</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

---

## Features

- **Every note is its own window**: transparent and paper-shaped, with grain, shadow and washi tape. New notes lean left and right in turn and are spread out instead of piling up on one spot; the one you click comes to the front.
- **Window layer for new notes**, chosen in Manager → Settings:
  - **Normal** — an ordinary window that other apps can cover;
  - **On top** — always in front;
  - **Pinned to the desktop** — sits above the desktop icons and below every window, so you only see it where the desktop shows. **Show Desktop (Win+D) and Minimize All (Win+M) leave it alone.**
- **Resize from the folded bottom-right corner**, even while editing. Move a note by its top strip, tape or side edges.
- **Rich text**: bold, italic, underline, strikethrough, bullet and numbered lists, checklists.
- **Images**: insert, paste a screenshot or drag a file in; drag a corner to resize. Images are stored as separate files, so notes stay light.
- **Simple tables**: insert 3×3, add or remove rows and columns, toggle the header row, drag column widths.
- **Done — tear it off**: the ✓ at the top right means done; the note is torn off into the archive, and you can put it back from the manager.
- **Manager**: search all notes and browse the torn-off ones (put them back or delete them).
- **Tray app** that starts with Windows and updates itself from GitHub Releases.

## Download

Get `LavaNotes-Setup-<version>.exe` from [Releases](https://github.com/chengcczzjj/LavaNotes/releases/latest). Windows 10 / 11 x64. The installer is not code-signed, so SmartScreen may warn on first run; choose “Run anyway”.

## Data

Everything stays on your PC in `%APPDATA%\LavaNotes`: `notes-index.json` (positions, colours, layers, when a note was torn off) with a backup copy, one `notes/<id>.json` per note body, `assets/<sha256>.<ext>` for images and `settings.json`. Files are written to a temporary file and renamed into place; a damaged index is moved aside and restored from the backup, never overwritten.

Other apps can open LavaNotes with `lavanotes://new`, `lavanotes://manager` and `lavanotes://open`.

## Development

Node.js 22.

```bash
npm install
npm run dev           # run in development
npm test              # typecheck + lint + unit tests
npm run test:smoke    # build, then drive real Electron windows (use xvfb-run on Linux)
npm run dist          # build the Windows installer (on Windows)
```

Pushing a `v*` tag, or running the **Release Windows** workflow by hand with the tag to create, makes GitHub Actions test, build and publish the release on Windows. Design notes: [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
