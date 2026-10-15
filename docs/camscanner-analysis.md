# CamScanner 7.4.0 — static analysis

Target: `camscanner.apk`, SHA-256 `179af0cd21ee3cf5591e81e09c28151e715b747e28bf4d777dec36ba98969244`.
Method: static only (aapt2, dexdump, apksigner, REA `identify_flutter_build`). The app was never run.
Each line is tagged **[obs]** (observed in the artifact) or **[inf]** (inferred from names; not verified).

## Identity

- [obs] Package `com.intsig.camscanner`, version `7.4.0.2510160000` (code 70401), minSdk 21, targetSdk 35.
- [obs] Signed by `CN=IntSig, O=www.intsig.com, Shanghai, CN`, cert SHA-256 `7fb4c4f7…a23f`.
- [obs] Only `arm64-v8a` native code. 11,583 files, 208 MB uncompressed.

## Protection

- [obs] `classes.dex` is 13 KB with 4 classes: `s.h.e.l.l.A/C/N/S`.
- [obs] `<application android:name="s.h.e.l.l.S" android:appComponentFactory="s.h.e.l.l.A">`.
- [obs] `assets/ijm_lib/{arm64-v8a,x86_64}` and `lib/arm64-v8a/libijm-emulator.so` are present.
- [inf] These are the iJiami (爱加密) packer. The real Java/Kotlin code is encrypted and only decrypted in memory at runtime.
  So JADX/apktool show only the shell, not the app logic. A runtime dump would be needed to see the logic. It was not attempted.

## Architecture

- [obs] Native Android app with **380 activities, 33 services, 19 receivers, 26 providers**.
- [obs] Embedded Flutter module (`libflutter.so`, `libapp.so`, Dart snapshot hash `d20a1be77c3d3c41b2a5accaee1ce549`,
  `package:flutter_boost`). The Flutter Dart packages are `translate`, `airead`, `markdown_widget`, `flutter_math_fork`,
  `highlight`, `dio`, `sqflite` and `sentry_flutter`.
- [inf] Flutter covers only the newer AI-read and translate screens. Scanning, editing and the document list are native.

## Feature modules (activities under `com.intsig.camscanner.*`)

`pdf` (24), `settings` (23), `capture` (15), `newsign` (14, e-signature), `shortcut` (12), `purchase` (12), `push` (8),
`office_doc` (5), `mode_ocr` (4), `gallery` (4), `translate`/`translate_v3`/`trans_v4`, `signature`, `share`, `merge`,
`lock`, `smarterase`, `scandone`, `printer`, `pagedetail`, `multiimageedit`, `image_restore`, `imageaiprocess`,
`formula`, `doodle`, `docimport`, `card_photo`, `booksplitter`, `bankcardjournal`, `uploadfaxprint`, `onecloud`, `enterprise`.

## Native engines (`lib/arm64-v8a`)

| Library | [inf] Role |
| --- | --- |
| `libpagescanner.so`, `libscannercs.so`, `libFocusArea.so` | page edge/corner detection, focus |
| `libmagicenhancer.so`, `libenhance4draft.so`, `libimageprocessor.so`, `libnbitmap.so` | "Magic color", B&W and other enhance filters |
| `libopencv.so`, `libncnn.so`, `libMNN.so`, `libCVNN.so`, `liboctopus_classifier.so` | CV + on-device neural nets |
| `libOCREngine.so`, `libTAGEngine*.so`, `libdigital_ink.so`, `libpinyinEngine.so` | OCR, handwriting |
| `libbarhopper_v3.so`, `libQREngine.so` | barcode / QR (ML Kit) |
| `libpdfium*.so`, `libpdfengine.so`, `libjbig2enc.so` | PDF render / write, JBIG2 compression |
| `liblongImageStitch.so`, `libpag.so`, `libpl_droidsonroids_gif.so` | long-image stitching, animation |
| `libencryptfile.so`, `libnative-encrypt.so`, `libEncryptorP.so` | file / request encryption |
| `libsentry*.so`, `libxcrash*.so`, `libapminsight*.so`, `libvolc_log.so` | crash + APM telemetry |
| `libmsaoaid*.so` | China OAID device identifier |

## Third-party SDKs (manifest components)

ByteDance/Pangle ads and live (`com.bytedance.*`, `com.ss.android`, `com.byted.live`), Tencent GDT ads (`com.qq.e`),
Huawei HMS, Xiaomi/Vivo/Oppo(HeyTap) push, Firebase, Google Play Billing, Alipay, WeChat, Facebook, Box, Sentry, ML Kit, CameraX.

## Permissions of note (45 total)

`CAMERA`, `MANAGE_EXTERNAL_STORAGE`, `QUERY_ALL_PACKAGES`, `ACCESS_FINE_LOCATION`, `BLUETOOTH_SCAN/CONNECT`,
`GET_TASKS`, `com.google.android.gms.permission.AD_ID`, OAID permissions, `INSTALL_SHORTCUT`, `com.android.vending.BILLING`.

## What the clone (`docscan`) re-implements

The core user flow, written from scratch, with no CamScanner code or assets:
capture or import, auto edge detection, manual corner adjust, perspective correction, enhance filters,
multi-page documents, and PDF/JPEG export. It does not include ads, telemetry, accounts, cloud sync, or OCR.
