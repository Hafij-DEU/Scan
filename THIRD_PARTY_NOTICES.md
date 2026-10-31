# Third-party notices

DocScan is MIT licensed (see LICENSE). It is built with the following third-party software.
DocScan has no PDF library: the PDF writer and all image processing (edge detection, perspective
correction, filters) are written from scratch in `src/`. Text recognition uses tesseract.js, which is
shipped with the app and loaded only when you use OCR.

| Component | Used for | License |
| --- | --- | --- |
| [Tauri](https://tauri.app/) 2 and its Rust dependencies | Desktop shell (Linux, Windows) | MIT or Apache-2.0 |
| [WebKitGTK](https://webkitgtk.org/) (system package, not bundled) | Linux web engine | LGPL-2.1 and BSD |
| [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (part of Windows, not bundled) | Windows web engine | Microsoft software license |
| [AndroidX WebKit](https://developer.android.com/jetpack/androidx/releases/webkit) 1.12 | Android WebView helpers | Apache-2.0 |
| Android WebView (system component) | Android web engine | Chromium licenses |
| [tesseract.js](https://github.com/naptha/tesseract.js) 7 | Text recognition worker | Apache-2.0 |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) (Tesseract OCR compiled to WebAssembly) | OCR engine | Apache-2.0 |
| [English trained data](https://github.com/tesseract-ocr/tessdata) via `@tesseract.js-data/eng` | OCR language model | Apache-2.0 |

Build tools only (not shipped): Vite (MIT), TypeScript (Apache-2.0), Tauri CLI (MIT or Apache-2.0).
