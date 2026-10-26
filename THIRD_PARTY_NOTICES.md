# Third-party notices

DocScan is MIT licensed (see LICENSE). It is built with the following third-party software.
DocScan has no OCR engine and no PDF library: the PDF writer and all image processing (edge
detection, perspective correction, filters) are written from scratch in `src/`.

| Component | Used for | License |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) 42 | Desktop shell (Linux, Windows) | MIT |
| [Chromium](https://www.chromium.org/) (inside Electron) | Web engine | BSD-3-Clause and others; the full list ships as `LICENSES.chromium.html` in the desktop app |
| [AndroidX WebKit](https://developer.android.com/jetpack/androidx/releases/webkit) 1.12 | Android WebView helpers | Apache-2.0 |
| Android WebView (system component) | Android web engine | Chromium licenses |

Build tools only (not shipped): Vite (MIT), TypeScript (Apache-2.0), electron-builder (MIT).
