# DocScan

A document scanner app written from scratch. It does the core CamScanner job:
capture or import, auto edge detection, corner adjust, perspective correction,
enhance filters, multi-page documents, and PDF/JPEG export. Everything runs
on the device: no account, no ads, no telemetry.

One TypeScript web app (`src/`), two shells:

- **Linux `.deb`**: Electron (`electron/main.cjs`), packaged by electron-builder.
- **Android `.apk`**: Java WebView host (`android/`). It serves the bundle from
  `https://appassets.androidplatform.net` and adds native camera permission,
  the file picker, and save/share (`Host.java`).

The analysis of the original app is in [docs/camscanner-analysis.md](docs/camscanner-analysis.md).

## Build

```bash
pnpm install
pnpm build:deb   # -> release/DocScan-<version>-amd64.deb
pnpm build:apk   # -> android/app/build/outputs/apk/debug/DocScan-<version>-android-debug.apk
pnpm start       # run the desktop app without packaging
pnpm dev         # web UI in a browser at http://localhost:5173
```

`build:apk` uses Gradle 8.11.1 from `~/.local/opt/gradle-8.11.1` in offline mode
and the Android SDK set in `android/local.properties`.
For a signed release APK, set `DOCSCAN_KEYSTORE`, `DOCSCAN_KEYSTORE_PASSWORD`,
`DOCSCAN_KEY_ALIAS` and `DOCSCAN_KEY_PASSWORD`, then run `gradle assembleRelease` in `android/`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/imaging/detect.ts` | Page detection: Otsu segmentation, hole fill, convex hull, max-area quad |
| `src/imaging/warp.ts` | Homography + bilinear perspective correction |
| `src/imaging/filters.ts` | Magic color, Lighten, Grayscale, B&W (background-normalised) |
| `src/pdf.ts` | Dependency-free PDF writer (one JPEG per page) |
| `src/store.ts` | IndexedDB documents and pages (keeps originals for re-editing) |
| `src/platform.ts` | Save/share: Android bridge or browser download |
| `src/screens/` | Home, camera, crop, enhance, document, page screens |

## Storage

Scans live in the app's IndexedDB. Exports go to `Downloads/DocScan` on Android.
On Linux, a save dialog asks where to put them.

## Not implemented yet

OCR, cloud sync, e-signature, and ID-card mode.
