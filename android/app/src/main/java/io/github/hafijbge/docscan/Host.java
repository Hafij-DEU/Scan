package io.github.hafijbge.docscan;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Native side of src/platform.ts, exposed to the page as window.DocScanHost.
 * Every method returns "ok:<info>" or "error:<message>".
 */
final class Host {

    private final MainActivity activity;

    Host(MainActivity activity) {
        this.activity = activity;
    }

    /** Writes the file to Downloads/DocScan through MediaStore (no storage permission needed). */
    @JavascriptInterface
    public String saveFile(String name, String mime, String base64) {
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            ContentResolver resolver = activity.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, safeName(name));
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/DocScan");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return "error:Cannot create the file in Downloads";
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IOException("Cannot open the file for writing");
                out.write(data);
            } catch (IOException e) {
                resolver.delete(uri, null, null);
                throw e;
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return "ok:" + uri;
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    /** Writes the file to the app cache and opens the system share sheet for it. */
    @JavascriptInterface
    public String shareFile(String name, String mime, String base64) {
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            File dir = new File(activity.getCacheDir(), "shared");
            if (!dir.isDirectory() && !dir.mkdirs()) return "error:Cannot create the share folder";
            File file = new File(dir, safeName(name));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(data);
            }
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", file);
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType(mime)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.runOnUiThread(() -> activity.startActivity(Intent.createChooser(send, null)));
            return "ok:" + uri;
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    private static String safeName(String name) {
        String clean = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]+", "_").trim();
        return clean.isEmpty() ? "scan" : clean;
    }
}
